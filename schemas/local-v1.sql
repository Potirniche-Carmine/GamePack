-- Local database schema, including additive v2 theme settings migration.
-- ZIP exchange is deliberately not implemented.
CREATE TABLE IF NOT EXISTS settings (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    theme TEXT NOT NULL CHECK(theme IN ('system','light','dark'))
);
CREATE TABLE IF NOT EXISTS profile (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    author_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE,
    byte_size INTEGER NOT NULL CHECK(byte_size>0),
    duration_us INTEGER NOT NULL CHECK(duration_us>=0),
    width INTEGER NOT NULL CHECK(width>=0), height INTEGER NOT NULL CHECK(height>=0)
);
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
    media_id TEXT NOT NULL REFERENCES media(id), title TEXT NOT NULL,
    created_at INTEGER NOT NULL, UNIQUE(project_id,media_id)
);
CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
    video_id TEXT NOT NULL REFERENCES videos(id), body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
    video_id TEXT NOT NULL REFERENCES videos(id),
    parent_id TEXT REFERENCES comments(id), created_at INTEGER NOT NULL,
    digest TEXT NOT NULL, body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_scope ON comments(project_id,video_id,created_at);
CREATE TRIGGER IF NOT EXISTS comments_no_update BEFORE UPDATE ON comments
BEGIN SELECT RAISE(ABORT,'Posted comments are immutable'); END;
-- REPLACE may delete a conflicting row without DELETE triggers when recursive
-- triggers are disabled, so refuse duplicate IDs before any insert runs.
CREATE TRIGGER IF NOT EXISTS comments_no_replace BEFORE INSERT ON comments
WHEN EXISTS(SELECT 1 FROM comments WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'Posted comments are immutable'); END;
CREATE TRIGGER IF NOT EXISTS comments_no_delete BEFORE DELETE ON comments
BEGIN SELECT RAISE(ABORT,'Posted comments are immutable'); END;
