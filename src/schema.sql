-- 幂等初始化脚本，可重复执行
DROP TRIGGER IF EXISTS notes_after_insert;
DROP TRIGGER IF EXISTS notes_after_delete;
DROP TRIGGER IF EXISTS notes_after_update;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0 NOT NULL,
  telegram_user_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  content TEXT NOT NULL,
  files TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_pinned BOOLEAN DEFAULT 0,
  is_favorited INTEGER DEFAULT 0 NOT NULL,
  is_archived INTEGER DEFAULT 0 NOT NULL,
  pics TEXT,
  videos TEXT,
  owner_id TEXT,
  visibility TEXT DEFAULT 'private',
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (note_id, tag_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- 常用查询索引
CREATE INDEX IF NOT EXISTS idx_notes_owner_visibility_updated ON notes(owner_id, visibility, updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);
CREATE INDEX IF NOT EXISTS idx_note_tags_note_id ON note_tags(note_id);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag_id ON note_tags(tag_id);


CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  parent_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE
);
-- =============================================
-- Section 2: Full-Text Search Virtual Table
-- (This is the only FTS-related statement you need)
-- =============================================
--
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  content,
  content='notes',
  content_rowid='id'
);


-- =============================================
-- Section 3: Triggers to keep FTS in sync
-- =============================================

CREATE TRIGGER IF NOT EXISTS notes_after_insert AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS notes_after_delete AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS notes_after_update AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO notes_fts(rowid, content) VALUES (new.id, new.content);
END;
