CREATE TABLE IF NOT EXISTS moontv_users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS moontv_profiles (
  username TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE IF NOT EXISTS moontv_admin_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  config_json TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
