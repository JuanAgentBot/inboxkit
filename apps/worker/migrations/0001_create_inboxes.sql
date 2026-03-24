CREATE TABLE IF NOT EXISTS inboxes (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL
);
