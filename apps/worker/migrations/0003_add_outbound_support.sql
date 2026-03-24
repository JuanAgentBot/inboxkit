ALTER TABLE messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'inbound';
ALTER TABLE messages ADD COLUMN to_address TEXT;
