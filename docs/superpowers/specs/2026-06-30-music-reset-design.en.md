# LunaTV Legacy Music Module Hard-Delete (硬删除) and Rebuild Preparation Design

**Goal**

Fully remove the current legacy music module from the active `desktop` worktree (工作树), including code, routes, IPC (进程间通信), config flags, and tests, so the desktop app returns to a clean “no music module for now” state. Keep only the non-music desktop shell, windowing, sidecar (伴随服务), updater, and video-related capabilities, so a later `Rust + TypeScript + Tauri` music-center rebuild starts from clear boundaries (清晰边界).

**Confirmed Decisions**

1. The merged target state keeps no placeholder page, no `music-legacy` reference area, and no long-lived `410` / `LEGACY_MUSIC_DISABLED` compatibility layer (兼容层)
2. `src/app/music/page.tsx` will be deleted, and `/music` returns to an unimplemented state; requests fall back to the app's default `404` / `not-found` behavior until the new music center reclaims that path
3. `src/app/api/music/**` will be deleted, and legacy music HTTP endpoints will stop existing
4. `src/features/music/**` will be deleted, and the old frontend implementation will not move into any `legacy` directory
5. Legacy Tauri music IPC, tray menus, desktop download features, and frontend desktop bridges (桌面桥接) will be deleted instead of being kept in a disabled state
6. Desktop windows, sidecar services (sidecar 服务), local service flow, auto-update, auth, video, live, and non-music download capabilities stay in place
7. Historical music user data, local audio files, and download records are not auto-deleted in this phase; this phase only removes active code references, and any future cleanup needs a separate data-cleanup design (数据清理方案)
8. This spec covers legacy-music deletion only; it does not define any new music-module directories, interfaces, routes, namespaces, or rebuild tasks

**Scope**

- Delete legacy music routes, pages, components, state, services, tests, and API directories
- Delete the global music mount in the root layout and every primary navigation music entry
- Delete legacy music desktop IPC, tray wiring, and download bridges
- Delete `crates/moontv-local-service/src/music_api.rs`, the old `/media/audio/stream` proxy chain, and their local-service registrations
- Delete every legacy music profile-sync proxy, local handler, payload, and validator inside `crates/moontv-local-service/src/profile_sync.rs` and `crates/moontv-local-service/src/profile_local.rs`
- Delete every legacy music record schema, map type, and `load/save/clear_music_*` storage helper inside `crates/moontv-profile/src/lib.rs`
- Delete legacy music types, storage interfaces, profile services, and runtime projection logic (运行时投影逻辑) from shared layers (共享层)
- Delete the active `EnableWebMusic` meaning from admin and public runtime configuration
- Preserve all non-music desktop infrastructure and the current video-first main flows

**Out of Scope**

- Do not ship the new YesPlayMusic UI, playback core, or audio-arbitration logic (音频互斥逻辑) in this phase
- Do not pre-create new `src/features/music/**`, `src/desktop/modules/music/**`, or any future scaffolding (脚手架)
- Do not migrate, transform, or purge historical music data in this phase
- Do not keep compatibility shims (兼容垫片), rollback pages, or feature flags for the old music system
- Do not leave implementation files, proxy routes, or placeholder APIs behind for a future music-center rebuild

**Current Coupling Map (耦合图)**

The current legacy music feature is not isolated to one page. It is spread across the following active areas:

- Route and UI entry points
  - `src/app/music/page.tsx`
  - `src/features/music/app/MusicPageShell`
  - `src/features/music/components/MusicPlayerRoot.tsx`
  - `src/components/Sidebar.tsx`
  - `src/components/MobileBottomNav.tsx`
  - `src/app/layout.tsx`
- HTTP routes
  - There are currently 20 route handlers (路由处理器) under `src/app/api/music/**`
- Shared runtime and config
  - `src/lib/runtime/public-config.ts`
  - `src/lib/runtime-config.ts`
  - `src/lib/desktop/runtime-config.ts`
  - `src/lib/config.ts`
  - `src/lib/admin.types.ts`
  - `src/app/api/admin/site/route.ts`
  - `src/app/admin/page.tsx`
- Shared storage and profile services
  - `crates/moontv-profile/src/lib.rs`
  - `src/lib/types.ts`
  - `src/lib/db.ts`
  - `src/lib/redis-base.db.ts`
  - `src/lib/upstash.db.ts`
  - `src/lib/core/profile/music-user-data-service.ts`
- Local HTTP service
  - `crates/moontv-local-service/src/lib.rs`
  - `crates/moontv-local-service/src/music_api.rs`
  - `crates/moontv-local-service/src/profile_sync.rs`
  - `crates/moontv-local-service/src/profile_local.rs`
  - legacy `/api/music/*` and `/media/audio/stream` aggregation / proxy paths
- Desktop bridge and Tauri
  - `src/lib/desktop/tauri-client.ts`
  - `src-tauri/src/lib.rs`
  - `src-tauri/capabilities/default.json`
  - `src-tauri/gen/schemas/capabilities.json`
- Tests
  - `src/app/music/page.test.tsx`
  - `src/features/music/tests/**`
  - `src/lib/config.test.ts`
  - `src/lib/runtime/public-config.test.ts`
  - `src/lib/desktop/runtime-config.test.ts`
  - `src/components/Sidebar.test.tsx`
  - plus every test that still references `EnableWebMusic`, `/api/music/*`, `MusicPlayerRoot`, or `music-tray`

This means “delete only the `/music` page” is not a real deletion. Shared, desktop, and config-level dependencies must be removed together.

**Target End State**

Routes and navigation:

- `src/app/music/page.tsx` does not exist in the merged state
- `/music` has no active implementation and falls back to the app's default `404` / `not-found`
- The sidebar, mobile bottom navigation, and other primary entry points no longer show “Music”
- The root layout no longer mounts `MusicPlayerRoot`

HTTP and config:

- `src/app/api/music/**` does not exist in the merged state
- No `410` compatibility handlers remain; the old endpoints are simply gone
- Admin no longer shows `EnableWebMusic`
- `src/lib/runtime/public-config.ts` no longer projects `ENABLE_WEB_MUSIC`, and no longer reads `NEXT_PUBLIC_ENABLE_WEB_MUSIC`
- The desktop runtime bootstrap script in `src/app/layout.tsx` no longer synthesizes (合成) `ENABLE_WEB_MUSIC`
- `src/lib/runtime-config.ts` and `src/lib/desktop/runtime-config.ts` no longer define `ENABLE_WEB_MUSIC` / `enableWebMusic` fields or merge logic
- `src/app/api/admin/site/route.ts`, `src/lib/config.ts`, and `src/lib/admin.types.ts` no longer treat `EnableWebMusic` as an active field
- The desktop-local config schema, defaults, and normalization path inside `crates/moontv-local-service/src/lib.rs` no longer keep `EnableWebMusic` / `enable_web_music`, and may no longer write that field back to disk through `DesktopSiteConfig`, `DesktopAdminConfig`, `default_enable_web_music`, `normalize_desktop_site_config`, or related import/export logic
- Even if a historical config file still contains an `EnableWebMusic` key, the read path may only tolerate it; once config is rewritten and saved, the field must be stripped from persisted data and may no longer affect behavior

Desktop, local service, and Tauri:

- `src/lib/desktop/tauri-client.ts` keeps no legacy music download, tray, or playback-path bridge APIs
- `crates/moontv-local-service/src/lib.rs` exposes no legacy music `/api/music/*` routes, `/media/audio/stream`, profile-sync entry points, or `enableWebMusic` runtime/bootstrap payload
- `crates/moontv-local-service/src/lib.rs` keeps no `enable_web_music` field, `mod music_api;`, `use music_api::{...}`, or `get_music_audio_stream`
- `crates/moontv-local-service/src/profile_sync.rs` and `crates/moontv-local-service/src/profile_local.rs` keep no `proxy_profile_sync_music_*`, `handle_music_profile_*`, `validate_music_*`, `SaveMusic*Payload`, or other legacy music profile logic
- `crates/moontv-local-service/src/music_api.rs` is deleted in the merged state
- `src-tauri/src/lib.rs` keeps no legacy music tray constants, menus, events, download commands, `DesktopMusicDownload*` payload / status types, `music_downloads_*` path helpers, or `MUSIC_DOWNLOADS_*` constants
- If the repository has no other active tray consumer, `src-tauri/Cargo.toml` no longer keeps the `tray-icon` feature, `src-tauri/capabilities/default.json` no longer grants tray permission through `core:default` or explicit `core:tray:*`, and `src-tauri/gen/schemas/capabilities.json` stays aligned with that narrower capability set; tray permission definitions inside `src-tauri/gen/schemas/*-schema.json` are part of Tauri's generic schema and are not by themselves evidence that this project still uses tray
- The desktop shell still keeps windows, sidecar, local service, updater, and non-music IPC

Shared types and storage:

- `crates/moontv-profile/src/lib.rs` no longer defines or exports `MusicFavoriteRecord`, `MusicRecentTrackRecord`, `MusicPlayRecord`, `MusicFavoriteMap`, `MusicPlayRecordMap`, `MusicRecentTrackList`, or any `load/save/clear_music_*` helper
- Active shared layers (共享层) no longer import any legacy music types
- `IStorage`, `DbManager`, and storage drivers (存储驱动) no longer expose music CRUD
- `src/lib/core/profile/music-user-data-service.ts` is deleted and no legacy music profile write path remains

Data semantics (数据语义):

- Legacy music data moves from “active data” to “unreachable orphaned data (不可达孤儿数据)”
- No merged runtime code may read, refresh, write, or migrate that legacy music data

**Hard-Delete Strategy**

This removal is judged by the cleanliness of the final merged state, not by whether intermediate commits preserve compatibility.

1. Delete every user-visible legacy music entry point
2. Delete every server-side and desktop-side legacy music capability
3. Delete every shared-layer legacy music type and storage interface
4. Delete the full legacy music implementation and tests
5. Use Git history as the only rollback source (回滚来源), instead of keeping dormant code in the working tree

The key rules are:

- do not build `music-legacy`
- do not extract `music-contracts`
- do not keep long-lived disabled shells
- do not keep a temporary placeholder layer that would need to be deleted again later
- Git history is the only reference source for revisiting old implementation code during a future rebuild; project documentation may remain as historical process record, but no extra legacy implementation asset or dormant legacy music implementation file stays in the active worktree

**Deletion Phases**

`Phase 1`: cut visible entry points and the global mount

- Delete `src/app/music/page.tsx`
- Remove the `src/features/music/components/MusicPlayerRoot.tsx` mount from `src/app/layout.tsx`
- Remove the music entry from `src/components/Sidebar.tsx` and `src/components/MobileBottomNav.tsx`
- Remove any still-active UI logic that directly routes users to `/music`

`Phase 2`: delete HTTP, config, and admin semantics

- Delete `src/app/api/music/**`
- Remove `EnableWebMusic` UI, state, and submit logic from `src/app/admin/page.tsx`
- Remove `EnableWebMusic` reads, writes, and validation from `src/app/api/admin/site/route.ts`
- Remove the `ENABLE_WEB_MUSIC` projection from `src/lib/runtime/public-config.ts`, and remove the legacy `NEXT_PUBLIC_ENABLE_WEB_MUSIC` environment-variable read
- Remove `ENABLE_WEB_MUSIC` synthesis from the runtime bootstrap script in `src/app/layout.tsx`
- Remove the `ENABLE_WEB_MUSIC` runtime field from `src/lib/runtime-config.ts`
- Remove the `enableWebMusic` payload field and `ENABLE_WEB_MUSIC` merge logic from `src/lib/desktop/runtime-config.ts`
- Remove active `EnableWebMusic` definitions from `src/lib/config.ts`, `src/lib/admin.types.ts`, and related tests; `configSelfCheck()` inside `src/lib/config.ts` (or any equivalent Web-side `AdminConfig` sanitizer (配置清洗器)) may no longer backfill (补默认值) that field by default, and it must strip historical `EnableWebMusic` from the persisted (持久化的) `SiteConfig` object in `src/app/api/admin/profile-sync/merge/route.ts`, `src/app/api/admin/data_migration/import/route.ts`, and every other Web write path that persists `AdminConfig` through `db.saveAdminConfig()`
- Explicitly audit the repo-root `config.example.json` so the default config file itself no longer contains legacy music fields; the bundled-default-config (打包默认配置) entry points in `src/lib/runtime/config-source.ts` via `readBundledDefaultConfigFile()` and in `src-tauri/src/lib.rs` via `DEFAULT_DESKTOP_CONFIG` may not reintroduce or backfill (补默认值) `EnableWebMusic` / `enable_web_music`
- Remove the `EnableWebMusic` / `enable_web_music` config field from `DesktopSiteConfig` / `DesktopAdminConfig` in `crates/moontv-local-service/src/lib.rs`, remove `default_enable_web_music`, and delete every retention point for that field in `normalize_desktop_site_config`, default-config builders, config import/export, and config write paths
- Treat any historical config residue (残留值) with a “tolerate on read, strip on write” rule; no config save or rewrite path may persist `EnableWebMusic` again

`Phase 3`: delete shared-layer legacy music dependencies

- Remove the following legacy music schema and storage helpers from `crates/moontv-profile/src/lib.rs`
  - `MusicFavoriteRecord`
  - `MusicRecentTrackRecord`
  - `MusicPlayRecord`
  - `MusicFavoriteMap`
  - `MusicPlayRecordMap`
  - `MusicRecentTrackList`
  - `MUSIC_FAVORITES_DOMAIN_KEY`
  - `MUSIC_RECENT_TRACKS_DOMAIN_KEY`
  - `MUSIC_PLAY_RECORDS_DOMAIN_KEY`
  - `load_music_*`
  - `save_music_*`
  - `clear_music_*`
- Delete `src/lib/core/profile/music-user-data-service.ts`
- Remove all music interfaces from `IStorage` in `src/lib/types.ts`
- Remove all music methods from `src/lib/db.ts`
- Remove music data reads and writes from `src/lib/redis-base.db.ts`, `src/lib/upstash.db.ts`, and any other storage implementation
- Keep non-music migration logic, but remove every `u:*:music:*` scan, transfer, or normalization branch from `migrateData()` so startup no longer touches orphaned legacy music data
- Clean every shared-layer import that still points at `@/features/music/**`

`Phase 4`: delete desktop bridge, local service, and Tauri legacy music capabilities

- Remove the following legacy music bridge APIs from `src/lib/desktop/tauri-client.ts`
  - `updateDesktopMusicTrayState`
  - `listenDesktopMusicTrayCommands`
  - `listDesktopMusicDownloads`
  - `downloadDesktopMusicTrack`
  - `deleteDesktopMusicDownload`
  - `resolveDesktopMusicDownloadPlayback`
- Remove the following legacy music capabilities from `crates/moontv-local-service/src/lib.rs`
  - `/api/music/profile/favorites`
  - `/api/music/profile/recent-tracks`
  - `/api/music/profile/play-records`
  - `/api/music/sources`
  - `/api/music/home`
  - `/api/music/search`
  - `/api/music/collection`
  - `/api/music/track`
  - `/api/music/lyric`
  - `/media/audio/stream`
  - `enableWebMusic` projection in runtime public config and `/api/profile/bootstrap`
  - `enable_web_music` inside `RuntimePublicConfigResponse` and related structs
  - `mod music_api;`, `use music_api::{...}`, and `get_music_audio_stream`
  - legacy music provider glue, DTOs, and related tests
- Delete `crates/moontv-local-service/src/music_api.rs`
- Remove the following legacy music capabilities from `crates/moontv-local-service/src/profile_sync.rs` and `crates/moontv-local-service/src/profile_local.rs`
  - `proxy_profile_sync_music_favorites`
  - `proxy_profile_sync_music_recent_tracks`
  - `proxy_profile_sync_music_play_records`
  - `handle_music_profile_favorites`
  - `handle_music_profile_recent_tracks`
  - `handle_music_profile_play_records`
  - `validate_music_*`
  - `validate_music_queue_identity`
  - `MUSIC_RECENT_TRACKS_LIMIT`
  - `SaveMusic*Payload` and any other payload / DTO used only by legacy music profile flows
- Remove the following legacy music capabilities from `src-tauri/src/lib.rs`
  - `MUSIC_TRAY_*` constants
  - legacy music tray installation, menus, and event dispatch
  - `update_music_tray_state`
  - `list_music_downloads`
  - `download_music_track`
  - `delete_music_download`
  - `resolve_music_download_playback`
  - `DesktopMusicDownloadStatus`
  - `DesktopMusicDownloadRecordPayload`
  - `DesktopMusicDownloadPlaybackPathPayload`
  - `build_music_download_id`
  - `music_downloads_dir`
  - `music_downloads_audio_dir`
  - `music_downloads_records_path`
  - `MUSIC_DOWNLOADS_DIR_NAME`
  - `MUSIC_DOWNLOADS_AUDIO_DIR_NAME`
  - `MUSIC_DOWNLOADS_RECORDS_FILE_NAME`
  - every other `music_download_*` download helper, file-path builder, record repair/sort helper, test helper, and implementation detail
- If the repository has no other active tray consumer, remove the `tray-icon` feature from `tauri` in `src-tauri/Cargo.toml`, and tighten `src-tauri/capabilities/default.json` so it no longer grants tray permission through `core:default` or explicit `core:tray:*`; then refresh `src-tauri/gen/schemas/capabilities.json` and any other affected generated artifacts. Tray permission definitions inside `src-tauri/gen/schemas/*-schema.json` belong to Tauri's generic schema and are not by themselves evidence that tray is still in use

`Phase 5`: delete module source, tests, and run the final sweep

- Delete `src/features/music/**`
- Delete `src/app/music/page.test.tsx`
- Delete `src/features/music/tests/**`
- Update `src/lib/config.test.ts`, `src/lib/runtime/public-config.test.ts`, `src/lib/desktop/runtime-config.test.ts`, `src/components/Sidebar.test.tsx`, and any other tests that still mention the old music flag or entry points
- Delete or rewrite the old local-service music-route, audio-stream, music-profile, and runtime/bootstrap assertion tests inside `crates/moontv-local-service/src/lib.rs`, `profile_sync.rs`, and `profile_local.rs`
- Run repo-wide `rg` checks so active code no longer contains `EnableWebMusic`, `ENABLE_WEB_MUSIC`, `enableWebMusic`, `enable_web_music`, `/api/music`, `/media/audio/stream`, `MusicPlayerRoot`, `MUSIC_TRAY_`, `music-tray`, `music_tray`, `MusicTray`, `DesktopMusicTray`, `DesktopMusicTrack`, `open_music_from_tray`, `update_music_tray_state`, `delete_music_download`, `download_music_track`, `list_music_downloads`, `resolve_music_download_playback`, `music_download_`, `get_music_audio_stream`, `mod music_api`, `use music_api`, `proxy_profile_sync_music_`, `handle_music_profile_`, `validate_music_`, `validate_music_queue_identity`, `SaveMusic`, `MusicFavoriteRecord`, `MusicRecentTrackRecord`, `MusicPlayRecord`, `MusicPlaybackSession`, `MusicPreferences`, `SavedMusicCollectionRecord`, `MusicFavoriteMap`, `MusicPlayRecordMap`, `MusicRecentTrackList`, `DesktopMusicDownload`, `build_music_download_id`, `music_downloads_`, `music_download_record`, `MUSIC_DOWNLOADS_`, `MUSIC_FAVORITES_DOMAIN_KEY`, `MUSIC_RECENT_TRACKS_DOMAIN_KEY`, `MUSIC_PLAY_RECORDS_DOMAIN_KEY`, `MUSIC_RECENT_TRACKS_LIMIT`, `getMusic[A-Z]`, `saveMusic[A-Z]`, `setMusic[A-Z]`, `deleteMusic[A-Z]`, `clearMusic[A-Z]`, `load_music_`, `save_music_`, `clear_music_`, or similar legacy markers

**Shared Dependency Teardown Rules**

- Shared layers must delete legacy music interfaces directly, not move the old music types to a new shared location
- This removal does not introduce `src/lib/music-contracts/**`
- This removal does not keep extra abstractions “just in case” for future reuse; when the new music center is designed, its contracts can be created fresh under the new boundaries
- After deletion, active code should have no imports from non-music areas into the old music directory

**Desktop, Local Service, and Tauri Preservation Boundary**

Keep:

- Existing window, build-command, and sidecar configuration in `src-tauri/tauri.conf.json`
- Non-music desktop shell, local service, updater, auth, and window-lifecycle code in `src-tauri/src/main.rs` and `src-tauri/src/lib.rs`
- Non-music local HTTP service, profile sync, admin, and runtime-bootstrap flows inside `crates/moontv-local-service/**`
- Non-music generic IPC façade (外观层) in `src/lib/desktop/tauri-client.ts`
- Video, live, downloads, updates, login, and the current desktop layout

Delete:

- every legacy music tray
- every legacy music download command and record-management path
- every legacy music playback-path resolver
- every legacy music desktop event listener
- every legacy music local-service route, audio-stream proxy, music-profile sync / local handler, bootstrap payload field, `music_api.rs` source file, and related test

**Legacy Data Policy**

This phase does not physically delete user music data by default because code deletion and data cleanup are two different risk surfaces (风险面).

Data that stays on disk or in storage but becomes disconnected includes:

- historical keys under the `u:{user}:music:*` namespace
- historical `music-downloads.json` under the Tauri data directory
- local audio files inside the legacy music download directory

Rules:

- delete all active read and write code
- delete every startup-migration path that still touches the legacy music namespace
- do not auto-clean, overwrite, or migrate this data in this phase
- document it clearly as orphaned data (孤儿数据)
- the future music center may not silently reuse the same `music` namespace, and it may not silently reuse these legacy Tauri disk paths or file names either (such as the `music` downloads directory, its `audio` subdirectory, or `music-downloads.json`); it must either use versioned namespaces / paths such as `music-v2` or ship a separately approved cleanup / migration plan before reusing them
- if cleanup is needed later, require a separate backup-and-cleanup design plus explicit approval

**Test and CI Impact**

- Legacy music tests are deleted as a whole; they are not rewritten into a disabled-state test suite
- Every config test, desktop runtime-refresh test, and navigation test that still references `EnableWebMusic` / `ENABLE_WEB_MUSIC` / `NEXT_PUBLIC_ENABLE_WEB_MUSIC` / `enableWebMusic` must be reduced or rewritten
- Web-side admin-config write-path regression tests (写路径回归测试) must explicitly cover `src/lib/config.test.ts`, `src/app/api/admin/profile-sync/merge/route.test.ts`, and the admin-config import path, asserting that historical `EnableWebMusic` input no longer survives into the final persisted (持久化的) `SiteConfig` after `configSelfCheck()`, profile-sync merge, or import-save flows
- Every test that still references `/api/music/*`, `/media/audio/stream`, `MusicPlayerRoot`, desktop music downloads, tray behavior, local-service legacy music routes, `enable_web_music`, `get_music_audio_stream`, `proxy_profile_sync_music_`, `handle_music_profile_`, or `validate_music_` must be deleted or rewritten
- After removal, at minimum run:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test -- --runInBand` or the repository's current equivalent baseline test command
  - `pnpm desktop:check`
  - `pnpm desktop:test`
  - `pnpm desktop:build:frontend`
  - `rg -n "EnableWebMusic|ENABLE_WEB_MUSIC|NEXT_PUBLIC_ENABLE_WEB_MUSIC|enableWebMusic|enable_web_music|/api/music|/media/audio/stream|MusicPlayerRoot|MUSIC_TRAY_|music-tray|music_tray|MusicTray|DesktopMusicTray|DesktopMusicTrack|open_music_from_tray|update_music_tray_state|delete_music_download|download_music_track|list_music_downloads|resolve_music_download_playback|music_download_|get_music_audio_stream|mod music_api|use music_api|proxy_profile_sync_music_|handle_music_profile_|validate_music_|validate_music_queue_identity|SaveMusic|MusicFavoriteRecord|MusicRecentTrackRecord|MusicPlayRecord|MusicPlaybackSession|MusicPreferences|SavedMusicCollectionRecord|MusicFavoriteMap|MusicPlayRecordMap|MusicRecentTrackList|DesktopMusicDownload|build_music_download_id|music_downloads_|music_download_record|MUSIC_DOWNLOADS_|MUSIC_FAVORITES_DOMAIN_KEY|MUSIC_RECENT_TRACKS_DOMAIN_KEY|MUSIC_PLAY_RECORDS_DOMAIN_KEY|MUSIC_RECENT_TRACKS_LIMIT|u:\\*:music:\\*|u:\\{user\\}:music:\\*|getMusic[A-Z]|saveMusic[A-Z]|setMusic[A-Z]|deleteMusic[A-Z]|clearMusic[A-Z]|load_music_|save_music_|clear_music_" config.example.json src src-tauri crates desktop-shell-dist --glob '!**/*.md'`
  - `rg -n "/music" src --glob '!src/app/music/**' --glob '!src/app/api/music/**' --glob '!src/features/music/**' --glob '!**/*.test.*'` to confirm active runtime code no longer keeps direct navigation / redirect logic to `/music`
  - `test ! -e desktop-shell-dist/music.html && test ! -e desktop-shell-dist/music.txt` to confirm the desktop export no longer keeps `/music` page files
  - `test ! -d desktop-shell-dist/_next/static/chunks/app/music` to confirm the desktop export no longer keeps the `/music` route chunk directory
  - If the repository has no other active tray consumer, also run `rg -n "tray-icon" src-tauri/Cargo.toml` and `rg -n '"core:default"|core:tray:' src-tauri/capabilities/default.json src-tauri/gen/schemas/capabilities.json` to confirm no orphaned tray feature / capability remains; do not treat entries from Tauri's generic schema files under `src-tauri/gen/schemas/*-schema.json` as failure signals

**Rollback Strategy**

- Do not keep dormant legacy music code in the working tree as a rollback mechanism
- If rollback is needed, use Git history, commits, or a temporary recovery branch
- This is simpler than carrying a permanently disabled `legacy` codebase or local-service legacy music implementation file that still has to compile, lint, and be maintained, and it matches KISS / YAGNI

**Acceptance Criteria**

1. `src/features/music/**`, `src/app/api/music/**`, `src/app/music/**`, `src/lib/core/profile/music-user-data-service.ts`, and `crates/moontv-local-service/src/music_api.rs` are deleted from the merged state
2. `src/app/layout.tsx` no longer mounts `MusicPlayerRoot`
3. The sidebar, mobile bottom navigation, and other primary entry points no longer show a music entry, and active UI code no longer keeps direct navigation / redirect logic to `/music`
4. `EnableWebMusic` / `ENABLE_WEB_MUSIC` / `NEXT_PUBLIC_ENABLE_WEB_MUSIC` / `enableWebMusic` / `enable_web_music` no longer appears in active runtime code, the desktop runtime-refresh path, admin code, or public config projection
   - This also includes `configSelfCheck()` in `src/lib/config.ts`, `src/app/api/admin/profile-sync/merge/route.ts`, `src/app/api/admin/data_migration/import/route.ts`, and every other Web-side `AdminConfig` save chain; no historical `EnableWebMusic` may be passed back into persisted config through `db.saveAdminConfig()`
   - This also includes the repo-root `config.example.json`, plus the bundled-default-config entry points in `src/lib/runtime/config-source.ts` and `src-tauri/src/lib.rs`
   - This also includes the desktop-local config schema, defaults, and normalization / write paths inside `crates/moontv-local-service/src/lib.rs`
5. `src/lib/desktop/tauri-client.ts`, `crates/moontv-local-service/src/lib.rs`, `profile_sync.rs`, `profile_local.rs`, `crates/moontv-profile/src/lib.rs`, and `src-tauri/src/lib.rs` no longer contain legacy music bridge code, `/api/music/*` local-service handlers, `/media/audio/stream`, runtime/bootstrap `enableWebMusic` projection, `get_music_audio_stream`, `mod music_api`, `use music_api`, `proxy_profile_sync_music_*`, `handle_music_profile_*`, `validate_music_queue_identity`, `MUSIC_TRAY_*`, `music_tray*`, `MusicTray*`, `DesktopMusicTray*`, `DesktopMusicTrack*`, `DesktopMusicDownload*`, `build_music_download_id`, `delete_music_download`, `open_music_from_tray`, `music_download_*`, `music_downloads_*`, `music_download_record*`, `MUSIC_DOWNLOADS_*`, `MUSIC_*_DOMAIN_KEY`, or legacy music tray, download, and playback-path IPC, including `resolve_music_download_playback`
6. If the repository has no other active tray consumer, `src-tauri/Cargo.toml` no longer keeps the legacy-music-only `tray-icon` feature, `src-tauri/capabilities/default.json` no longer grants tray permission through `core:default` or explicit `core:tray:*`, and `src-tauri/gen/schemas/capabilities.json` reflects that narrower capability set; Tauri's generic permission definitions inside `src-tauri/gen/schemas/*-schema.json` are not failure criteria
7. `crates/moontv-profile/src/lib.rs`, active shared layers, and storage implementations no longer define, import, or expose any legacy music record schema, map type, profile helper, or music storage interface, and startup migration logic no longer scans or transfers `u:*:music:*`
8. Historical `EnableWebMusic` residue does not break read paths, but any config rewrite stops persisting it; this covers the Web-side `configSelfCheck()` + `db.saveAdminConfig()` chain, admin-config merge / import write paths, and Rust local-service write paths
9. Legacy-music keyword scans over `config.example.json`, `src/**`, `src-tauri/**`, `crates/**`, and `desktop-shell-dist/**` return no hits
10. `desktop-shell-dist/**` is regenerated from current source; because Tauri `frontendDist` points at that directory, the merged state keeps no legacy music page files (such as `music.html` or `music.txt`), no `_next/static/chunks/app/music/**` route chunk, no legacy entry point, and no `ENABLE_WEB_MUSIC` desktop-frontend artifact there
11. Historical records may remain in documentation, and Git history remains the only code-reference source; outside documentation, no extra legacy reference assets remain in the active worktree
12. `pnpm lint`, `pnpm typecheck`, `pnpm desktop:check`, `pnpm desktop:test`, `pnpm desktop:build:frontend`, and baseline project tests pass

**Risks and Mitigations**

- Risk: hidden shared-layer or local-service imports / routes still exist, so deleting the old directory breaks compilation or leaves legacy music endpoints reachable
  - Mitigation: run repo-wide `rg` sweeps before and after deletion, with priority checks in `src/lib/**`, `src/components/**`, `src/app/**`, `src-tauri/**`, and `crates/**`
- Risk: a legacy music stream proxy or Rust snake_case runtime field escapes the scan because it does not look like `/api/music/*`
  - Mitigation: the acceptance scan must explicitly cover `/media/audio/stream`, `enable_web_music`, `get_music_audio_stream`, `mod music_api`, and `use music_api`
- Risk: legacy music profile-sync or local-profile logic remains hidden inside generic files such as `profile_sync.rs` and `profile_local.rs`, so deleting routes still leaves dormant implementation behind
  - Mitigation: Phase 4 and acceptance must explicitly delete `proxy_profile_sync_music_*`, `handle_music_profile_*`, `validate_music_*`, and related payload / DTO code
- Risk: the low-level profile crate still keeps legacy music schema and `load/save/clear_music_*` helpers, so the old music data model survives inside active code even after routes are removed
  - Mitigation: Phase 3 and acceptance must explicitly cover deletion of legacy music record types, map types, and storage helpers from `crates/moontv-profile/src/lib.rs`
- Risk: the Tauri commands are removed but `DesktopMusicDownload*` types, `music_download_*` / `music_downloads_*` / `music_download_record*` helpers, or `MUSIC_DOWNLOADS_*` constants still remain in active Rust code
  - Mitigation: Phase 4 and acceptance must explicitly cover deletion of these download helpers / constants and include their markers in the repo-wide scan
- Risk: frontend `pnpm lint/typecheck/test` passes while `src-tauri` or `crates/**` still fails to compile or test after legacy-music deletion, creating a false “web green, desktop red” completion state
  - Mitigation: make `pnpm desktop:check` and `pnpm desktop:test` required post-removal verification, not optional follow-up checks
- Risk: the music tray logic is removed but the `tray-icon` feature in `src-tauri/Cargo.toml` or generated artifacts under `src-tauri/gen/**` still expose orphaned tray capability, leaving dead desktop capability surface (能力面)
  - Mitigation: if the repository has no other active tray consumer, Phase 4 and acceptance must remove `tray-icon` and refresh the affected Tauri generated artifacts
- Risk: even after removing the `tray-icon` feature, `src-tauri/capabilities/default.json` may still grant `core:tray:default` indirectly through `core:default`; meanwhile `src-tauri/gen/schemas/*-schema.json` naturally keeps Tauri's generic tray permission definitions, which can create a false failure or a false sense of completion
  - Mitigation: audit tray capability cleanup against `src-tauri/capabilities/default.json` and `src-tauri/gen/schemas/capabilities.json` directly, instead of treating `core:tray:*` inside generic schema files as project-level residue
- Risk: historical config or stored data makes people assume legacy music can still be restored
  - Mitigation: remove legacy music semantics from admin, public runtime, and navigation, and document that remaining data is orphaned only
- Risk: the public runtime still reads `NEXT_PUBLIC_ENABLE_WEB_MUSIC`, so legacy music flag semantics remain reachable through an env bypass
  - Mitigation: Phase 2, acceptance, and repo-wide scans must explicitly cover `NEXT_PUBLIC_ENABLE_WEB_MUSIC`
- Risk: frontend admin and public runtime remove the legacy music flag, but the Rust local-service `DesktopSiteConfig` / `DesktopAdminConfig`, defaults, or normalization write path still keeps `EnableWebMusic` / `enable_web_music`, so any later desktop config save silently persists the legacy field again
  - Mitigation: Phase 2 and acceptance must explicitly delete the field, its defaults, its normalization logic, and its config-write retention path from `crates/moontv-local-service/src/lib.rs`, so the “tolerate on read, strip on write” rule also holds for the desktop-local config chain
- Risk: Web-side admin-config merge / import write paths treat unknown `SiteConfig` fields as passthrough data (透传数据); if only the explicit type, UI, and public projection are removed, historical clients or backups can still write `EnableWebMusic` back into the database through `configSelfCheck()` -> `db.saveAdminConfig()`
  - Mitigation: Phase 2, test verification, and acceptance must explicitly cover `configSelfCheck()` in `src/lib/config.ts`, `src/app/api/admin/profile-sync/merge/route.ts`, `src/app/api/admin/data_migration/import/route.ts`, and every other `AdminConfig` persistence chain, so the legacy field is stripped on write instead of passed through
- Risk: visible navigation is removed, but command-style navigation, shortcut entry points, or other runtime logic still sends users to `/music`; if that logic lives in `hooks`, `stores`, non-music `features`, or other `src/**` areas, a narrow scan can miss it and leave a dead-end 404 path in active flows
  - Mitigation: Phase 1, verification, and acceptance must scan the full active `src/**` tree for leftover `/music` navigation logic while excluding `src/app/music/**`, `src/app/api/music/**`, and `src/features/music/**`
- Risk: legacy `music-downloads.json`, the `music` downloads directory, and its `audio` subdirectory remain on disk; if the future music center silently reuses those paths, orphaned legacy data may be mistaken for new-module state and contaminate downloads, cache, or local playback sources
  - Mitigation: extend the “do not silently reuse” rule from KV namespaces to Tauri disk directories and record file names as well; any reuse must follow a separately approved cleanup / migration plan
- Risk: source code is clean, but `desktop-shell-dist/**` still contains legacy exported frontend artifacts; because Tauri `frontendDist` points there directly, the packaged desktop app may still ship `/music` or old flag bootstrap code
  - Mitigation: make `pnpm desktop:build:frontend` mandatory verification and scan `desktop-shell-dist/**` for legacy music markers instead of checking source directories only
- Risk: even if `desktop-shell-dist/**` no longer matches the legacy keyword scan, top-level exported files such as `music.html` or `music.txt` may still remain and keep a stale `/music` shell in the packaged desktop app
  - Mitigation: verification and acceptance must explicitly assert that `desktop-shell-dist/music.html` and `desktop-shell-dist/music.txt` do not exist
- Risk: top-level `/music` page files are gone, but `desktop-shell-dist/_next/static/chunks/app/music/**` route chunks still remain, so the packaged desktop app still carries legacy music frontend code
  - Mitigation: verification and acceptance must explicitly assert that `desktop-shell-dist/_next/static/chunks/app/music` does not exist
- Risk: a repo-root scan gets polluted by caches or generated directories such as `.next*`, `target`, or `node_modules`, creating too much verification noise to tell whether active legacy music code is truly gone
  - Mitigation: focus keyword scans on `src/**`, `src-tauri/**`, `crates/**`, and `desktop-shell-dist/**`, which are the active source and shipping-input directories
- Risk: `config.example.json` sits at the repo root rather than inside a source directory, but it is still a shared default-config input (共享默认配置输入) for both Web and Tauri; if that chain is not audited explicitly, a legacy music field can flow back through the bundled default config even after source scans pass
  - Mitigation: Phase 2, repo-wide scans, and acceptance must explicitly audit `config.example.json` together with the default-config entry points in `src/lib/runtime/config-source.ts` and `src-tauri/src/lib.rs`
- Risk: generic startup migration still scans or transfers `u:*:music:*`
  - Mitigation: keep non-music migration logic, but explicitly delete every music-namespace migration branch
- Risk: future rebuild loses a useful reference implementation
  - Mitigation: treat Git history as the reference source, instead of forcing the old implementation to keep compiling in the active repository
- Risk: the desktop download directory or JSON records stay on disk for a long time
  - Mitigation: if cleanup is needed later, design export, backup, and deletion separately instead of smuggling destructive data removal into this code-deletion phase
