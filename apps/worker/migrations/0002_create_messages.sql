CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  inbox_id TEXT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  from_address TEXT NOT NULL,
  from_name TEXT,
  subject TEXT DEFAULT '',
  text_body TEXT,
  html_body TEXT,
  raw_size INTEGER NOT NULL,
  raw_key TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX idx_messages_inbox_id ON messages(inbox_id);
CREATE INDEX idx_messages_received_at ON messages(received_at);
