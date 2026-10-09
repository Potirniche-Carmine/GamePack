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

struct Library {
    home: TempDir,
    source: TempDir,
    project: Value,
    video: Value,
}

impl Library {
    fn new() -> Self {
        let home = TempDir::new().unwrap();
        let source = TempDir::new().unwrap();
        fs::write(source.path().join("game.mp4"), b"unchanged media bytes").unwrap();
        let project = success(home.path(), json!({"command":"bootstrap"}))["projects"][0].clone();
        let video = success(
            home.path(),
            json!({"command":"import_video", "project_id":project["id"], "path":source.path().join("game.mp4")}),
        );
        success(
            home.path(),
            json!({"command":"set_profile", "name":"Maya Chen"}),
        );
        success(
            home.path(),
            json!({"command":"save_draft", "draft":{"id":"note-1", "project_id":project["id"], "video_id":video["id"], "text":"Keep this note", "anchor":{"kind":"point", "at_us":0}, "drawings":[]}}),
        );
        success(
            home.path(),
            json!({"command":"post_draft", "draft_id":"note-1"}),
        );
        Self {
            home,
            source,
            project,
            video,
        }
    }

    fn root(&self) -> &Path {
        self.home.path()
    }
    fn boot(&self) -> Value {
        success(self.root(), json!({"command":"bootstrap"}))
    }
    fn folder(&self, title: &str) -> Value {
        success(
            self.root(),
            json!({"command":"create_folder", "project_id":self.project["id"], "title":title}),
        )
    }
}

#[test]
fn folder_moves_rename_and_removal_preserve_media_and_immutable_comments() {
    let library = Library::new();
    let original = library.boot();
    let folder = library.folder("  First half  ");
    assert_eq!(folder["title"], "First half");
    let moved = success(
        library.root(),
        json!({"command":"move_video", "video_id":library.video["id"], "folder_id":folder["id"]}),
    );
    assert_eq!(moved["folder_id"], folder["id"]);
    assert_eq!(moved["id"], library.video["id"]);
    assert_eq!(moved["path"], library.video["path"]);
    assert_eq!(library.boot()["comments"], original["comments"]);
    let renamed = success(
        library.root(),
        json!({"command":"rename_folder", "folder_id":folder["id"], "title":"  Attacking phases  "}),
    );
    assert_eq!(renamed["title"], "Attacking phases");
    assert_eq!(renamed["created_at"], folder["created_at"]);
    assert_eq!(library.boot()["folders"], json!([renamed]));

    // Deduplication does not reset the placement of an existing video.
    let reimported = success(
        library.root(),
        json!({"command":"import_video", "project_id":library.project["id"], "path":library.source.path().join("game.mp4")}),
    );
    assert_eq!(reimported["folder_id"], folder["id"]);
    let root_video = success(
        library.root(),
        json!({"command":"move_video", "video_id":library.video["id"], "folder_id":null}),
    );
    assert!(root_video["folder_id"].is_null());
    success(
        library.root(),
        json!({"command":"move_video", "video_id":library.video["id"], "folder_id":folder["id"]}),
    );
    success(
        library.root(),
        json!({"command":"delete_folder", "folder_id":folder["id"]}),
    );
    let final_state = library.boot();
    assert_eq!(final_state["folders"], json!([]));
    assert_eq!(final_state["videos"], original["videos"]);
    assert_eq!(final_state["comments"], original["comments"]);
    assert_eq!(
        fs::read(library.video["path"].as_str().unwrap()).unwrap(),
        b"unchanged media bytes"
    );
}

#[test]
fn folders_enforce_project_boundaries_and_invalid_changes_are_atomic() {
    let library = Library::new();
    let folder = library.folder("First half");
    let other = success(
        library.root(),
        json!({"command":"create_project", "title":"Other game"}),
    );
    let other_folder = success(
        library.root(),
        json!({"command":"create_folder", "project_id":other["id"], "title":"First half"}),
    );
    let before = library.boot();
    for command in [
        json!({"command":"move_video", "video_id":library.video["id"], "folder_id":other_folder["id"]}),
        json!({"command":"move_video", "video_id":library.video["id"], "folder_id":"missing-folder"}),
        json!({"command":"move_video", "video_id":"missing-video", "folder_id":folder["id"]}),
        json!({"command":"create_folder", "project_id":"missing-project", "title":"Orphan"}),
        json!({"command":"create_folder", "project_id":library.project["id"], "title":" \t "}),
        json!({"command":"rename_folder", "folder_id":folder["id"], "title":"Bad\nname"}),
        json!({"command":"rename_folder", "folder_id":"missing-folder", "title":"New name"}),
        json!({"command":"delete_folder", "folder_id":"missing-folder"}),
        json!({"command":"rename_project", "project_id":library.project["id"], "title":""}),
    ] {
        assert_eq!(request(library.root(), command)["ok"], false);
    }
    let after = library.boot();
    for collection in ["projects", "folders", "videos", "comments"] {
        assert_eq!(after[collection], before[collection]);
    }

    let db = Connection::open(library.root().join("gamepack.sqlite3")).unwrap();
    assert!(db
        .execute(
            "UPDATE videos SET folder_id=?1 WHERE id=?2",
            [
                other_folder["id"].as_str().unwrap(),
                library.video["id"].as_str().unwrap()
            ]
        )
        .is_err());
    assert!(db
        .execute(
            "UPDATE folders SET project_id=?1 WHERE id=?2",
            [
                other["id"].as_str().unwrap(),
                folder["id"].as_str().unwrap()
            ]
        )
        .is_err());
    assert!(db
        .execute("UPDATE comments SET body='changed'", [])
        .is_err());
}

#[test]
fn project_rename_preserves_identity_and_project_removal_cleans_its_folders_only() {
    let library = Library::new();
    library.folder("First half");
    let other = success(
        library.root(),
        json!({"command":"create_project", "title":"Other game"}),
    );
    let other_folder = success(
        library.root(),
        json!({"command":"create_folder", "project_id":other["id"], "title":"First half"}),
    );
    let renamed = success(
        library.root(),
        json!({"command":"rename_project", "project_id":library.project["id"], "title":"  Season review  "}),
    );
    assert_eq!(renamed["id"], library.project["id"]);
    assert_eq!(renamed["created_at"], library.project["created_at"]);
    assert_eq!(renamed["title"], "Season review");
    success(
        library.root(),
        json!({"command":"delete_project", "project_id":library.project["id"]}),
    );
    let state = library.boot();
    assert_eq!(state["projects"], json!([other]));
    assert_eq!(state["folders"], json!([other_folder]));
    assert_eq!(state["videos"], json!([]));
    assert_eq!(state["comments"], json!([]));
}

#[test]
fn pre_folder_library_migrates_without_changing_existing_records() {
    let library = Library::new();
    let before = library.boot();
    let db = Connection::open(library.root().join("gamepack.sqlite3")).unwrap();
    // Reconstruct the v3 schema, including a real videos table without folder_id.
    db.execute_batch("DROP TRIGGER videos_folder_insert; DROP TRIGGER videos_folder_update; DROP TRIGGER folders_project_update; DROP INDEX videos_folder; ALTER TABLE videos DROP COLUMN folder_id; DROP TABLE folders; PRAGMA user_version=3;").unwrap();
    drop(db);
    let after = library.boot();
    for collection in [
        "profile", "projects", "videos", "comments", "drafts", "settings",
    ] {
        assert_eq!(after[collection], before[collection]);
    }
    assert_eq!(after["folders"], json!([]));
    assert!(after["videos"][0]["folder_id"].is_null());
    let folder = library.folder("Second half");
    success(
        library.root(),
        json!({"command":"move_video", "video_id":library.video["id"], "folder_id":folder["id"]}),
    );
    assert_eq!(library.boot()["videos"][0]["folder_id"], folder["id"]);
    let db = Connection::open(library.root().join("gamepack.sqlite3")).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        4
    );
}
