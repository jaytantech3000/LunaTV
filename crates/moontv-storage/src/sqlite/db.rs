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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileOutboxRecord {
    pub op_id: String,
    pub username: String,
    pub domain: String,
    pub entity_key: Option<String>,
    pub operation: String,
    pub payload_json: Option<String>,
    pub local_seq: i64,
    pub created_at_ms: i64,
    pub attempt_count: i64,
    pub next_attempt_at_ms: i64,
    pub last_error: Option<String>,
    pub acked_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileSyncWorkerState {
    pub username: String,
    pub device_id: String,
    pub next_local_seq: i64,
    pub last_pushed_seq: Option<i64>,
    pub last_remote_generation_json: Option<String>,
    pub last_sync_at_ms: Option<i64>,
    pub last_sync_error: Option<String>,
    pub next_attempt_at_ms: Option<i64>,
    pub auth_blocked_at_ms: Option<i64>,
    pub auth_blocked_error: Option<String>,
}

pub struct ProfileMutationWrite<'a> {
    pub username: &'a str,
    pub device_id: &'a str,
    pub domain_metadata_key: &'a str,
    pub domain: &'a str,
    pub entity_key: Option<&'a str>,
    pub operation: &'a str,
    pub snapshot_json: &'a str,
    pub payload_json: Option<&'a str>,
    pub op_id: &'a str,
    pub timestamp_ms: i64,
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

    pub fn apply_profile_mutation(&self, write: ProfileMutationWrite<'_>) -> Result<i64> {
        let mut connection = open_connection(&self.path)?;
        let tx = connection
            .transaction()
            .context("failed to start profile mutation transaction")?;

        tx.execute(
            "INSERT INTO profile_sync_state (
                username, device_id, next_local_seq, updated_at_ms
             ) VALUES (?1, ?2, 1, ?3)
             ON CONFLICT(username) DO UPDATE SET
                device_id = excluded.device_id,
                updated_at_ms = excluded.updated_at_ms",
            params![write.username, write.device_id, write.timestamp_ms],
        )
        .context("failed to initialize profile sync state")?;
        let local_seq = tx
            .query_row(
                "SELECT next_local_seq FROM profile_sync_state WHERE username = ?1",
                [write.username],
                |row| row.get::<_, i64>(0),
            )
            .context("failed to read next profile local sequence")?;
        tx.execute(
            "UPDATE profile_sync_state
             SET next_local_seq = ?2, updated_at_ms = ?3
             WHERE username = ?1",
            params![write.username, local_seq + 1, write.timestamp_ms],
        )
        .context("failed to advance profile local sequence")?;
        tx.execute(
            "INSERT INTO app_metadata (metadata_key, value_json, updated_at_ms)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(metadata_key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at_ms = excluded.updated_at_ms",
            params![
                write.domain_metadata_key,
                write.snapshot_json,
                write.timestamp_ms
            ],
        )
        .context("failed to persist profile domain snapshot")?;
        tx.execute(
            "INSERT INTO profile_outbox (
                op_id, username, domain, entity_key, operation, payload_json,
                local_seq, created_at_ms, next_attempt_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                write.op_id,
                write.username,
                write.domain,
                write.entity_key,
                write.operation,
                write.payload_json,
                local_seq,
                write.timestamp_ms
            ],
        )
        .context("failed to enqueue profile mutation")?;

        if let Some(entity_key) = write.entity_key {
            if write.operation == "delete" {
                tx.execute(
                    "INSERT INTO profile_tombstone (
                        username, domain, entity_key, deleted_at_ms, local_seq, op_id
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(username, domain, entity_key) DO UPDATE SET
                        deleted_at_ms = excluded.deleted_at_ms,
                        local_seq = excluded.local_seq,
                        op_id = excluded.op_id",
                    params![
                        write.username,
                        write.domain,
                        entity_key,
                        write.timestamp_ms,
                        local_seq,
                        write.op_id
                    ],
                )
                .context("failed to persist profile tombstone")?;
            } else if write.operation == "upsert" {
                tx.execute(
                    "DELETE FROM profile_tombstone
                     WHERE username = ?1 AND domain = ?2 AND entity_key = ?3",
                    params![write.username, write.domain, entity_key],
                )
                .context("failed to clear profile tombstone")?;
            }
        }

        tx.commit()
            .context("failed to commit profile mutation transaction")?;
        Ok(local_seq)
    }

    pub fn list_due_profile_outbox(
        &self,
        username: &str,
        now_ms: i64,
        limit: usize,
    ) -> Result<Vec<ProfileOutboxRecord>> {
        let connection = open_connection(&self.path)?;
        let mut statement = connection
            .prepare(
                "SELECT op_id, username, domain, entity_key, operation, payload_json,
                        local_seq, created_at_ms, attempt_count, next_attempt_at_ms,
                        last_error, acked_at_ms
                 FROM profile_outbox
                 WHERE username = ?1
                   AND acked_at_ms IS NULL
                   AND next_attempt_at_ms <= ?2
                   AND NOT EXISTS (
                     SELECT 1 FROM profile_outbox earlier
                     WHERE earlier.username = profile_outbox.username
                       AND earlier.acked_at_ms IS NULL
                       AND earlier.local_seq < profile_outbox.local_seq
                   )
                 ORDER BY local_seq ASC LIMIT ?3",
            )
            .context("failed to prepare profile outbox query")?;
        let records = statement
            .query_map(params![username, now_ms, limit as i64], |row| {
                Ok(ProfileOutboxRecord {
                    op_id: row.get(0)?,
                    username: row.get(1)?,
                    domain: row.get(2)?,
                    entity_key: row.get(3)?,
                    operation: row.get(4)?,
                    payload_json: row.get(5)?,
                    local_seq: row.get(6)?,
                    created_at_ms: row.get(7)?,
                    attempt_count: row.get(8)?,
                    next_attempt_at_ms: row.get(9)?,
                    last_error: row.get(10)?,
                    acked_at_ms: row.get(11)?,
                })
            })
            .context("failed to query profile outbox")?
            .collect::<std::result::Result<Vec<_>, _>>()
            .context("failed to decode profile outbox")?;
        Ok(records)
    }

    pub fn pending_profile_outbox_count(&self, username: &str) -> Result<u64> {
        let connection = open_connection(&self.path)?;
        connection
            .query_row(
                "SELECT COUNT(*) FROM profile_outbox
                 WHERE username = ?1 AND acked_at_ms IS NULL",
                [username],
                |row| row.get::<_, u64>(0),
            )
            .context("failed to count pending profile outbox")
    }

    pub fn latest_auth_blocked_profile_sync_worker_state(
        &self,
    ) -> Result<Option<ProfileSyncWorkerState>> {
        let connection = open_connection(&self.path)?;
        connection
            .query_row(
                "SELECT username, device_id, next_local_seq, last_pushed_seq,
                        last_remote_generation_json, last_sync_at_ms, last_sync_error,
                        next_attempt_at_ms, auth_blocked_at_ms, auth_blocked_error
                 FROM profile_sync_state
                 WHERE auth_blocked_at_ms IS NOT NULL
                 ORDER BY updated_at_ms DESC, username DESC
                 LIMIT 1",
                [],
                |row| {
                    Ok(ProfileSyncWorkerState {
                        username: row.get(0)?,
                        device_id: row.get(1)?,
                        next_local_seq: row.get(2)?,
                        last_pushed_seq: row.get(3)?,
                        last_remote_generation_json: row.get(4)?,
                        last_sync_at_ms: row.get(5)?,
                        last_sync_error: row.get(6)?,
                        next_attempt_at_ms: row.get(7)?,
                        auth_blocked_at_ms: row.get(8)?,
                        auth_blocked_error: row.get(9)?,
                    })
                },
            )
            .optional()
            .context("failed to read latest auth-blocked profile sync worker state")
    }

    pub fn profile_sync_worker_state(
        &self,
        username: &str,
    ) -> Result<Option<ProfileSyncWorkerState>> {
        let connection = open_connection(&self.path)?;
        connection
            .query_row(
                "SELECT username, device_id, next_local_seq, last_pushed_seq,
                        last_remote_generation_json, last_sync_at_ms, last_sync_error,
                        next_attempt_at_ms, auth_blocked_at_ms, auth_blocked_error
                 FROM profile_sync_state
                 WHERE username = ?1",
                [username],
                |row| {
                    Ok(ProfileSyncWorkerState {
                        username: row.get(0)?,
                        device_id: row.get(1)?,
                        next_local_seq: row.get(2)?,
                        last_pushed_seq: row.get(3)?,
                        last_remote_generation_json: row.get(4)?,
                        last_sync_at_ms: row.get(5)?,
                        last_sync_error: row.get(6)?,
                        next_attempt_at_ms: row.get(7)?,
                        auth_blocked_at_ms: row.get(8)?,
                        auth_blocked_error: row.get(9)?,
                    })
                },
            )
            .optional()
            .context("failed to read profile sync worker state")
    }

    pub fn ack_profile_outbox_head(
        &self,
        username: &str,
        op_id: &str,
        local_seq: i64,
        acked_at_ms: i64,
    ) -> Result<bool> {
        let mut connection = open_connection(&self.path)?;
        let tx = connection
            .transaction()
            .context("failed to start profile outbox acknowledgement transaction")?;
        let changed = tx
            .execute(
                "UPDATE profile_outbox
                 SET acked_at_ms = ?4, last_error = NULL
                 WHERE username = ?1
                   AND op_id = ?2
                   AND local_seq = ?3
                   AND acked_at_ms IS NULL
                   AND local_seq = (
                       SELECT MIN(local_seq)
                       FROM profile_outbox
                       WHERE username = ?1 AND acked_at_ms IS NULL
                   )",
                params![username, op_id, local_seq, acked_at_ms],
            )
            .context("failed to acknowledge profile outbox head")?;

        if changed > 0 {
            tx.execute(
                "UPDATE profile_sync_state
                 SET last_pushed_seq = ?2,
                     last_sync_at_ms = ?3,
                     last_sync_error = NULL,
                     next_attempt_at_ms = NULL,
                     updated_at_ms = ?3
                 WHERE username = ?1",
                params![username, local_seq, acked_at_ms],
            )
            .context("failed to update profile sync state after acknowledgement")?;
        }

        tx.commit()
            .context("failed to commit profile outbox acknowledgement transaction")?;
        Ok(changed > 0)
    }

    pub fn record_profile_outbox_head_failure(
        &self,
        username: &str,
        op_id: &str,
        local_seq: i64,
        failed_at_ms: i64,
        next_attempt_at_ms: i64,
        error: &str,
    ) -> Result<bool> {
        let mut connection = open_connection(&self.path)?;
        let tx = connection
            .transaction()
            .context("failed to start profile outbox failure transaction")?;
        let changed = tx
            .execute(
                "UPDATE profile_outbox
                 SET attempt_count = attempt_count + 1,
                     next_attempt_at_ms = ?4,
                     last_error = ?5
                 WHERE username = ?1
                   AND op_id = ?2
                   AND local_seq = ?3
                   AND acked_at_ms IS NULL
                   AND local_seq = (
                       SELECT MIN(local_seq)
                       FROM profile_outbox
                       WHERE username = ?1 AND acked_at_ms IS NULL
                   )",
                params![username, op_id, local_seq, next_attempt_at_ms, error],
            )
            .context("failed to record profile outbox head failure")?;

        if changed > 0 {
            tx.execute(
                "UPDATE profile_sync_state
                 SET last_sync_at_ms = ?2,
                     last_sync_error = ?3,
                     next_attempt_at_ms = ?4,
                     updated_at_ms = ?2
                 WHERE username = ?1",
                params![username, failed_at_ms, error, next_attempt_at_ms],
            )
            .context("failed to update profile sync state after outbox failure")?;
        }

        tx.commit()
            .context("failed to commit profile outbox failure transaction")?;
        Ok(changed > 0)
    }

    pub fn block_profile_sync_auth(
        &self,
        username: &str,
        blocked_at_ms: i64,
        error: &str,
    ) -> Result<bool> {
        let connection = open_connection(&self.path)?;
        let changed = connection
            .execute(
                "UPDATE profile_sync_state
                 SET auth_blocked_at_ms = ?2,
                     auth_blocked_error = ?3,
                     last_sync_at_ms = ?2,
                     last_sync_error = ?3,
                     updated_at_ms = ?2
                 WHERE username = ?1",
                params![username, blocked_at_ms, error],
            )
            .context("failed to persist profile sync auth block")?;
        Ok(changed > 0)
    }

    pub fn clear_profile_sync_auth_block(
        &self,
        username: &str,
        cleared_at_ms: i64,
    ) -> Result<bool> {
        let connection = open_connection(&self.path)?;
        let changed = connection
            .execute(
                "UPDATE profile_sync_state
                 SET auth_blocked_at_ms = NULL,
                     auth_blocked_error = NULL,
                     updated_at_ms = ?2
                 WHERE username = ?1
                   AND (auth_blocked_at_ms IS NOT NULL OR auth_blocked_error IS NOT NULL)",
                params![username, cleared_at_ms],
            )
            .context("failed to clear profile sync auth block")?;
        Ok(changed > 0)
    }

    pub fn has_profile_tombstone(
        &self,
        username: &str,
        domain: &str,
        entity_key: &str,
    ) -> Result<bool> {
        let connection = open_connection(&self.path)?;
        Ok(connection
            .query_row(
                "SELECT 1 FROM profile_tombstone
                 WHERE username = ?1 AND domain = ?2 AND entity_key = ?3",
                params![username, domain, entity_key],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .context("failed to inspect profile tombstone")?
            .is_some())
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
    fn existing_profile_sync_database_migrates_worker_state_columns() {
        let temp_dir = TestDir::new();
        let database_path = temp_dir.path.join("desktop.sqlite3");
        let connection = Connection::open(&database_path).expect("open pre-migration database");
        connection
            .execute_batch(
                "CREATE TABLE profile_sync_state (
                    username TEXT PRIMARY KEY NOT NULL,
                    device_id TEXT NOT NULL,
                    next_local_seq INTEGER NOT NULL DEFAULT 1,
                    last_pushed_seq INTEGER,
                    last_remote_generation_json TEXT,
                    updated_at_ms INTEGER NOT NULL
                );
                INSERT INTO profile_sync_state (
                    username, device_id, next_local_seq, updated_at_ms
                ) VALUES ('alice', 'device-a', 2, 10);
                CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    applied_at_ms INTEGER NOT NULL
                );
                INSERT INTO schema_migrations (version, name, applied_at_ms)
                VALUES (1, 'init_desktop_foundation', 1),
                       (2, 'profile_sync_local_ops', 2);",
            )
            .expect("seed version two database");
        drop(connection);

        let database = DesktopSqlite::initialize(&database_path).expect("migrate database");

        assert_eq!(database.info().schema_version, 3);
        assert_eq!(database.info().applied_migration_count, 3);
        assert_eq!(
            database
                .profile_sync_worker_state("alice")
                .expect("read migrated worker state")
                .expect("worker state"),
            ProfileSyncWorkerState {
                username: "alice".to_owned(),
                device_id: "device-a".to_owned(),
                next_local_seq: 2,
                last_pushed_seq: None,
                last_remote_generation_json: None,
                last_sync_at_ms: None,
                last_sync_error: None,
                next_attempt_at_ms: None,
                auth_blocked_at_ms: None,
                auth_blocked_error: None,
            }
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
    fn profile_mutation_is_atomic_and_records_outbox_and_tombstones() {
        let temp_dir = TestDir::new();
        let database =
            DesktopSqlite::initialize(temp_dir.path.join("desktop.sqlite3")).expect("sqlite");

        let first_seq = database
            .apply_profile_mutation(ProfileMutationWrite {
                username: "alice",
                device_id: "device-a",
                domain_metadata_key: "profile:alice:favorites",
                domain: "favorites",
                entity_key: Some("demo+1"),
                operation: "upsert",
                snapshot_json: r#"{"demo+1":{"title":"Demo"}}"#,
                payload_json: Some(r#"{"title":"Demo"}"#),
                op_id: "op-1",
                timestamp_ms: 10,
            })
            .expect("apply upsert");
        assert_eq!(first_seq, 1);
        assert_eq!(database.pending_profile_outbox_count("alice").unwrap(), 1);
        assert!(
            !database
                .has_profile_tombstone("alice", "favorites", "demo+1")
                .unwrap()
        );

        let second_seq = database
            .apply_profile_mutation(ProfileMutationWrite {
                username: "alice",
                device_id: "device-a",
                domain_metadata_key: "profile:alice:favorites",
                domain: "favorites",
                entity_key: Some("demo+1"),
                operation: "delete",
                snapshot_json: "{}",
                payload_json: None,
                op_id: "op-2",
                timestamp_ms: 20,
            })
            .expect("apply delete");
        assert_eq!(second_seq, 2);
        assert!(
            database
                .has_profile_tombstone("alice", "favorites", "demo+1")
                .unwrap()
        );
        let outbox = database
            .list_due_profile_outbox("alice", 20, 10)
            .expect("list outbox");
        assert_eq!(outbox.len(), 1);
        assert_eq!(outbox[0].operation, "upsert");

        database
            .ack_profile_outbox_head("alice", "op-1", first_seq, 25)
            .expect("ack first outbox operation");
        let next_outbox = database
            .list_due_profile_outbox("alice", 25, 10)
            .expect("list next outbox");
        assert_eq!(next_outbox.len(), 1);
        assert_eq!(next_outbox[0].operation, "delete");
        database
            .ack_profile_outbox_head("alice", "op-2", second_seq, 30)
            .expect("ack second outbox operation");
        assert_eq!(database.pending_profile_outbox_count("alice").unwrap(), 0);
    }

    #[test]
    fn ack_profile_outbox_head_only_acknowledges_the_matching_unacked_head() {
        let temp_dir = TestDir::new();
        let database =
            DesktopSqlite::initialize(temp_dir.path.join("desktop.sqlite3")).expect("sqlite");
        for (op_id, timestamp_ms) in [("op-1", 10), ("op-2", 20)] {
            database
                .apply_profile_mutation(ProfileMutationWrite {
                    username: "alice",
                    device_id: "device-a",
                    domain_metadata_key: "profile:alice:favorites",
                    domain: "favorites",
                    entity_key: Some(op_id),
                    operation: "upsert",
                    snapshot_json: "{}",
                    payload_json: None,
                    op_id,
                    timestamp_ms,
                })
                .expect("enqueue mutation");
        }

        assert!(
            !database
                .ack_profile_outbox_head("alice", "op-2", 2, 30)
                .expect("reject non-head acknowledgement")
        );
        assert!(
            !database
                .ack_profile_outbox_head("alice", "op-1", 2, 30)
                .expect("reject mismatched local sequence")
        );
        assert_eq!(database.pending_profile_outbox_count("alice").unwrap(), 2);

        assert!(
            database
                .ack_profile_outbox_head("alice", "op-1", 1, 30)
                .expect("acknowledge head")
        );
        assert_eq!(database.pending_profile_outbox_count("alice").unwrap(), 1);
        assert_eq!(
            database
                .profile_sync_worker_state("alice")
                .expect("read worker state")
                .expect("worker state"),
            ProfileSyncWorkerState {
                username: "alice".to_owned(),
                device_id: "device-a".to_owned(),
                next_local_seq: 3,
                last_pushed_seq: Some(1),
                last_remote_generation_json: None,
                last_sync_at_ms: Some(30),
                last_sync_error: None,
                next_attempt_at_ms: None,
                auth_blocked_at_ms: None,
                auth_blocked_error: None,
            }
        );

        assert!(
            database
                .ack_profile_outbox_head("alice", "op-2", 2, 40)
                .expect("acknowledge next head")
        );
        assert_eq!(
            database
                .profile_sync_worker_state("alice")
                .unwrap()
                .unwrap()
                .last_pushed_seq,
            Some(2)
        );
    }

    #[test]
    fn recording_a_head_failure_persists_retry_state_without_skipping_the_queue() {
        let temp_dir = TestDir::new();
        let database =
            DesktopSqlite::initialize(temp_dir.path.join("desktop.sqlite3")).expect("sqlite");
        for (op_id, timestamp_ms) in [("op-1", 10), ("op-2", 20)] {
            database
                .apply_profile_mutation(ProfileMutationWrite {
                    username: "alice",
                    device_id: "device-a",
                    domain_metadata_key: "profile:alice:favorites",
                    domain: "favorites",
                    entity_key: Some(op_id),
                    operation: "upsert",
                    snapshot_json: "{}",
                    payload_json: None,
                    op_id,
                    timestamp_ms,
                })
                .expect("enqueue mutation");
        }

        assert!(
            !database
                .record_profile_outbox_head_failure("alice", "op-2", 2, 30, 50, "offline")
                .expect("reject non-head failure")
        );
        assert!(
            database
                .record_profile_outbox_head_failure("alice", "op-1", 1, 30, 50, "offline")
                .expect("record head failure")
        );

        assert!(
            database
                .list_due_profile_outbox("alice", 49, 10)
                .expect("query before retry")
                .is_empty()
        );
        let retried = database
            .list_due_profile_outbox("alice", 50, 10)
            .expect("query retry");
        assert_eq!(retried.len(), 1);
        assert_eq!(retried[0].op_id, "op-1");
        assert_eq!(retried[0].attempt_count, 1);
        assert_eq!(retried[0].last_error.as_deref(), Some("offline"));
        assert_eq!(
            database
                .profile_sync_worker_state("alice")
                .expect("read worker state")
                .expect("worker state"),
            ProfileSyncWorkerState {
                username: "alice".to_owned(),
                device_id: "device-a".to_owned(),
                next_local_seq: 3,
                last_pushed_seq: None,
                last_remote_generation_json: None,
                last_sync_at_ms: Some(30),
                last_sync_error: Some("offline".to_owned()),
                next_attempt_at_ms: Some(50),
                auth_blocked_at_ms: None,
                auth_blocked_error: None,
            }
        );
    }

    #[test]
    fn latest_auth_blocked_worker_state_selects_most_recent_profile() {
        let temp_dir = TestDir::new();
        let database =
            DesktopSqlite::initialize(temp_dir.path.join("desktop.sqlite3")).expect("sqlite");

        for (username, op_id, timestamp_ms) in [("alice", "op-alice", 10), ("bob", "op-bob", 20)] {
            database
                .apply_profile_mutation(ProfileMutationWrite {
                    username,
                    device_id: "device-a",
                    domain_metadata_key: "profile:test:favorites",
                    domain: "favorites",
                    entity_key: Some("demo"),
                    operation: "upsert",
                    snapshot_json: "{}",
                    payload_json: None,
                    op_id,
                    timestamp_ms,
                })
                .expect("enqueue mutation");
        }
        database
            .block_profile_sync_auth("alice", 30, "alice session expired")
            .expect("block alice");
        database
            .block_profile_sync_auth("bob", 40, "bob session expired")
            .expect("block bob");

        assert_eq!(
            database
                .latest_auth_blocked_profile_sync_worker_state()
                .expect("read latest auth block")
                .expect("blocked worker state"),
            ProfileSyncWorkerState {
                username: "bob".to_owned(),
                device_id: "device-a".to_owned(),
                next_local_seq: 2,
                last_pushed_seq: None,
                last_remote_generation_json: None,
                last_sync_at_ms: Some(40),
                last_sync_error: Some("bob session expired".to_owned()),
                next_attempt_at_ms: None,
                auth_blocked_at_ms: Some(40),
                auth_blocked_error: Some("bob session expired".to_owned()),
            }
        );
    }

    #[test]
    fn auth_block_is_persisted_and_can_be_cleared() {
        let temp_dir = TestDir::new();
        let database =
            DesktopSqlite::initialize(temp_dir.path.join("desktop.sqlite3")).expect("sqlite");
        database
            .apply_profile_mutation(ProfileMutationWrite {
                username: "alice",
                device_id: "device-a",
                domain_metadata_key: "profile:alice:favorites",
                domain: "favorites",
                entity_key: Some("demo"),
                operation: "upsert",
                snapshot_json: "{}",
                payload_json: None,
                op_id: "op-1",
                timestamp_ms: 10,
            })
            .expect("enqueue mutation");

        assert!(
            database
                .block_profile_sync_auth("alice", 30, "remote session expired")
                .expect("persist auth block")
        );
        let blocked = database
            .profile_sync_worker_state("alice")
            .expect("read blocked worker state")
            .expect("worker state");
        assert_eq!(blocked.auth_blocked_at_ms, Some(30));
        assert_eq!(
            blocked.auth_blocked_error.as_deref(),
            Some("remote session expired")
        );

        assert!(
            database
                .clear_profile_sync_auth_block("alice", 40)
                .expect("clear auth block")
        );
        assert!(
            !database
                .clear_profile_sync_auth_block("alice", 41)
                .expect("clearing an absent auth block is a no-op")
        );
        let cleared = database
            .profile_sync_worker_state("alice")
            .expect("read cleared worker state")
            .expect("worker state");
        assert_eq!(cleared.auth_blocked_at_ms, None);
        assert_eq!(cleared.auth_blocked_error, None);
    }

    #[test]
    fn duplicate_operation_rolls_back_snapshot_and_sequence() {
        let temp_dir = TestDir::new();
        let database =
            DesktopSqlite::initialize(temp_dir.path.join("desktop.sqlite3")).expect("sqlite");
        database
            .apply_profile_mutation(ProfileMutationWrite {
                username: "alice",
                device_id: "device-a",
                domain_metadata_key: "profile:alice:favorites",
                domain: "favorites",
                entity_key: Some("demo+1"),
                operation: "upsert",
                snapshot_json: r#"{"v":1}"#,
                payload_json: None,
                op_id: "same-op",
                timestamp_ms: 10,
            })
            .unwrap();
        assert!(
            database
                .apply_profile_mutation(ProfileMutationWrite {
                    username: "alice",
                    device_id: "device-a",
                    domain_metadata_key: "profile:alice:favorites",
                    domain: "favorites",
                    entity_key: Some("demo+1"),
                    operation: "upsert",
                    snapshot_json: r#"{"v":2}"#,
                    payload_json: None,
                    op_id: "same-op",
                    timestamp_ms: 10,
                })
                .is_err()
        );
        assert_eq!(
            database
                .read_app_metadata::<Value>("profile:alice:favorites")
                .unwrap(),
            Some(serde_json::json!({"v": 1}))
        );
        let next = database
            .apply_profile_mutation(ProfileMutationWrite {
                username: "alice",
                device_id: "device-a",
                domain_metadata_key: "profile:alice:favorites",
                domain: "favorites",
                entity_key: Some("demo+1"),
                operation: "upsert",
                snapshot_json: r#"{"v":3}"#,
                payload_json: None,
                op_id: "next-op",
                timestamp_ms: 20,
            })
            .unwrap();
        assert_eq!(next, 2);
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
