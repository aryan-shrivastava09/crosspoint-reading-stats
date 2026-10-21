CREATE TABLE IF NOT EXISTS sessions (
  device_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  book TEXT NOT NULL,
  document TEXT,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  start_progress_bp INTEGER NOT NULL,
  end_progress_bp INTEGER NOT NULL,
  event_ts INTEGER,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (device_key, event_id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_device_end ON sessions(device_key, end_time);
CREATE INDEX IF NOT EXISTS idx_sessions_device_doc ON sessions(device_key, document, end_time);
