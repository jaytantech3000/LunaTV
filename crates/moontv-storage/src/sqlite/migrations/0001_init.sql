CREATE TABLE IF NOT EXISTS app_metadata (
  metadata_key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS download_store_snapshot (
  snapshot_key TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
