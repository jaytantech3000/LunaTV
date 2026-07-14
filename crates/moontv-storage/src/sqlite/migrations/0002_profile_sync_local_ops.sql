CREATE TABLE IF NOT EXISTS profile_sync_state (
  username TEXT PRIMARY KEY NOT NULL,
  device_id TEXT NOT NULL,
  next_local_seq INTEGER NOT NULL DEFAULT 1,
  last_pushed_seq INTEGER,
  last_remote_generation_json TEXT,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_outbox (
  op_id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  domain TEXT NOT NULL,
  entity_key TEXT,
  operation TEXT NOT NULL CHECK(operation IN ('upsert', 'delete', 'clear-domain', 'replace-domain')),
  payload_json TEXT,
  local_seq INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  last_error TEXT,
  acked_at_ms INTEGER,
  UNIQUE(username, local_seq),
  FOREIGN KEY(username) REFERENCES profile_sync_state(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_profile_outbox_due
  ON profile_outbox(username, acked_at_ms, next_attempt_at_ms, local_seq);

CREATE TABLE IF NOT EXISTS profile_tombstone (
  username TEXT NOT NULL,
  domain TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  deleted_at_ms INTEGER NOT NULL,
  local_seq INTEGER NOT NULL,
  op_id TEXT NOT NULL,
  PRIMARY KEY(username, domain, entity_key),
  FOREIGN KEY(username) REFERENCES profile_sync_state(username) ON DELETE CASCADE
);
