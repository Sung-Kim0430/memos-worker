-- 清空所有业务数据的脚本（危险操作，执行前请备份！）
-- 使用示例：npx wrangler d1 execute <D1_NAME> --file=./src/migrations/wipe_all_data.sql

BEGIN;

-- 如果环境还未执行多用户迁移，先确保 users 表存在，避免删除时报错
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0 NOT NULL,
  telegram_user_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

-- 确保 FTS 表存在，以便下面的 DELETE 不报错
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  content,
  content='notes',
  content_rowid='id'
);

DELETE FROM note_tags;
DELETE FROM tags;
DELETE FROM notes;
DELETE FROM nodes;
DELETE FROM users;
DELETE FROM notes_fts;

COMMIT;
