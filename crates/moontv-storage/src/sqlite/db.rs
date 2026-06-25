use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

use super::migrations;

const DOWNLOAD_STORE_SNAPSHOT_KEY: &str = "default";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SqliteDatabaseInfo {
    pub schema_version: i64,
    pub applied_migration_count: usize,
}

#[derive(Debug, Clone)]
pub struct DesktopSqlite {
    path: PathBuf,
    info: SqliteDatabaseInfo,
}

impl DesktopSqlite {
    pub fn initialize(path: impl Into<PathBuf>) -> Result<Self> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }

        let mut connection = open_connection(&path)?;
        let info = apply_migrations(&mut connection)?;

        Ok(Self { path, info })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn info(&self) -> &SqliteDatabaseInfo {
        &self.info
    }

    pub fn read_download_store_snapshot(&self) -> Result<Option<Value>> {
        let connection = open_connection(&self.path)?;
        let payload = connection
            .query_row(
                "SELECT payload_json FROM download_store_snapshot WHERE snapshot_key = ?1",
                [DOWNLOAD_STORE_SNAPSHOT_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .context("failed to read desktop download store snapshot")?;

        payload
            .map(|raw| {
                serde_json::from_str::<Value>(&raw)
                    .context("failed to deserialize desktop download store snapshot")
            })
            .transpose()
    }

    pub fn write_download_store_snapshot(&self, snapshot: &Value) -> Result<()> {
        let connection = open_connection(&self.path)?;
        let payload = serde_json::to_string(snapshot)
            .context("failed to serialize desktop download store")?;

        connection
            .execute(
                "INSERT INTO download_store_snapshot (
                    snapshot_key,
                    payload_json,
                    updated_at_ms
                ) VALUES (?1, ?2, ?3)
                ON CONFLICT(snapshot_key) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at_ms = excluded.updated_at_ms",
                params![DOWNLOAD_STORE_SNAPSHOT_KEY, payload, current_timestamp_ms()],
            )
            .context("failed to write desktop download store snapshot")?;

        Ok(())
    }

    pub fn clear_download_store_snapshot(&self) -> Result<bool> {
        let connection = open_connection(&self.path)?;
        let deleted = connection
            .execute(
                "DELETE FROM download_store_snapshot WHERE snapshot_key = ?1",
                [DOWNLOAD_STORE_SNAPSHOT_KEY],
            )
            .context("failed to clear desktop download store snapshot")?;
        Ok(deleted > 0)
    }

    pub fn read_app_metadata<T>(&self, key: &str) -> Result<Option<T>>
    where
        T: DeserializeOwned,
    {
        let connection = open_connection(&self.path)?;
        let payload = connection
            .query_row(
                "SELECT value_json FROM app_metadata WHERE metadata_key = ?1",
                [key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .with_context(|| format!("failed to read app metadata for key {key}"))?;

        payload
            .map(|raw| {
                serde_json::from_str::<T>(&raw)
                    .with_context(|| format!("failed to deserialize app metadata for key {key}"))
            })
            .transpose()
    }

    pub fn write_app_metadata<T>(&self, key: &str, value: &T) -> Result<()>
    where
        T: Serialize + ?Sized,
    {
        let connection = open_connection(&self.path)?;
        let payload = serde_json::to_string(value)
            .with_context(|| format!("failed to serialize app metadata for key {key}"))?;

        connection
            .execute(
                "INSERT INTO app_metadata (
                    metadata_key,
                    value_json,
                    updated_at_ms
                ) VALUES (?1, ?2, ?3)
                ON CONFLICT(metadata_key) DO UPDATE SET
                    value_json = excluded.value_json,
                    updated_at_ms = excluded.updated_at_ms",
                params![key, payload, current_timestamp_ms()],
            )
            .with_context(|| format!("failed to write app metadata for key {key}"))?;

        Ok(())
    }

    pub fn delete_app_metadata(&self, key: &str) -> Result<bool> {
        let connection = open_connection(&self.path)?;
        let deleted = connection
            .execute("DELETE FROM app_metadata WHERE metadata_key = ?1", [key])
            .with_context(|| format!("failed to delete app metadata for key {key}"))?;
        Ok(deleted > 0)
    }
}

fn open_connection(path: &Path) -> Result<Connection> {
    let connection =
        Connection::open(path).with_context(|| format!("failed to open {}", path.display()))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .context("failed to configure sqlite busy timeout")?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = MEMORY;",
        )
        .context("failed to configure sqlite pragmas")?;
    Ok(connection)
}

fn apply_migrations(connection: &mut Connection) -> Result<SqliteDatabaseInfo> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                applied_at_ms INTEGER NOT NULL
            );",
        )
        .context("failed to create schema_migrations table")?;

    let tx = connection
        .transaction()
        .context("failed to start sqlite migration transaction")?;

    for migration in migrations::all() {
        let already_applied = tx
            .query_row(
                "SELECT 1 FROM schema_migrations WHERE version = ?1",
                [migration.version],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .with_context(|| {
                format!(
                    "failed to inspect sqlite migration {} ({})",
                    migration.version, migration.name
                )
            })?
            .is_some();

        if already_applied {
            continue;
        }

        tx.execute_batch(migration.sql).with_context(|| {
            format!(
                "failed to apply sqlite migration {} ({})",
                migration.version, migration.name
            )
        })?;
        tx.execute(
            "INSERT INTO schema_migrations (version, name, applied_at_ms)
             VALUES (?1, ?2, ?3)",
            params![migration.version, migration.name, current_timestamp_ms()],
        )
        .with_context(|| {
            format!(
                "failed to record sqlite migration {} ({})",
                migration.version, migration.name
            )
        })?;
    }

    tx.pragma_update(None, "user_version", migrations::latest_version())
        .context("failed to update sqlite schema version")?;
    tx.commit().context("failed to commit sqlite migrations")?;

    let schema_version = connection
        .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
        .context("failed to read sqlite schema version")?;
    let applied_migration_count = connection
        .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
            row.get::<_, usize>(0)
        })
        .context("failed to count sqlite migrations")?;

    Ok(SqliteDatabaseInfo {
        schema_version,
        applied_migration_count,
    })
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::{
        env,
        sync::atomic::{AtomicU64, Ordering},
    };

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn initialize_creates_database_and_applies_migrations() {
        let temp_dir = TestDir::new();
        let database_path = temp_dir.path.join("desktop.sqlite3");

        let database = DesktopSqlite::initialize(&database_path).expect("initialize sqlite");

        assert!(database_path.exists(), "expected sqlite file to exist");
        assert_eq!(database.path(), database_path.as_path());
        assert_eq!(database.info().schema_version, migrations::latest_version());
        assert_eq!(
            database.info().applied_migration_count,
            migrations::all().len()
        );
    }

    #[test]
    fn download_store_snapshot_round_trips() {
        let temp_dir = TestDir::new();
        let database =
            DesktopSqlite::initialize(temp_dir.path.join("desktop.sqlite3")).expect("sqlite");
        let snapshot = serde_json::json!({
            "tasks": {
                "task-1": {
                    "status": "paused"
                }
            },
            "library": {}
        });

        database
            .write_download_store_snapshot(&snapshot)
            .expect("write snapshot");

        let stored = database
            .read_download_store_snapshot()
            .expect("read snapshot")
            .expect("snapshot should exist");

        assert_eq!(stored, snapshot);
        assert!(
            database
                .clear_download_store_snapshot()
                .expect("clear snapshot")
        );
        assert_eq!(
            database
                .read_download_store_snapshot()
                .expect("read after clear"),
            None
        );
    }

    #[test]
    fn app_metadata_round_trips_typed_payloads() {
        let temp_dir = TestDir::new();
        let database =
            DesktopSqlite::initialize(temp_dir.path.join("desktop.sqlite3")).expect("sqlite");
        let payload = serde_json::json!({
            "domains": ["playrecords", "favorites"],
            "enabled": true
        });

        database
            .write_app_metadata("profile:demo:manifest", &payload)
            .expect("write metadata");

        let stored = database
            .read_app_metadata::<Value>("profile:demo:manifest")
            .expect("read metadata")
            .expect("metadata should exist");

        assert_eq!(stored, payload);
        assert!(
            database
                .delete_app_metadata("profile:demo:manifest")
                .expect("delete metadata")
        );
        assert_eq!(
            database
                .read_app_metadata::<Value>("profile:demo:manifest")
                .expect("read metadata after delete"),
            None
        );
    }

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new() -> Self {
            let unique = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = env::temp_dir().join(format!("moontv-storage-test-{unique}"));
            fs::create_dir_all(&path).expect("create test dir");
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}
