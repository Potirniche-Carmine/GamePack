use crate::model::{
    Comment, Draft, Folder, Position, Profile, Project, Request, Settings, Theme, Video,
};
use crate::validation;
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub(crate) struct Store {
    root: PathBuf,
    db: Connection,
}

const SCHEMA: &str = include_str!("../../../schemas/local-v1.sql");

fn now() -> Result<i64> {
    let micros = SystemTime::now().duration_since(UNIX_EPOCH)?.as_micros();
    let value = i64::try_from(micros)?;
    ensure!(
        value <= validation::MAX_SAFE_INTEGER,
        "System timestamp exceeds safe JSON integer range"
    );
    Ok(value)
}

fn id() -> String {
    Uuid::new_v4().to_string()
}
fn value(item: impl Serialize) -> Result<Value> {
    Ok(serde_json::to_value(item)?)
}

fn no_symlink(path: &Path) -> Result<()> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        ensure!(
            !metadata.file_type().is_symlink(),
            "GamePack storage entry must not be a symlink: {}",
            path.display()
        );
    }
    Ok(())
}

fn managed_filename(filename: &str) -> Result<()> {
    let mut components = Path::new(filename).components();
    ensure!(
        matches!(components.next(), Some(Component::Normal(_)))
            && components.next().is_none()
            && !filename.starts_with('.'),
        "Invalid managed media filename in database"
    );
    Ok(())
}

impl Store {
    pub(crate) fn open(root: &str) -> Result<Self> {
        ensure!(!root.is_empty(), "An explicit data directory is required");
        let requested = Path::new(root);
        ensure!(
            requested.is_absolute(),
            "Data directory must be an absolute path"
        );
        fs::create_dir_all(requested).context("Cannot create GamePack data directory")?;
        let root = requested.canonicalize()?;
        for directory in ["media", "cache", "tmp", "config"] {
            no_symlink(&root.join(directory))?;
            fs::create_dir_all(root.join(directory))?;
        }
        let db_path = root.join("gamepack.sqlite3");
        for suffix in [
            "gamepack.sqlite3",
            "gamepack.sqlite3-wal",
            "gamepack.sqlite3-shm",
        ] {
            no_symlink(&root.join(suffix))?;
        }
        let mut db = Connection::open(db_path).context("Cannot open GamePack SQLite database")?;
        db.busy_timeout(Duration::from_secs(10))?;
        db.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
        )?;
        let version: i64 = db.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        ensure!(
            version <= 5,
            "This database was created by a newer GamePack version"
        );
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute_batch(SCHEMA)?;
        if version < 4 {
            // Inspect the column as well as the version so an interrupted older
            // development migration can safely reopen without altering records.
            let has_folder: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info('videos') WHERE name='folder_id')",
                [],
                |row| row.get(0),
            )?;
            if !has_folder {
                tx.execute_batch("ALTER TABLE videos ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;")?;
            }
        }
        tx.execute_batch(include_str!("../../../schemas/local-v4.sql"))?;
        tx.execute_batch(include_str!("../../../schemas/local-v5.sql"))?;
        tx.execute(
            "INSERT OR IGNORE INTO profile(singleton,author_id,name) VALUES(1,?1,'')",
            [id()],
        )?;
        if version == 0 {
            tx.execute("INSERT INTO projects(id,title,created_at) SELECT ?1,'Review library',?2 WHERE NOT EXISTS(SELECT 1 FROM projects)", params![id(), now()?])?;
        }
        tx.execute_batch("INSERT OR IGNORE INTO settings(singleton,theme) VALUES(1,'system'); INSERT OR IGNORE INTO preferences(singleton) VALUES(1); PRAGMA user_version=5;")?;
        tx.commit()?;
        Ok(Self { root, db })
    }

    pub(crate) fn execute(&mut self, request: Request) -> Result<Value> {
        match request {
            Request::Bootstrap {} => self.bootstrap(),
            Request::SetTheme { theme } => {
                self.db.execute(
                    "UPDATE settings SET theme=?1 WHERE singleton=1",
                    [theme.as_str()],
                )?;
                value(self.settings()?)
            }
            Request::SetPreferences {
                keybindings,
                pause_after_drawing,
            } => {
                crate::shortcuts::validate(&keybindings)?;
                self.db.execute("UPDATE preferences SET keybindings=?1,pause_after_drawing=?2 WHERE singleton=1", params![serde_json::to_string(&keybindings)?, pause_after_drawing])?;
                value(self.settings()?)
            }
            Request::DeleteVideo { video_id } => self.delete_scope(&video_id, false),
            Request::DeleteProject { project_id } => self.delete_scope(&project_id, true),
            Request::SetProfile { name } => {
                validation::label(&name, "Display name")?;
                self.db.execute(
                    "UPDATE profile SET name=?1 WHERE singleton=1",
                    [name.trim()],
                )?;
                value(self.profile()?)
            }
            Request::CreateProject { title } => {
                validation::label(&title, "Project title")?;
                let project = Project {
                    id: id(),
                    title: title.trim().into(),
                    created_at: now()?,
                };
                self.db.execute(
                    "INSERT INTO projects(id,title,created_at) VALUES(?1,?2,?3)",
                    params![project.id, project.title, project.created_at],
                )?;
                value(project)
            }
            Request::RenameProject { project_id, title } => {
                validation::identifier(&project_id)?;
                validation::label(&title, "Project title")?;
                self.atomic(|store| {
                    let changed = store.db.execute(
                        "UPDATE projects SET title=?1 WHERE id=?2",
                        params![title.trim(), project_id],
                    )?;
                    ensure!(changed == 1, "Project does not exist");
                    value(store.db.query_row(
                        "SELECT id,title,created_at FROM projects WHERE id=?1",
                        [project_id],
                        |row| {
                            Ok(Project {
                                id: row.get(0)?,
                                title: row.get(1)?,
                                created_at: row.get(2)?,
                            })
                        },
                    )?)
                })
            }
            Request::CreateFolder { project_id, title } => {
                validation::identifier(&project_id)?;
                validation::label(&title, "Folder title")?;
                self.atomic(|store| {
                    let exists: bool = store.db.query_row(
                        "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1)",
                        [&project_id],
                        |row| row.get(0),
                    )?;
                    ensure!(exists, "Project does not exist");
                    let folder = Folder {
                        id: id(),
                        project_id,
                        title: title.trim().into(),
                        created_at: now()?,
                    };
                    store.db.execute(
                        "INSERT INTO folders(id,project_id,title,created_at) VALUES(?1,?2,?3,?4)",
                        params![
                            folder.id,
                            folder.project_id,
                            folder.title,
                            folder.created_at
                        ],
                    )?;
                    value(folder)
                })
            }
            Request::RenameFolder { folder_id, title } => {
                validation::identifier(&folder_id)?;
                validation::label(&title, "Folder title")?;
                self.atomic(|store| {
                    let changed = store.db.execute(
                        "UPDATE folders SET title=?1 WHERE id=?2",
                        params![title.trim(), folder_id],
                    )?;
                    ensure!(changed == 1, "Folder does not exist");
                    value(store.folder(&folder_id)?)
                })
            }
            Request::DeleteFolder { folder_id } => {
                validation::identifier(&folder_id)?;
                let changed = self
                    .db
                    .execute("DELETE FROM folders WHERE id=?1", [folder_id])?;
                ensure!(changed == 1, "Folder does not exist");
                Ok(Value::Null)
            }
            Request::MoveVideo {
                video_id,
                folder_id,
            } => self.atomic(|store| {
                let video = store.video(&video_id)?;
                if let Some(folder_id) = &folder_id {
                    let folder = store.folder(folder_id)?;
                    ensure!(
                        folder.project_id == video.project_id,
                        "A video folder must belong to the same project"
                    );
                }
                store.db.execute(
                    "UPDATE videos SET folder_id=?1 WHERE id=?2",
                    params![folder_id, video_id],
                )?;
                value(store.video(&video_id)?)
            }),
            Request::ImportVideo {
                path,
                project_id,
                duration_us,
                width,
                height,
            } => value(self.import_video(&path, &project_id, duration_us, width, height)?),
            Request::UpdateVideoMetadata {
                video_id,
                duration_us,
                width,
                height,
            } => {
                validation::metadata(duration_us, width, height)?;
                self.atomic(|store| {
                    let video = store.video(&video_id)?;
                    // Metadata discovery must not make already-published anchors invalid.
                    let comments = store.load_comments()?;
                    for comment in comments.iter().filter(|c| c.media_id == video.media_id) {
                        let updated = Video {
                            duration_us,
                            width,
                            height,
                            ..store.video(&comment.draft.video_id)?
                        };
                        validation::draft(&comment.draft, &updated)
                            .context("Discovered video duration conflicts with a posted anchor")?;
                    }
                    store.db.execute(
                        "UPDATE media SET duration_us=?1,width=?2,height=?3 WHERE id=?4",
                        params![duration_us, width, height, video.media_id],
                    )?;
                    value(store.video(&video_id)?)
                })
            }
            Request::SaveDraft { draft } => {
                let video = self.video(&draft.video_id)?;
                validation::draft(&draft, &video)?;
                self.validate_parent(&draft)?;
                self.atomic(|store| {
                ensure!(
                    !store.comment_exists(&draft.id)?,
                    "This draft has already been posted; create a reply or new draft"
                );
                store.db.execute("INSERT INTO drafts(id,project_id,video_id,body) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,video_id=excluded.video_id,body=excluded.body", params![draft.id, draft.project_id, draft.video_id, serde_json::to_string(&draft)?])?;
                value(draft)
                })
            }
            Request::DiscardDraft { draft_id } => {
                validation::identifier(&draft_id)?;
                self.db
                    .execute("DELETE FROM drafts WHERE id=?1", [draft_id])?;
                Ok(Value::Null)
            }
            Request::PostDraft { draft_id } => value(self.post(&draft_id)?),
            Request::MoveComment {
                comment_id,
                position,
            } => {
                validation::identifier(&comment_id)?;
                validation::position(position)?;
                self.atomic(|store| {
                    let mut comment = store
                        .comment(&comment_id)?
                        .context("Comment does not exist")?;
                    store.save_comment_position(&comment_id, position)?;
                    comment.draft.position = Some(position);
                    value(comment)
                })
            }
            Request::VerifyVideo { video_id } => {
                let video = self.video(&video_id)?;
                let valid = match hash_file(Path::new(&video.path)) {
                    Ok((digest, size)) => {
                        format!("blake3:{digest}:{size}") == video.media_id
                            && size == video.byte_size
                    }
                    Err(_) => false,
                };
                Ok(json!({"valid": valid, "path": video.path}))
            }
        }
    }

    fn delete_scope(&self, scope: &str, project: bool) -> Result<Value> {
        validation::identifier(scope)?;
        self.atomic(|store| {
            let table = if project { "projects" } else { "videos" };
            let exists: bool = store.db.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1)"), [scope], |row| row.get(0))?;
            ensure!(exists, "The item no longer exists");
            let column = if project { "project_id" } else { "video_id" };
            // Only this explicit library deletion may remove immutable posts.
            // The write lock and transactional DDL restore the guard on success
            // or rollback. Other connections cannot observe it being absent.
            store.db.execute_batch("DROP TRIGGER comments_no_delete; PRAGMA defer_foreign_keys=ON;")?;
            store.db.execute(&format!("DELETE FROM drafts WHERE {column}=?1"), [scope])?;
            store.db.execute(&format!("DELETE FROM comments WHERE {column}=?1"), [scope])?;
            if project {
                store.db.execute("DELETE FROM videos WHERE project_id=?1", [scope])?;
                store.db.execute("DELETE FROM folders WHERE project_id=?1", [scope])?;
            }
            store.db.execute(&format!("DELETE FROM {table} WHERE id=?1"), [scope])?;
            store.db.execute_batch("CREATE TRIGGER comments_no_delete BEFORE DELETE ON comments BEGIN SELECT RAISE(ABORT,'Posted comments are immutable'); END;")?;
            // Content-addressed media remains available for re-import and for
            // references in other projects. Never touch users' source files.
            Ok(Value::Null)
        })
    }

    fn profile(&self) -> Result<Profile> {
        Ok(self.db.query_row(
            "SELECT author_id,name FROM profile WHERE singleton=1",
            [],
            |row| {
                Ok(Profile {
                    author_id: row.get(0)?,
                    name: row.get(1)?,
                })
            },
        )?)
    }

    fn settings(&self) -> Result<Settings> {
        let theme: String =
            self.db
                .query_row("SELECT theme FROM settings WHERE singleton=1", [], |row| {
                    row.get(0)
                })?;
        let (bindings, pause_after_drawing): (String, bool) = self.db.query_row(
            "SELECT keybindings,pause_after_drawing FROM preferences WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        Ok(Settings {
            keybindings: serde_json::from_str(&bindings)?,
            pause_after_drawing,
            theme: match theme.as_str() {
                "system" => Theme::System,
                "light" => Theme::Light,
                "dark" => Theme::Dark,
                _ => anyhow::bail!("Invalid theme preference in database"),
            },
        })
    }

    fn video(&self, video_id: &str) -> Result<Video> {
        validation::identifier(video_id)?;
        let video = self.db.query_row("SELECT v.id,v.project_id,v.media_id,v.title,m.filename,m.byte_size,m.duration_us,m.width,m.height,v.folder_id FROM videos v JOIN media m ON m.id=v.media_id WHERE v.id=?1", [video_id], video_row).optional()?.context("Video does not exist; import it before creating a review")?;
        self.resolve_video_path(video)
    }

    fn folder(&self, folder_id: &str) -> Result<Folder> {
        validation::identifier(folder_id)?;
        self.db
            .query_row(
                "SELECT id,project_id,title,created_at FROM folders WHERE id=?1",
                [folder_id],
                folder_row,
            )
            .optional()?
            .context("Folder does not exist")
    }

    fn resolve_video_path(&self, mut video: Video) -> Result<Video> {
        // Only a single relative filename is ever accepted from storage.
        managed_filename(&video.path)?;
        let path = self.root.join("media").join(&video.path);
        no_symlink(&path)?;
        video.path = path
            .to_str()
            .context("Media path is not valid UTF-8")?
            .into();
        Ok(video)
    }

    fn load_comments(&self) -> Result<Vec<Comment>> {
        let mut statement = self
            .db
            .prepare("SELECT c.body,p.x,p.y FROM comments c LEFT JOIN comment_positions p ON p.comment_id=c.id ORDER BY c.created_at,c.id")?;
        let rows = statement.query_map([], comment_row)?;
        rows.map(|row| comment_from_row(row?)).collect()
    }

    fn comment(&self, comment_id: &str) -> Result<Option<Comment>> {
        self.db
            .query_row(
                "SELECT c.body,p.x,p.y FROM comments c LEFT JOIN comment_positions p ON p.comment_id=c.id WHERE c.id=?1",
                [comment_id],
                comment_row,
            )
            .optional()?
            .map(comment_from_row)
            .transpose()
    }

    fn save_comment_position(&self, comment_id: &str, position: Position) -> Result<()> {
        self.db.execute(
            "INSERT INTO comment_positions(comment_id,x,y) VALUES(?1,?2,?3) ON CONFLICT(comment_id) DO UPDATE SET x=excluded.x,y=excluded.y",
            params![comment_id, position.x, position.y],
        )?;
        Ok(())
    }

    fn bootstrap(&self) -> Result<Value> {
        let projects = {
            let mut statement = self
                .db
                .prepare("SELECT id,title,created_at FROM projects ORDER BY created_at,id")?;
            let rows = statement.query_map([], |row| {
                Ok(Project {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let videos = {
            let mut statement = self.db.prepare("SELECT v.id,v.project_id,v.media_id,v.title,m.filename,m.byte_size,m.duration_us,m.width,m.height,v.folder_id FROM videos v JOIN media m ON m.id=v.media_id ORDER BY v.created_at,v.id")?;
            let rows = statement.query_map([], video_row)?;
            rows.map(|row| self.resolve_video_path(row?))
                .collect::<Result<Vec<_>>>()?
        };
        let folders = {
            let mut statement = self.db.prepare(
                "SELECT id,project_id,title,created_at FROM folders ORDER BY created_at,id",
            )?;
            let rows = statement.query_map([], folder_row)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let drafts = {
            let mut statement = self.db.prepare("SELECT body FROM drafts ORDER BY rowid")?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            rows.map(|row| Ok(serde_json::from_str::<Draft>(&row?)?))
                .collect::<Result<Vec<_>>>()?
        };
        let managed_bytes: u64 =
            self.db
                .query_row("SELECT COALESCE(SUM(byte_size),0) FROM media", [], |row| {
                    row.get(0)
                })?;
        let database_bytes = [
            "gamepack.sqlite3",
            "gamepack.sqlite3-wal",
            "gamepack.sqlite3-shm",
        ]
        .iter()
        .map(|name| {
            fs::metadata(self.root.join(name))
                .map(|m| m.len())
                .unwrap_or(0)
        })
        .sum::<u64>();
        Ok(
            json!({"profile": self.profile()?, "settings": self.settings()?, "projects": projects, "folders": folders, "videos": videos, "comments": self.load_comments()?, "drafts": drafts, "storage": {"root": self.root.to_str().context("Data path is not valid UTF-8")?, "managed_bytes": managed_bytes, "database_bytes": database_bytes}}),
        )
    }

    fn comment_exists(&self, id: &str) -> Result<bool> {
        Ok(self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM comments WHERE id=?1)",
            [id],
            |row| row.get(0),
        )?)
    }

    fn validate_parent(&self, draft: &Draft) -> Result<()> {
        if let Some(parent) = &draft.parent_comment_id {
            let scope: Option<(String, String)> = self
                .db
                .query_row(
                    "SELECT project_id,video_id FROM comments WHERE id=?1",
                    [parent],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let (project, video) = scope.context("Reply parent does not exist")?;
            ensure!(
                project == draft.project_id && video == draft.video_id,
                "Replies must belong to the same project and video as their parent"
            );
            // Existing immutable rows cannot point forward to a new ID. Bounded
            // traversal also refuses a corrupted/imported cyclic graph.
            let mut seen = std::collections::HashSet::new();
            let mut cursor = Some(parent.clone());
            while let Some(id) = cursor {
                ensure!(
                    seen.len() < 128 && seen.insert(id.clone()),
                    "Reply ancestry exceeds 128 levels or contains a cycle"
                );
                cursor = self
                    .db
                    .query_row("SELECT parent_id FROM comments WHERE id=?1", [id], |row| {
                        row.get(0)
                    })
                    .optional()?
                    .flatten();
            }
        }
        Ok(())
    }

    fn atomic<T>(&self, operation: impl FnOnce(&Self) -> Result<T>) -> Result<T> {
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let output = operation(self)?;
            self.db.execute_batch("COMMIT")?;
            Ok(output)
        })();
        if result.is_err() {
            let _ = self.db.execute_batch("ROLLBACK");
        }
        result
    }

    fn post(&self, draft_id: &str) -> Result<Comment> {
        validation::identifier(draft_id)?;
        // Lock before retry/read so concurrent callers freeze one draft once.
        self.atomic(|store| store.post_in_transaction(draft_id))
    }

    fn post_in_transaction(&self, draft_id: &str) -> Result<Comment> {
        if let Some(comment) = self.comment(draft_id)? {
            return Ok(comment);
        }
        let body: String = self
            .db
            .query_row("SELECT body FROM drafts WHERE id=?1", [draft_id], |row| {
                row.get(0)
            })
            .optional()?
            .context("Draft does not exist; save it before posting")?;
        let mut draft: Draft = serde_json::from_str(&body)?;
        let video = self.video(&draft.video_id)?;
        validation::draft(&draft, &video)?;
        self.validate_parent(&draft)?;
        ensure!(
            !draft.text.trim().is_empty() || !draft.drawings.is_empty(),
            "Add comment text or a drawing before posting"
        );
        let profile = self.profile()?;
        validation::label(&profile.name, "Display name")?;
        // Presentation state does not enter the immutable body or v1 digest.
        let position = draft.position.take();
        let mut comment = Comment {
            comment_id: draft.id.clone(),
            draft,
            media_id: video.media_id,
            author_id: profile.author_id,
            name_at_posting: profile.name,
            created_at_reported: now()?,
            digest: String::new(),
            schema_version: 1,
        };
        // Canonical v1: lexicographically sorted object keys at every depth,
        // UTF-8 compact JSON and decimal integers, with digest omitted.
        let mut canonical = serde_json::to_value(&comment)?;
        canonical
            .as_object_mut()
            .context("Invalid canonical record")?
            .remove("digest");
        // serde_json's default map is lexicographic, including nested objects.
        comment.digest = blake3::hash(&serde_json::to_vec(&canonical)?)
            .to_hex()
            .to_string();
        self.db.execute("INSERT INTO comments(id,project_id,video_id,parent_id,created_at,digest,body) VALUES(?1,?2,?3,?4,?5,?6,?7)", params![comment.comment_id, comment.draft.project_id, comment.draft.video_id, comment.draft.parent_comment_id, comment.created_at_reported, comment.digest, serde_json::to_string(&comment)?])?;
        if let Some(position) = position {
            self.save_comment_position(&comment.comment_id, position)?;
            comment.draft.position = Some(position);
        }
        self.db
            .execute("DELETE FROM drafts WHERE id=?1", [draft_id])?;
        Ok(comment)
    }

    fn import_video(
        &mut self,
        source: &str,
        project_id: &str,
        duration_us: i64,
        width: u32,
        height: u32,
    ) -> Result<Video> {
        validation::identifier(project_id)?;
        validation::metadata(duration_us, width, height)?;
        let exists: bool = self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1)",
            [project_id],
            |row| row.get(0),
        )?;
        ensure!(exists, "Project does not exist");
        let source = Path::new(source);
        ensure!(source.is_absolute(), "Video source path must be absolute");
        let mut input = File::open(source).context("Cannot read video source")?;
        ensure!(
            input.metadata()?.is_file(),
            "Video source must be a regular file"
        );
        let staged = StagedFile(self.root.join("tmp").join(format!("import-{}", id())));
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged.0)?;
        let mut hasher = blake3::Hasher::new();
        let mut bytes = 0u64;
        let mut buffer = [0u8; 128 * 1024];
        loop {
            let read = input.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
            output.write_all(&buffer[..read])?;
            bytes = bytes
                .checked_add(read as u64)
                .context("Video exceeds supported size")?;
            ensure!(
                bytes <= validation::MAX_SAFE_INTEGER as u64,
                "Video exceeds safe JSON size range"
            );
        }
        ensure!(bytes > 0, "Cannot import an empty video file");
        output
            .sync_all()
            .context("Cannot flush managed video copy")?;
        drop(output);
        let digest = hasher.finalize().to_hex().to_string();
        let media_id = format!("blake3:{digest}:{bytes}");
        let extension = source
            .extension()
            .and_then(|s| s.to_str())
            .filter(|s| {
                !s.is_empty() && s.len() <= 8 && s.bytes().all(|c| c.is_ascii_alphanumeric())
            })
            .unwrap_or("bin")
            .to_ascii_lowercase();
        let proposed_filename = format!("{digest}-{bytes}.{extension}");
        let title = source
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Imported video")
            .to_owned();
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing_filename: Option<String> = tx
            .query_row(
                "SELECT filename FROM media WHERE id=?1",
                [&media_id],
                |row| row.get(0),
            )
            .optional()?;
        let filename = existing_filename.unwrap_or(proposed_filename);
        managed_filename(&filename)?;
        let destination = self.root.join("media").join(&filename);
        no_symlink(&destination)?;
        if destination.exists() {
            let (existing_digest, existing_bytes) = hash_file(&destination)?;
            ensure!(
                existing_digest == digest && existing_bytes == bytes,
                "Managed media is damaged; restore the exact file before importing again"
            );
        } else {
            // A same-filesystem hard link publishes the fully flushed staging
            // file without overwriting any existing media object.
            fs::hard_link(&staged.0, &destination).context("Cannot publish managed media")?;
            // POSIX permits syncing directory entries; opening a directory as
            // a normal File is unsupported on Windows. The media file itself
            // has already been flushed on every platform.
            #[cfg(unix)]
            File::open(self.root.join("media"))?.sync_all()?;
        }
        tx.execute("INSERT OR IGNORE INTO media(id,filename,byte_size,duration_us,width,height) VALUES(?1,?2,?3,?4,?5,?6)", params![media_id, filename, bytes, duration_us, width, height])?;
        let existing_video: Option<String> = tx
            .query_row(
                "SELECT id FROM videos WHERE project_id=?1 AND media_id=?2",
                params![project_id, media_id],
                |row| row.get(0),
            )
            .optional()?;
        let video_id = existing_video.unwrap_or_else(id);
        tx.execute("INSERT OR IGNORE INTO videos(id,project_id,media_id,title,created_at) VALUES(?1,?2,?3,?4,?5)", params![video_id, project_id, media_id, title, now()?])?;
        tx.commit()?;
        self.video(&video_id)
    }
}

fn comment_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<(String, Option<f64>, Option<f64>)> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
}

fn comment_from_row((body, x, y): (String, Option<f64>, Option<f64>)) -> Result<Comment> {
    let mut comment: Comment = serde_json::from_str(&body)?;
    comment.draft.position = x.zip(y).map(|(x, y)| Position { x, y });
    if let Some(position) = comment.draft.position {
        validation::position(position)?;
    }
    Ok(comment)
}

fn video_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Video> {
    Ok(Video {
        id: row.get(0)?,
        project_id: row.get(1)?,
        folder_id: row.get(9)?,
        media_id: row.get(2)?,
        title: row.get(3)?,
        path: row.get(4)?,
        byte_size: row.get(5)?,
        duration_us: row.get(6)?,
        width: row.get(7)?,
        height: row.get(8)?,
    })
}

fn folder_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        created_at: row.get(3)?,
    })
}

fn hash_file(path: &Path) -> Result<(String, u64)> {
    let mut file = File::open(path)?;
    ensure!(
        file.metadata()?.is_file(),
        "Managed media is not a regular file"
    );
    let mut hasher = blake3::Hasher::new();
    let mut bytes = 0u64;
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        bytes = bytes
            .checked_add(read as u64)
            .context("Media file size overflow")?;
    }
    Ok((hasher.finalize().to_hex().to_string(), bytes))
}

struct StagedFile(PathBuf);
impl Drop for StagedFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
