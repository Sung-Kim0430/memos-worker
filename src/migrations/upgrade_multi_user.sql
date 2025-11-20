-- 升级到多用户/多可见性模型的迁移脚本
-- 仅需执行一次：npx wrangler d1 execute <D1_NAME> --file=./src/migrations/upgrade_multi_user.sql

BEGIN;

-- 1) 用户表（幂等）
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0 NOT NULL,
  telegram_user_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

-- 2) notes 增加多用户字段（IF NOT EXISTS 需要较新 SQLite 版本；如报错请手动检查后移除 IF NOT EXISTS）
ALTER TABLE notes ADD COLUMN IF NOT EXISTS owner_id TEXT;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'private';

-- 3) 旧数据补齐可见性
UPDATE notes SET visibility = 'private' WHERE visibility IS NULL;

-- 4) 便于按用户/可见性过滤的简单索引
CREATE INDEX IF NOT EXISTS idx_notes_owner_visibility ON notes(owner_id, visibility);

COMMIT;
