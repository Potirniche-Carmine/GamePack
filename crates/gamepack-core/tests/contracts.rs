use gamepack_core::model::{Anchor, Drawing, Sample, Tool};
use gamepack_core::{dispatch, evaluate_drawings};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::fs;
use tempfile::TempDir;

struct Fixture {
    directory: TempDir,
    source: TempDir,
    project: String,
    video: Value,
}

fn request(root: &std::path::Path, request: Value) -> Value {
    serde_json::from_str(&dispatch(root.to_str().unwrap(), &request.to_string())).unwrap()
}
fn success(root: &std::path::Path, command: Value) -> Value {
    let response = request(root, command);
    assert_eq!(response["ok"], true, "{response}");
    response["data"].clone()
}
fn failure(root: &std::path::Path, command: Value) -> String {
    let response = request(root, command);
    assert_eq!(response["ok"], false, "{response}");
    response["error"].as_str().unwrap().into()
}
impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().unwrap();
        let source = TempDir::new().unwrap();
        fs::write(source.path().join("clip.mp4"), b"exact original bytes").unwrap();
        let boot = success(directory.path(), json!({"command":"bootstrap"}));
        let project = boot["projects"][0]["id"].as_str().unwrap().into();
        let video = success(
            directory.path(),
            json!({"command":"import_video","path":source.path().join("clip.mp4"),"project_id":project,"duration_us":20_000_000,"width":1920,"height":1080}),
        );
        Self {
            directory,
            source,
            project,
            video,
        }
    }
    fn root(&self) -> &std::path::Path {
        self.directory.path()
    }
    fn draft(&self, id: &str) -> Value {
        json!({"id":id,"project_id":self.project,"video_id":self.video["id"],"text":"Watch this","anchor":{"kind":"point","at_us":1_000_000},"parent_comment_id":null,"drawings":[]})
    }
    fn save(&self, draft: Value) -> Value {
        success(self.root(), json!({"command":"save_draft","draft":draft}))
    }
    fn named(&self, name: &str) {
        success(self.root(), json!({"command":"set_profile","name":name}));
    }
    fn post(&self, id: &str) -> Value {
        success(self.root(), json!({"command":"post_draft","draft_id":id}))
    }
    fn boot(&self) -> Value {
        success(self.root(), json!({"command":"bootstrap"}))
    }
}

#[test]
fn themes_are_strict_persisted_and_migrate_existing_libraries() {
    let fixture = Fixture::new();
    let initial = fixture.boot();
    assert_eq!(
        initial["settings"],
        json!({"theme":"system","keybindings":{},"annotation_speed_percent":50})
    );
    // Recreate an actual pre-settings library, retaining its existing records.
    let db = Connection::open(fixture.root().join("gamepack.sqlite3")).unwrap();
    db.execute_batch("DROP TABLE settings; PRAGMA user_version=1;")
        .unwrap();
    drop(db);
    let migrated = fixture.boot();
    assert_eq!(
        migrated["settings"],
        json!({"theme":"system","keybindings":{},"annotation_speed_percent":50})
    );
    assert_eq!(migrated["profile"], initial["profile"]);
    assert_eq!(migrated["videos"], initial["videos"]);
    for theme in ["dark", "light", "system"] {
        let saved = success(fixture.root(), json!({"command":"set_theme","theme":theme}));
        assert_eq!(
            saved,
            json!({"theme":theme,"keybindings":{},"annotation_speed_percent":50})
        );
        assert_eq!(fixture.boot()["settings"], saved);
    }
    for invalid in [
        json!("LIGHT"),
        json!("sepia"),
        Value::Null,
        json!(true),
        json!({"theme":"dark"}),
    ] {
        failure(
            fixture.root(),
            json!({"command":"set_theme","theme":invalid}),
        );
    }
    failure(
        fixture.root(),
        json!({"command":"set_theme","theme":"dark","extra":1}),
    );
    assert_eq!(
        fixture.boot()["settings"],
        json!({"theme":"system","keybindings":{},"annotation_speed_percent":50})
    );
    let other = TempDir::new().unwrap();
    assert_eq!(
        success(other.path(), json!({"command":"bootstrap"}))["settings"],
        json!({"theme":"system","keybindings":{},"annotation_speed_percent":50})
    );
}

#[test]
fn bootstrap_and_edits_survive_reopened_connections() {
    let fixture = Fixture::new();
    assert_eq!(fixture.boot()["profile"]["name"], "");
    let initial_author = fixture.boot()["profile"]["author_id"].clone();
    fixture.named("Maya");
    let mut draft = fixture.draft("draft-1");
    draft["text"] = json!("");
    fixture.save(draft.clone()); // incomplete drafts are allowed
    draft["text"] = json!("Autosaved revision");
    fixture.save(draft.clone());
    let boot = fixture.boot();
    assert_eq!(boot["drafts"], json!([draft]));
    assert_eq!(boot["profile"]["author_id"], initial_author);
    assert_eq!(boot["profile"]["name"], "Maya");
    assert_eq!(boot["projects"].as_array().unwrap().len(), 1);
    success(
        fixture.root(),
        json!({"command":"discard_draft","draft_id":"draft-1"}),
    );
    assert_eq!(fixture.boot()["drafts"], json!([]));
}

#[test]
fn imports_deduplicate_bytes_across_names_and_projects_without_touching_sources() {
    let fixture = Fixture::new();
    fs::copy(
        fixture.source.path().join("clip.mp4"),
        fixture.source.path().join("renamed.mov"),
    )
    .unwrap();
    let same = success(
        fixture.root(),
        json!({"command":"import_video","path":fixture.source.path().join("renamed.mov"),"project_id":fixture.project}),
    );
    assert_eq!(same["id"], fixture.video["id"]);
    let project = success(
        fixture.root(),
        json!({"command":"create_project","title":"Another review"}),
    );
    let other = success(
        fixture.root(),
        json!({"command":"import_video","path":fixture.source.path().join("renamed.mov"),"project_id":project["id"]}),
    );
    assert_ne!(other["id"], fixture.video["id"]);
    assert_eq!(other["media_id"], fixture.video["media_id"]);
    assert_eq!(other["path"], fixture.video["path"]);
    assert_eq!(
        fs::read_dir(fixture.root().join("media")).unwrap().count(),
        1
    );
    assert_eq!(fixture.boot()["storage"]["managed_bytes"], 20);
    assert_eq!(
        fs::read(fixture.source.path().join("clip.mp4")).unwrap(),
        b"exact original bytes"
    );
    assert_eq!(fs::read_dir(fixture.root().join("tmp")).unwrap().count(), 0);
    fs::write(
        fixture.source.path().join("clip.mp4"),
        b"changed external original",
    )
    .unwrap();
    assert_eq!(
        success(
            fixture.root(),
            json!({"command":"verify_video","video_id":fixture.video["id"]})
        )["valid"],
        true
    );
    assert_eq!(
        fs::read(fixture.video["path"].as_str().unwrap()).unwrap(),
        b"exact original bytes"
    );
}

#[test]
fn verify_detects_same_size_tampering_and_missing_managed_media() {
    let fixture = Fixture::new();
    let managed = fixture.video["path"].as_str().unwrap();
    fs::write(managed, b"XXXXXXXXXXXXXXXXXXXX").unwrap();
    assert_eq!(
        success(
            fixture.root(),
            json!({"command":"verify_video","video_id":fixture.video["id"]})
        )["valid"],
        false
    );
    fs::remove_file(managed).unwrap();
    assert_eq!(
        success(
            fixture.root(),
            json!({"command":"verify_video","video_id":fixture.video["id"]})
        )["valid"],
        false
    );
}

#[test]
fn post_is_atomic_idempotent_and_freezes_author_and_digest() {
    let fixture = Fixture::new();
    fixture.named("Maya");
    fixture.save(fixture.draft("publish-once"));
    let posted = fixture.post("publish-once");
    fixture.named("New name");
    assert_eq!(fixture.post("publish-once"), posted);
    assert_eq!(posted["comment_id"], "publish-once");
    assert_eq!(posted["name_at_posting"], "Maya");
    assert_eq!(fixture.boot()["comments"], json!([posted.clone()]));
    assert_eq!(fixture.boot()["drafts"], json!([]));
    let mut canonical = posted.clone();
    canonical.as_object_mut().unwrap().remove("digest");
    assert_eq!(
        posted["digest"],
        blake3::hash(&serde_json::to_vec(&canonical).unwrap())
            .to_hex()
            .to_string()
    );
    assert!(failure(
        fixture.root(),
        json!({"command":"save_draft","draft":fixture.draft("publish-once")})
    )
    .contains("already been posted"));
    let db = Connection::open(fixture.root().join("gamepack.sqlite3")).unwrap();
    assert!(db.execute("UPDATE comments SET body='{}'", []).is_err());
    assert!(db.execute("DELETE FROM comments", []).is_err());
    assert!(db
        .execute("INSERT OR REPLACE INTO comments SELECT * FROM comments", [])
        .is_err());
}

#[test]
fn concurrent_publish_retries_return_one_identical_record() {
    let fixture = Fixture::new();
    fixture.named("Maya");
    fixture.save(fixture.draft("concurrent"));
    let results = std::thread::scope(|scope| {
        let first = scope.spawn(|| fixture.post("concurrent"));
        let second = scope.spawn(|| fixture.post("concurrent"));
        (first.join().unwrap(), second.join().unwrap())
    });
    assert_eq!(results.0, results.1);
    assert_eq!(fixture.boot()["comments"].as_array().unwrap().len(), 1);
}

#[test]
fn failing_second_publication_write_rolls_back_whole_comment() {
    let fixture = Fixture::new();
    fixture.named("Maya");
    fixture.save(fixture.draft("transaction-failure"));
    let db = Connection::open(fixture.root().join("gamepack.sqlite3")).unwrap();
    db.execute_batch("CREATE TRIGGER test_fail_draft_delete BEFORE DELETE ON drafts BEGIN SELECT RAISE(ABORT,'injected write failure'); END;").unwrap();
    assert!(failure(
        fixture.root(),
        json!({"command":"post_draft","draft_id":"transaction-failure"})
    )
    .contains("injected write failure"));
    let boot = fixture.boot();
    assert_eq!(boot["comments"], json!([]));
    assert_eq!(boot["drafts"].as_array().unwrap().len(), 1);
    db.execute_batch("DROP TRIGGER test_fail_draft_delete;")
        .unwrap();
    fixture.post("transaction-failure");
}

#[test]
fn invalid_publication_leaves_editable_draft_and_no_post() {
    let fixture = Fixture::new();
    let mut draft = fixture.draft("blank");
    draft["text"] = json!("  ");
    fixture.save(draft.clone());
    assert!(failure(
        fixture.root(),
        json!({"command":"post_draft","draft_id":"blank"})
    )
    .contains("text or a drawing"));
    draft["text"] = json!("Now complete");
    fixture.save(draft);
    assert!(failure(
        fixture.root(),
        json!({"command":"post_draft","draft_id":"blank"})
    )
    .contains("Display name"));
    assert_eq!(fixture.boot()["comments"], json!([]));
    assert_eq!(fixture.boot()["drafts"].as_array().unwrap().len(), 1);
    fixture.named("Maya");
    fixture.post("blank");
}

#[test]
fn replies_require_existing_parent_in_same_project_and_video() {
    let fixture = Fixture::new();
    fixture.named("Maya");
    fixture.save(fixture.draft("parent"));
    fixture.post("parent");
    let mut reply = fixture.draft("reply");
    reply["parent_comment_id"] = json!("missing");
    assert!(failure(
        fixture.root(),
        json!({"command":"save_draft","draft":reply})
    )
    .contains("parent does not exist"));
    reply["parent_comment_id"] = json!("reply");
    assert!(failure(
        fixture.root(),
        json!({"command":"save_draft","draft":reply})
    )
    .contains("itself"));
    reply["parent_comment_id"] = json!("parent");
    fixture.save(reply.clone());
    assert_eq!(fixture.post("reply")["parent_comment_id"], "parent");
    let project = success(
        fixture.root(),
        json!({"command":"create_project","title":"Separate review"}),
    );
    let video = success(
        fixture.root(),
        json!({"command":"import_video","project_id":project["id"],"path":fixture.source.path().join("clip.mp4")}),
    );
    reply["id"] = json!("cross-project");
    reply["project_id"] = project["id"].clone();
    reply["video_id"] = video["id"].clone();
    assert!(failure(
        fixture.root(),
        json!({"command":"save_draft","draft":reply})
    )
    .contains("same project and video"));
}

fn pen() -> Drawing {
    Drawing {
        id: "stroke".into(),
        tool: Tool::Pen,
        width: 4000,
        samples: vec![
            Sample {
                x: 0,
                y: 0,
                t_us: None,
            },
            Sample {
                x: 5,
                y: 5,
                t_us: None,
            },
            Sample {
                x: 20,
                y: 20,
                t_us: None,
            },
        ],
    }
}

#[test]
fn completed_drawings_exist_only_at_their_frame_after_any_seek() {
    let anchor = Anchor::Point { at_us: 100 };
    let drawings = vec![pen()];
    for source in [99, 101, 10000, 0] {
        assert!(evaluate_drawings(&anchor, &drawings, source).is_empty());
    }
    assert_eq!(evaluate_drawings(&anchor, &drawings, 100), drawings);
    assert!(evaluate_drawings(&anchor, &drawings, 101).is_empty());
    assert_eq!(evaluate_drawings(&anchor, &drawings, 100), drawings);
}

#[test]
fn drawing_validation_rejects_bad_geometry_and_duplicate_ids() {
    let fixture = Fixture::new();
    let mut draft = fixture.draft("drawings");
    draft["drawings"] = json!([pen()]);
    fixture.save(draft.clone());
    for (field, invalid) in [("x", json!(-1)), ("y", json!(1_000_001))] {
        let mut bad = draft.clone();
        bad["drawings"][0]["samples"][0][field] = invalid;
        failure(fixture.root(), json!({"command":"save_draft", "draft":bad}));
    }
    let mut bad = draft.clone();
    bad["drawings"] = json!([pen(), pen()]);
    assert!(
        failure(fixture.root(), json!({"command":"save_draft","draft":bad}))
            .contains("Duplicate drawing")
    );
    let mut bad = draft.clone();
    bad["drawings"][0]["tool"] = json!("arrow");
    assert!(
        failure(fixture.root(), json!({"command":"save_draft","draft":bad}))
            .contains("two samples")
    );
    fixture.named("Maya");
    let posted = fixture.post("drawings");
    assert_eq!(posted["drawings"], draft["drawings"]);
    assert_eq!(posted["schema_version"], 2);
    assert_eq!(fixture.boot()["comments"], json!([posted]));
}

#[test]
fn runtime_rejects_all_timed_and_color_fields_instead_of_converting_them() {
    let fixture = Fixture::new();
    let mut draft = fixture.draft("static");
    draft["drawings"] = json!([pen()]);
    fixture.save(draft.clone());
    let mut bad = draft.clone();
    bad["anchor"] = json!({"kind":"interval","start_us":100,"end_us":200});
    failure(fixture.root(), json!({"command":"save_draft","draft":bad}));
    for (key, value) in [
        ("color", json!("#FFFFFF")),
        ("visible_from_us", json!(0)),
        ("visible_until_us", json!(100)),
    ] {
        let mut bad = draft.clone();
        bad["drawings"][0][key] = value;
        failure(fixture.root(), json!({"command":"save_draft","draft":bad}));
    }
    let mut bad = draft.clone();
    bad["drawings"][0]["samples"][0]["t_us"] = json!(0);
    failure(fixture.root(), json!({"command":"save_draft","draft":bad}));
    failure(
        fixture.root(),
        json!({"command":"set_preferences","keybindings":{},"pause_after_drawing":false}),
    );
    assert_eq!(fixture.boot()["drafts"], json!([draft]));
}

#[test]
fn request_validation_rejects_duplicate_keys_unknown_fields_and_unsafe_numbers() {
    let fixture = Fixture::new();
    for raw in [
        r#"{"command":"bootstrap","command":"bootstrap"}"#,
        r#"{"command":"bootstrap","extra":true}"#,
        r#"{"command":"set_profile","name":"Maya","name":"Other"}"#,
    ] {
        let response: Value =
            serde_json::from_str(&dispatch(fixture.root().to_str().unwrap(), raw)).unwrap();
        assert_eq!(response["ok"], false, "{response}");
    }
    let nested_duplicate = format!(
        r#"{{"command":"save_draft","draft":{{"id":"duplicate","project_id":"{}","video_id":"{}","text":"hello","anchor":{{"kind":"point","at_us":0,"at_us":1}},"drawings":[]}}}}"#,
        fixture.project,
        fixture.video["id"].as_str().unwrap()
    );
    let response: Value = serde_json::from_str(&dispatch(
        fixture.root().to_str().unwrap(),
        &nested_duplicate,
    ))
    .unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"]
        .as_str()
        .unwrap()
        .contains("Duplicate JSON key"));
    let mut draft = fixture.draft("unsafe");
    draft["anchor"]["at_us"] = json!(9_007_199_254_740_992i64);
    failure(
        fixture.root(),
        json!({"command":"save_draft","draft":draft}),
    );
    let mut draft = fixture.draft("unknown");
    draft["unexpected"] = json!(true);
    failure(
        fixture.root(),
        json!({"command":"save_draft","draft":draft}),
    );
    let mut draft = fixture.draft("bounds");
    draft["anchor"]["at_us"] = json!(20_000_001);
    failure(
        fixture.root(),
        json!({"command":"save_draft","draft":draft}),
    );
}

#[test]
fn late_metadata_cannot_invalidate_posts_in_other_project_memberships() {
    let fixture = Fixture::new();
    fixture.named("Maya");
    let project = success(
        fixture.root(),
        json!({"command":"create_project","title":"Second"}),
    );
    let video = success(
        fixture.root(),
        json!({"command":"import_video","path":fixture.source.path().join("clip.mp4"),"project_id":project["id"]}),
    );
    let mut draft = fixture.draft("other-membership");
    draft["project_id"] = project["id"].clone();
    draft["video_id"] = video["id"].clone();
    fixture.save(draft);
    fixture.post("other-membership");
    assert!(failure(fixture.root(),json!({"command":"update_video_metadata","video_id":fixture.video["id"],"duration_us":100,"width":1920,"height":1080})).contains("posted anchor"));
    assert_eq!(fixture.boot()["videos"][0]["duration_us"], 20_000_000);
}

#[cfg(unix)]
#[test]
fn storage_symlinks_cannot_redirect_managed_writes() {
    let directory = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    std::os::unix::fs::symlink(outside.path(), directory.path().join("media")).unwrap();
    assert!(failure(directory.path(), json!({"command":"bootstrap"})).contains("symlink"));
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
}

#[test]
fn preferences_persist_and_reject_conflicts_without_partial_writes() {
    let fixture = Fixture::new();
    let save = |bindings| {
        request(
            fixture.root(),
            json!({"command":"set_preferences","keybindings":bindings}),
        )
    };
    assert_eq!(save(json!({"play":"Shift+P"}))["ok"], true);
    assert_eq!(fixture.boot()["settings"]["keybindings"]["play"], "Shift+P");
    for invalid in [
        json!({"play":"J"}),
        json!({"play":"Mod+Q"}),
        json!({"play":"Escape"}),
        json!({"submit":"P"}),
        json!({"missing":"U"}),
        json!({"play":"Shift+Mod+U"}),
    ] {
        assert_eq!(save(invalid)["ok"], false);
        assert_eq!(fixture.boot()["settings"]["keybindings"]["play"], "Shift+P");
    }
    assert_eq!(save(json!({"play":"P", "pen":null}))["ok"], true);
    success(
        fixture.root(),
        json!({"command":"set_theme","theme":"dark"}),
    );
    assert_eq!(fixture.boot()["settings"]["keybindings"]["play"], "P");
    assert_eq!(save(json!({}))["ok"], true);
}

#[test]
fn deleting_scope_removes_threads_and_drafts_but_preserves_other_projects() {
    let fixture = Fixture::new();
    fixture.named("Reviewer");
    fixture.save(fixture.draft("parent"));
    fixture.post("parent");
    let mut reply = fixture.draft("reply");
    reply["parent_comment_id"] = json!("parent");
    fixture.save(reply);
    fixture.post("reply");
    fixture.save(fixture.draft("unfinished"));
    let other = success(
        fixture.root(),
        json!({"command":"create_project","title":"Other"}),
    );
    let shared = success(
        fixture.root(),
        json!({"command":"import_video","project_id":other["id"],"path":fixture.source.path().join("clip.mp4")}),
    );
    success(
        fixture.root(),
        json!({"command":"delete_video","video_id":fixture.video["id"]}),
    );
    let state = fixture.boot();
    assert_eq!(state["comments"], json!([]));
    assert_eq!(state["drafts"], json!([]));
    assert_eq!(state["videos"].as_array().unwrap().len(), 1);
    assert_eq!(
        success(
            fixture.root(),
            json!({"command":"verify_video","video_id":shared["id"]})
        )["valid"],
        true
    );
    assert!(fixture.source.path().join("clip.mp4").exists());
    let db = Connection::open(fixture.root().join("gamepack.sqlite3")).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name='comments_no_delete'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    success(
        fixture.root(),
        json!({"command":"delete_project","project_id":other["id"]}),
    );
    success(
        fixture.root(),
        json!({"command":"delete_project","project_id":fixture.project}),
    );
    assert_eq!(fixture.boot()["projects"], json!([]));
    failure(
        fixture.root(),
        json!({"command":"delete_project","project_id":fixture.project}),
    );
}

fn legacy_record(fixture: &Fixture, id: &str, parent: Option<&str>, end: i64) -> Value {
    let mut draft = fixture.draft(id);
    draft["parent_comment_id"] = json!(parent);
    fixture.save(draft);
    let mut record = fixture.post(id);
    record["schema_version"] = json!(1);
    record["anchor"] = json!({"kind":"interval","start_us":100,"end_us":end});
    record["drawings"] = json!([{"id":"old-pen","tool":"pen","color":"#FF0000","width":3500,
        "visible_from_us":0,"visible_until_us":end-100,
        "samples":[{"x":100000,"y":200000,"t_us":0},{"x":800000,"y":700000,"t_us":20}]}]);
    record.as_object_mut().unwrap().remove("digest");
    record["digest"] = json!(blake3::hash(&serde_json::to_vec(&record).unwrap())
        .to_hex()
        .to_string());
    record
}

fn install_legacy(fixture: &Fixture, records: &[Value]) {
    let db = Connection::open(fixture.root().join("gamepack.sqlite3")).unwrap();
    db.execute_batch("DROP TRIGGER comments_no_update; ALTER TABLE preferences ADD COLUMN pause_after_drawing INTEGER NOT NULL DEFAULT 0;").unwrap();
    for record in records {
        db.execute(
            "UPDATE comments SET body=?1,digest=?2 WHERE id=?3",
            rusqlite::params![
                record.to_string(),
                record["digest"].as_str().unwrap(),
                record["comment_id"].as_str().unwrap()
            ],
        )
        .unwrap();
    }
    db.execute_batch("CREATE TRIGGER comments_no_update BEFORE UPDATE ON comments BEGIN SELECT RAISE(ABORT,'Posted comments are immutable'); END; PRAGMA user_version=5;").unwrap();
}

#[test]
fn v6_migration_freezes_geometry_keeps_threads_and_archives_original_records_once() {
    let fixture = Fixture::new();
    fixture.named("Coach");
    let root = legacy_record(&fixture, "root", None, 5000000);
    let reply = legacy_record(&fixture, "reply", Some("root"), 7000000);
    let mut pending = fixture.draft("pending");
    pending["parent_comment_id"] = json!("reply");
    fixture.save(pending);
    install_legacy(&fixture, &[root.clone(), reply.clone()]);
    let migrated = fixture.boot();
    for record in migrated["comments"].as_array().unwrap() {
        assert_eq!(record["schema_version"], 2);
        assert_eq!(record["anchor"], json!({"kind":"point","at_us":4999999}));
        assert_eq!(
            record["drawings"][0]["samples"],
            json!([{"x":100000,"y":200000},{"x":800000,"y":700000}])
        );
        assert!(record["drawings"][0].get("color").is_none());
        assert!(record["drawings"][0].get("visible_until_us").is_none());
        let mut canonical = record.clone();
        canonical.as_object_mut().unwrap().remove("digest");
        assert_eq!(
            record["digest"],
            blake3::hash(&serde_json::to_vec(&canonical).unwrap())
                .to_hex()
                .to_string()
        );
    }
    assert_eq!(
        migrated["drafts"][0]["anchor"],
        migrated["comments"][0]["anchor"]
    );
    assert!(migrated["settings"].get("pause_after_drawing").is_none());
    assert_eq!(fixture.boot()["comments"], migrated["comments"]);
    let db = Connection::open(fixture.root().join("gamepack.sqlite3")).unwrap();
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM review_v1_archive", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
    for record in [root, reply] {
        let (body, digest): (String, String) = db
            .query_row(
                "SELECT body,digest FROM review_v1_archive WHERE comment_id=?1",
                [record["comment_id"].as_str().unwrap()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(serde_json::from_str::<Value>(&body).unwrap(), record);
        assert_eq!(digest, record["digest"].as_str().unwrap());
    }
    assert!(db
        .execute("UPDATE comments SET body='changed'", [])
        .is_err());
    assert_eq!(
        db.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
}

#[test]
fn failed_migration_rolls_back_records_archive_version_and_immutability_guard() {
    let fixture = Fixture::new();
    fixture.named("Coach");
    let mut old = legacy_record(&fixture, "root", None, 5000000);
    old["drawings"][0]["samples"] = json!([{"x":"corrupt","y":0,"t_us":0}]);
    install_legacy(&fixture, &[old.clone()]);
    failure(fixture.root(), json!({"command":"bootstrap"}));
    let db = Connection::open(fixture.root().join("gamepack.sqlite3")).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        5
    );
    assert_eq!(
        db.query_row("SELECT body FROM comments", [], |r| r.get::<_, String>(0))
            .unwrap(),
        old.to_string()
    );
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM review_v1_archive", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert!(db
        .execute("UPDATE comments SET body='changed'", [])
        .is_err());
}

#[test]
fn play_samples_are_bounded_ordered_and_persist_with_their_conversation() {
    let fixture = Fixture::new();
    fixture.named("Maya");
    let mut draft = fixture.draft("play");
    draft["anchor"] = json!({"kind":"play","at_us":1_000_000,"end_us":5_000_000});
    draft["drawings"] = json!([{"id":"ink","tool":"pen","width":3500,"samples":[
        {"x":0,"y":0,"t_us":1_000_000},{"x":50,"y":100,"t_us":3_000_000},{"x":100,"y":200,"t_us":3_000_000}
    ]}]);
    fixture.save(draft.clone());
    for invalid in [
        json!(-1),
        json!(999_999),
        json!(5_000_001),
        json!(null),
        json!(1.5),
        json!(9_007_199_254_740_992i64),
    ] {
        let mut bad = draft.clone();
        bad["drawings"][0]["samples"][0]["t_us"] = invalid;
        failure(fixture.root(), json!({"command":"save_draft","draft":bad}));
    }
    let mut bad = draft.clone();
    bad["drawings"][0]["samples"][2]["t_us"] = json!(2_000_000);
    failure(fixture.root(), json!({"command":"save_draft","draft":bad}));
    for end in [0, 999_999, 20_000_001, 9_007_199_254_740_992i64] {
        let mut bad = draft.clone();
        bad["anchor"]["end_us"] = json!(end);
        failure(fixture.root(), json!({"command":"save_draft","draft":bad}));
    }
    let posted = fixture.post("play");
    assert_eq!(posted["schema_version"], 3);
    assert_eq!(posted["drawings"], draft["drawings"]);
    assert_eq!(fixture.boot()["comments"], json!([posted.clone()]));
    let mut canonical = posted.clone();
    canonical.as_object_mut().unwrap().remove("digest");
    assert_eq!(
        posted["digest"],
        blake3::hash(&serde_json::to_vec(&canonical).unwrap())
            .to_hex()
            .as_str()
    );
    let mut reply = fixture.draft("play-reply");
    reply["parent_comment_id"] = json!("play");
    reply["anchor"] = draft["anchor"].clone();
    fixture.save(reply.clone());
    fixture.post("play-reply");
    reply["id"] = json!("invalid-reply");
    reply["anchor"]["end_us"] = json!(4_000_000);
    failure(
        fixture.root(),
        json!({"command":"save_draft","draft":reply}),
    );
}

#[test]
fn timed_ink_reconstructs_pauses_interpolation_and_backward_seeks() {
    let anchor = Anchor::Play {
        at_us: 100,
        end_us: 400,
    };
    let mut drawing = pen();
    drawing.samples = vec![
        Sample {
            x: 0,
            y: 0,
            t_us: Some(100),
        },
        Sample {
            x: 10,
            y: 20,
            t_us: Some(200),
        },
        Sample {
            x: 30,
            y: 40,
            t_us: Some(200),
        },
        Sample {
            x: 50,
            y: 60,
            t_us: Some(400),
        },
    ];
    let drawings = vec![drawing];
    assert!(evaluate_drawings(&anchor, &drawings, 99).is_empty());
    let half = evaluate_drawings(&anchor, &drawings, 150);
    assert_eq!(
        half[0].samples.last().unwrap(),
        &Sample {
            x: 5,
            y: 10,
            t_us: Some(150)
        }
    );
    assert_eq!(
        evaluate_drawings(&anchor, &drawings, 200)[0].samples.len(),
        3
    );
    assert_eq!(evaluate_drawings(&anchor, &drawings, 400), drawings);
    assert!(evaluate_drawings(&anchor, &drawings, 401).is_empty());
    assert_eq!(
        evaluate_drawings(&anchor, &drawings, 100)[0].samples.len(),
        1
    );
    assert_eq!(drawings[0].samples.len(), 4);
}

#[test]
fn v7_upgrade_keeps_v2_bytes_and_digests_and_rejects_future_databases() {
    let fixture = Fixture::new();
    fixture.named("Maya");
    fixture.save(fixture.draft("moment"));
    fixture.post("moment");
    let db = Connection::open(fixture.root().join("gamepack.sqlite3")).unwrap();
    let before: String = db
        .query_row("SELECT body FROM comments", [], |r| r.get(0))
        .unwrap();
    db.execute_batch("PRAGMA user_version=6;").unwrap();
    drop(db);
    fixture.boot();
    let db = Connection::open(fixture.root().join("gamepack.sqlite3")).unwrap();
    let after: String = db
        .query_row("SELECT body FROM comments", [], |r| r.get(0))
        .unwrap();
    assert_eq!(before, after);
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        7
    );
    db.execute_batch("PRAGMA user_version=8;").unwrap();
    drop(db);
    assert!(failure(fixture.root(), json!({"command":"bootstrap"})).contains("newer GamePack"));
}

#[test]
fn annotation_speed_is_validated_persisted_and_migrates_without_changing_reviews() {
    let fixture = Fixture::new();
    let before = fixture.boot();
    let db = Connection::open(fixture.root().join("gamepack.sqlite3")).unwrap();
    db.execute_batch("DROP TABLE playback_preferences;")
        .unwrap();
    drop(db);
    let migrated = fixture.boot();
    assert_eq!(migrated["settings"]["annotation_speed_percent"], 50);
    assert_eq!(migrated["videos"], before["videos"]);
    assert_eq!(migrated["profile"], before["profile"]);
    for speed in [25, 50, 75, 100, 200, 400] {
        let saved = success(
            fixture.root(),
            json!({"command":"set_preferences","keybindings":{},"annotation_speed_percent":speed}),
        );
        assert_eq!(saved["annotation_speed_percent"], speed);
        assert_eq!(fixture.boot()["settings"], saved);
    }
    for invalid in [
        json!(0),
        json!(-50),
        json!(150),
        json!(65536),
        json!(0.5),
        json!("50"),
        json!(true),
    ] {
        failure(
            fixture.root(),
            json!({"command":"set_preferences","keybindings":{"play":"Shift+P"},"annotation_speed_percent":invalid}),
        );
        assert_eq!(fixture.boot()["settings"]["annotation_speed_percent"], 400);
        assert_eq!(fixture.boot()["settings"]["keybindings"], json!({}));
    }
    // An older client updating shortcuts must retain the new speed preference.
    success(
        fixture.root(),
        json!({"command":"set_preferences","keybindings":{"play":"Shift+P"}}),
    );
    assert_eq!(fixture.boot()["settings"]["annotation_speed_percent"], 400);
    failure(
        fixture.root(),
        json!({"command":"set_preferences","keybindings":{"unknown":"Q"},"annotation_speed_percent":50}),
    );
    assert_eq!(fixture.boot()["settings"]["annotation_speed_percent"], 400);
    assert_eq!(fixture.boot()["settings"]["keybindings"]["play"], "Shift+P");
}
