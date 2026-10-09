use gamepack_core::dispatch;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn request(root: &Path, command: Value) -> Value {
    serde_json::from_str(&dispatch(root.to_str().unwrap(), &command.to_string())).unwrap()
}

fn success(root: &Path, command: Value) -> Value {
    let result = request(root, command);
    assert_eq!(result["ok"], true, "{result}");
    result["data"].clone()
}

struct Review {
    home: TempDir,
    draft: Value,
}

impl Review {
    fn new() -> Self {
        let home = TempDir::new().unwrap();
        let source = TempDir::new().unwrap();
        fs::write(source.path().join("clip.mp4"), b"original video").unwrap();
        let project = success(home.path(), json!({"command":"bootstrap"}))["projects"][0].clone();
        let video = success(
            home.path(),
            json!({"command":"import_video", "project_id":project["id"], "path":source.path().join("clip.mp4")}),
        );
        success(
            home.path(),
            json!({"command":"set_profile", "name":"Alex Chen"}),
        );
        let draft = json!({"id":"note", "project_id":project["id"], "video_id":video["id"], "text":"Keep the runner in frame.", "anchor":{"kind":"point", "at_us":0}, "parent_comment_id":null, "drawings":[]});
        Self { home, draft }
    }

    fn root(&self) -> &Path {
        self.home.path()
    }

    fn save(&self, draft: Value) -> Value {
        success(self.root(), json!({"command":"save_draft", "draft":draft}))
    }

    fn post(&self) -> Value {
        success(
            self.root(),
            json!({"command":"post_draft", "draft_id":"note"}),
        )
    }

    fn boot(&self) -> Value {
        success(self.root(), json!({"command":"bootstrap"}))
    }

    fn stored_comment(&self) -> (String, String) {
        Connection::open(self.root().join("gamepack.sqlite3"))
            .unwrap()
            .query_row(
                "SELECT body,digest FROM comments WHERE id='note'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap()
    }
}

#[test]
fn positions_persist_across_save_post_move_and_reopen_without_rewriting_review_content() {
    let review = Review::new();
    let mut draft = review.draft.clone();
    draft["position"] = json!({"x":0.25, "y":0.625});
    assert_eq!(review.save(draft.clone()), draft);
    assert_eq!(review.boot()["drafts"], json!([draft.clone()]));

    let posted = review.post();
    assert_eq!(posted["position"], draft["position"]);
    assert_eq!(review.boot()["comments"], json!([posted.clone()]));
    assert_eq!(review.post(), posted);
    let (body, digest) = review.stored_comment();
    let mut canonical: Value = serde_json::from_str(&body).unwrap();
    assert!(canonical.get("position").is_none());
    canonical.as_object_mut().unwrap().remove("digest");
    assert_eq!(
        digest,
        blake3::hash(&serde_json::to_vec(&canonical).unwrap())
            .to_hex()
            .to_string()
    );

    for position in [json!({"x":1, "y":0}), json!({"x":0.7345, "y":0.381})] {
        let moved = success(
            review.root(),
            json!({"command":"move_comment", "comment_id":"note", "position":position}),
        );
        let mut expected = posted.clone();
        expected["position"] = json!({"x":position["x"].as_f64(), "y":position["y"].as_f64()});
        assert_eq!(moved, expected);
        assert_eq!(review.boot()["comments"], json!([expected.clone()]));
        assert_eq!(review.post(), expected);
        assert_eq!(review.stored_comment(), (body.clone(), digest.clone()));
    }

    let db = Connection::open(review.root().join("gamepack.sqlite3")).unwrap();
    assert!(db
        .execute("UPDATE comments SET body='changed'", [])
        .is_err());
    assert!(db
        .execute("UPDATE comments SET digest='changed'", [])
        .is_err());
    assert!(db.execute("DELETE FROM comments", []).is_err());
}

#[test]
fn invalid_positions_cannot_change_a_draft_or_posted_placement() {
    let review = Review::new();
    review.save(review.draft.clone());
    let posted = review.post();
    let mut other_draft = review.draft.clone();
    other_draft["id"] = json!("other-draft");
    review.save(other_draft.clone());

    for position in [
        json!({"x":-0.001, "y":0.5}),
        json!({"x":0.5, "y":1.00001}),
        json!({"x":1e100, "y":0.5}),
        json!({"x":"0.5", "y":0.5}),
        json!({"x":null, "y":0.5}),
        json!({"x":0.5}),
        json!({"x":0.5, "y":0.5, "z":0}),
    ] {
        assert_eq!(
            request(
                review.root(),
                json!({"command":"move_comment", "comment_id":"note", "position":position})
            )["ok"],
            false
        );
        let mut invalid_draft = other_draft.clone();
        invalid_draft["position"] = position;
        assert_eq!(
            request(
                review.root(),
                json!({"command":"save_draft", "draft":invalid_draft})
            )["ok"],
            false
        );
    }
    for command in [
        json!({"command":"move_comment", "comment_id":"missing", "position":{"x":0.5,"y":0.5}}),
        json!({"command":"move_comment", "comment_id":"note", "position":null}),
        json!({"command":"move_comment", "comment_id":"note", "position":{"x":0.5,"y":0.5}, "text":"changed"}),
    ] {
        assert_eq!(request(review.root(), command)["ok"], false);
    }
    for x in ["NaN", "Infinity", "1e9999"] {
        let result: Value = serde_json::from_str(&dispatch(
            review.root().to_str().unwrap(),
            &format!(
                r#"{{"command":"move_comment","comment_id":"note","position":{{"x":{x},"y":0.5}}}}"#
            ),
        ))
        .unwrap();
        assert_eq!(result["ok"], false);
    }
    assert_eq!(review.boot()["comments"], json!([posted]));
    assert_eq!(review.boot()["drafts"], json!([other_draft]));
    let db = Connection::open(review.root().join("gamepack.sqlite3")).unwrap();
    assert!(db
        .execute("INSERT INTO comment_positions VALUES('note',2,0.5)", [])
        .is_err());
}

#[test]
fn v4_migration_preserves_legacy_json_and_adds_movable_positions() {
    let review = Review::new();
    review.save(review.draft.clone());
    review.post();
    let mut pending = review.draft.clone();
    pending["id"] = json!("pending");
    review.save(pending);
    let before = review.boot();
    let original = review.stored_comment();
    let db = Connection::open(review.root().join("gamepack.sqlite3")).unwrap();
    db.execute_batch("DROP TABLE comment_positions; PRAGMA user_version=4;")
        .unwrap();
    drop(db);

    let after = review.boot();
    for key in [
        "profile", "settings", "projects", "folders", "videos", "comments", "drafts",
    ] {
        assert_eq!(after[key], before[key]);
    }
    assert!(after["comments"][0].get("position").is_none());
    assert!(after["drafts"][0].get("position").is_none());
    assert_eq!(review.stored_comment(), original);
    success(
        review.root(),
        json!({"command":"move_comment", "comment_id":"note", "position":{"x":0.2, "y":0.3}}),
    );
    let db = Connection::open(review.root().join("gamepack.sqlite3")).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        5
    );
    assert_eq!(
        db.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
    assert_eq!(review.stored_comment(), original);
}

#[test]
fn deleting_a_library_scope_removes_its_local_comment_positions() {
    for delete_project in [false, true] {
        let review = Review::new();
        let mut draft = review.draft.clone();
        draft["position"] = json!({"x":0.2,"y":0.3});
        review.save(draft);
        review.post();
        let command = if delete_project {
            json!({"command":"delete_project", "project_id":review.draft["project_id"]})
        } else {
            json!({"command":"delete_video", "video_id":review.draft["video_id"]})
        };
        success(review.root(), command);
        assert_eq!(review.boot()["comments"], json!([]));
        let db = Connection::open(review.root().join("gamepack.sqlite3")).unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM comment_positions", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
