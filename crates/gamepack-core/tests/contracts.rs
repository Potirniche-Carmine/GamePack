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
        color: "#FF4400".into(),
        width: 4000,
        visible_from_us: 2,
        visible_until_us: 9,
        samples: vec![
            Sample {
                x: 0,
                y: 0,
                t_us: 2,
            },
            Sample {
                x: 5,
                y: 5,
                t_us: 4,
            },
            Sample {
                x: 10,
                y: 10,
                t_us: 4,
            },
            Sample {
                x: 20,
                y: 20,
                t_us: 7,
            },
        ],
    }
}

#[test]
fn evaluator_reconstructs_prefix_on_seek_and_uses_exclusive_ends() {
    let anchor = Anchor::Interval {
        start_us: 100,
        end_us: 110,
    };
    let drawings = vec![pen()];
    for source in [99, 100, 101, 109, 110, 111] {
        assert!(evaluate_drawings(&anchor, &drawings, source).is_empty());
    }
    assert_eq!(
        evaluate_drawings(&anchor, &drawings, 102)[0].samples.len(),
        1
    );
    assert_eq!(
        evaluate_drawings(&anchor, &drawings, 104)[0].samples.len(),
        3
    );
    assert_eq!(
        evaluate_drawings(&anchor, &drawings, 108)[0].samples.len(),
        4
    );
    assert_eq!(
        evaluate_drawings(&anchor, &drawings, 102)[0].samples.len(),
        1
    );
    let mut shape = pen();
    shape.tool = Tool::Arrow;
    shape.samples.truncate(2);
    assert_eq!(
        evaluate_drawings(&anchor, &[shape], 102)[0].samples.len(),
        2
    );
    let point = Anchor::Point { at_us: 100 };
    assert_eq!(evaluate_drawings(&point, &drawings, 100), drawings);
    assert!(evaluate_drawings(&point, &drawings, 101).is_empty());
}

#[test]
fn drawing_validation_rejects_bad_geometry_bounds_order_and_duplicate_ids() {
    let fixture = Fixture::new();
    let mut draft = fixture.draft("drawings");
    draft["anchor"] = json!({"kind":"interval","start_us":100,"end_us":110});
    draft["drawings"] = json!([pen()]);
    fixture.save(draft.clone());
    for (field, invalid) in [
        ("x", json!(-1)),
        ("y", json!(1_000_001)),
        ("t_us", json!(10)),
    ] {
        let mut bad = draft.clone();
        bad["drawings"][0]["samples"][0][field] = invalid;
        failure(fixture.root(), json!({"command":"save_draft","draft":bad}));
    }
    let mut bad = draft.clone();
    bad["drawings"][0]["samples"][1]["t_us"] = json!(1);
    assert!(
        failure(fixture.root(), json!({"command":"save_draft","draft":bad}))
            .contains("nondecreasing")
    );
    let mut bad = draft.clone();
    bad["drawings"] = json!([pen(), pen()]);
    assert!(
        failure(fixture.root(), json!({"command":"save_draft","draft":bad}))
            .contains("Duplicate drawing")
    );
    let mut bad = draft;
    bad["anchor"] = json!({"kind":"point","at_us":100});
    assert!(
        failure(fixture.root(), json!({"command":"save_draft","draft":bad}))
            .contains("visibility must be zero")
    );
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
