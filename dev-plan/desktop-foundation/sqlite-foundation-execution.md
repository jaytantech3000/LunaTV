# LunaTV Desktop SQLite Foundation Execution

## Objective

Push LunaTV desktop toward its intended local-first shape by turning the
reserved SQLite path into an actual initialized desktop database, then use
that foundation for the first local metadata domain without breaking the
current desktop experience.

This execution slice is intentionally narrower than the full desktop end-state:

- build a reusable SQLite foundation
- initialize and migrate the database on local-service startup
- add minimal observability for database readiness/schema state
- migrate desktop download store snapshot persistence from JSON file storage to
  SQLite with legacy fallback

Not in scope for this slice:

- moving `playrecords` / `favorites` / `searchhistory` / `skipconfigs` off
  `localStorage`
- moving cached media bodies or resource indexes into SQLite
- redesigning desktop auth or multi-user storage
- replacing editable JSON config files

## Why This Slice

Current desktop runtime already passes a `sqlite_path` through Tauri and the
local service, but the path is only reserved and surfaced. The live local data
path is still:

- front-end `localStorage` for user-local data
- JSON files for desktop config/admin persistence
- file-backed storage for download runtime cache and indexes

That leaves desktop in an intermediate state: the runtime contract exists, but
the database layer does not.

This slice closes that gap without forcing a risky all-at-once storage
migration.

## Desired Outcome

After this slice:

1. desktop local service always boots with a real SQLite database file
2. schema migrations are applied deterministically
3. health/status can report SQLite schema readiness
4. download store snapshot persistence no longer depends on
   `download-store.json` as the primary source of truth
5. legacy `download-store.json` can be read and folded into SQLite on demand

## Execution Plan

### Phase 1: SQLite Foundation

- [x] add a dedicated Rust storage crate for desktop SQLite concerns
- [x] add connection/bootstrap code
- [x] add migration runner
- [x] add initial schema migration
- [x] wire local-service startup to initialize the database

### Phase 2: First Real Usage

- [x] move desktop download store snapshot read/write/delete to SQLite
- [x] keep file fallback for older desktop data
- [x] remove stale legacy snapshot file after successful migration/write

### Phase 3: Observability and Validation

- [x] expose schema state in local-service health/status payload
- [x] add focused tests for initialization and snapshot round-trip
- [x] run `cargo check` / focused tests

## Completed in This Slice

- added `crates/moontv-storage` as the desktop SQLite foundation crate
- introduced deterministic migration bootstrap and schema tracking
- initialized SQLite during desktop local-service startup
- switched download store snapshot persistence to SQLite with legacy JSON
  fallback and one-time forward migration
- exposed SQLite schema version and migration count through `GET /health`
- validated with:
  - `cargo fmt --all`
  - `cargo check --workspace`
  - `cargo test -p moontv-storage`
  - `cargo test -p moontv-local-service health_route_returns_ok`
  - `cargo test -p moontv-local-service legacy_download_store_snapshot_is_migrated_into_sqlite`

## Technical Decisions

### Storage Split After This Slice

- UI preference toggles stay in `localStorage`
- editable app config stays in JSON
- download media bodies and large cache artifacts stay file-backed
- SQLite becomes the foundation for structured local desktop metadata

### Why Start With Download Store Snapshot

`/api/download-runtime/store` is already desktop-local, already owned by the
sidecar, and is lower-risk than immediately changing user-facing profile data.

It provides an actual production use of SQLite now, while keeping the larger
profile migration for a later slice.

## Acceptance Criteria

- a new desktop SQLite file is created automatically when local service starts
- restarting local service does not re-run applied migrations incorrectly
- `GET /health` includes SQLite schema information
- desktop download store snapshot CRUD works with SQLite
- existing legacy snapshot file can still be read once and migrated forward
- existing download cache and resource-index file storage remain intact

## Follow-Up After This Slice

1. move local profile data behind sidecar-owned repositories
2. migrate desktop `playrecords` / `favorites` / `searchhistory` /
   `skipconfigs` from front-end `localStorage` to local-first sidecar storage
3. decide whether resource indexes should stay file-backed or move into SQLite
4. add desktop backup/import-export around SQLite + JSON + file cache domains
