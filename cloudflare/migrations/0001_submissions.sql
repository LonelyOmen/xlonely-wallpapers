CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'pending', 'approved', 'rejected')),
  title TEXT NOT NULL,
  creator TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('still', 'live')),
  format TEXT NOT NULL,
  content_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  release_id INTEGER,
  asset_id INTEGER,
  preview_asset_id INTEGER,
  asset_url TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL,
  preview_size INTEGER NOT NULL DEFAULT 0,
  colors_json TEXT NOT NULL DEFAULT '[]',
  reviewed_by TEXT,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS submissions_user_day ON submissions(user_id, created_at);
CREATE INDEX IF NOT EXISTS submissions_status_created ON submissions(status, created_at);
