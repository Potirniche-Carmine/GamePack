-- Applied after the additive videos.folder_id column migration.
CREATE INDEX IF NOT EXISTS videos_folder ON videos(project_id,folder_id);
CREATE TRIGGER IF NOT EXISTS videos_folder_insert BEFORE INSERT ON videos
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM folders WHERE id=NEW.folder_id AND project_id=NEW.project_id
)
BEGIN SELECT RAISE(ABORT,'A video folder must belong to the same project'); END;
CREATE TRIGGER IF NOT EXISTS videos_folder_update BEFORE UPDATE OF folder_id,project_id ON videos
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM folders WHERE id=NEW.folder_id AND project_id=NEW.project_id
)
BEGIN SELECT RAISE(ABORT,'A video folder must belong to the same project'); END;
CREATE TRIGGER IF NOT EXISTS folders_project_update BEFORE UPDATE OF project_id ON folders
WHEN NEW.project_id != OLD.project_id
BEGIN SELECT RAISE(ABORT,'Folders cannot be moved between projects'); END;
