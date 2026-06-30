# LunaTV Music Reset and Placeholder-Phase Design

**Goal**

Safely retire the current `/music` UI and runtime behavior inside the active desktop worktree, while preserving the reusable `Rust + TypeScript + Tauri` desktop foundation for a later YesPlayMusic rebuild. This design is not about shipping the new player immediately. It is about finishing a controlled soft decommission (软下线), keeping the desktop infrastructure intact, stabilizing the rebuild boundaries (重建边界), and turning the migration into an executable engineering plan.

**Confirmed Decisions**

1. The current `/music` implementation will not be evolved incrementally (渐进式改造); it will be cleared and rebuilt
2. This phase uses a “clear UI only, keep desktop music infrastructure” path
3. The `/music` route stays in place, but becomes a placeholder page
4. Existing legacy music playback behavior is temporarily disabled, including background restore, continued playback, and audio-output contention (音频输出竞争)
5. Related side paths are hidden or disabled together, including primary navigation entries, tray music controls, and any legacy download or settings entry points confirmed during implementation audit
6. The placeholder phase uses explicit runtime semantics (运行时语义): direct `/music` access remains, primary navigation no longer shows music, and legacy music HTTP routes plus Tauri IPC move into a disabled state

**Scope**

- Keep the official `/music` route path, but always render a placeholder page there
- Remove the legacy global music runtime mount so application startup no longer restores legacy playback
- Hide music entries from the sidebar, mobile bottom navigation, and any other confirmed user-facing music entry points
- Disable the legacy tray menu and its related frontend event wiring
- Extract shared `music contracts / record schemas / sanitizers` before freezing the legacy module
- Preserve `src-tauri/**`, current window logic, the Tauri bridge, the local sidecar, desktop update flow, and the video desktop shell
- Preserve legacy music APIs, legacy Rust music commands, and legacy frontend music source code as dormant assets (休眠资产), while defining their placeholder-phase external behavior explicitly
- Preserve legacy music persisted data and desktop download artifacts; do not purge or migrate them in this phase
- Reserve a stable directory structure, versioned storage namespace, and boundary contract set for the upcoming YesPlayMusic rebuild

**Out of Scope**

- Do not ship the new YesPlayMusic UI or playback core in this phase
- Do not fully delete `src/features/music/**` in this phase
- Do not immediately remove `/api/music/*` or Rust music IPC source files in this phase
- Do not execute the formal legacy-data migration into the new model in this phase
- Do not provide a parallel rollback page for the legacy music system
- Do not alter the main flows for video, live, downloads, updates, login, or other desktop shell behavior

**Current Findings**

- The current music feature is not a single route page. It is distributed across the root layout, navigation, a global player root, the desktop tray, download bridges, and `/api/music/*`
- The legacy player root is mounted globally in the application layout, so changing only the `/music` page does not actually disable legacy playback behavior
- Shared runtime layers already depend directly on legacy music contracts and record schemas. The main examples are the DB layer, profile service layer, and the desktop Tauri bridge, so “move the whole directory later” is not executable as written today
- Admin configuration and runtime projection still treat `EnableWebMusic` as a live product switch. If its placeholder-phase meaning is not redefined, the design, config, and UX will split
- Existing desktop integration for windows, Tauri commands, sidecar services, local config, and updates is already stable and should not be torn down together with the music UI

**Core Approach**

1. Start with `Phase 0`: extract shared music contracts before attempting any legacy freeze or relocation
2. Avoid a fuzzy “looks disabled but still callable” state; define exact placeholder behavior for routes, config, HTTP, IPC, and tray integration
3. Preserve legacy source code and legacy data as `v1 legacy` assets instead of migrating data during this phase
4. Freeze the legacy frontend only after shared layers are fully detached from `@/features/music/**`
5. Build the future YesPlayMusic module on a separate `v2` namespace and forbid default reads from `v1` legacy data

**Target State**

After the placeholder phase lands, the system should satisfy the following:

- Visiting `/music` renders only the placeholder page
- Application startup no longer restores any legacy music playback session
- The desktop tray no longer exposes legacy music playback controls
- The sidebar and mobile bottom navigation no longer show a music entry
- `EnableWebMusic` no longer controls placeholder-phase navigation visibility or page composition
- `/api/music/*` no longer serves legacy music functionality
- If legacy music Tauri IPC is invoked, it returns a stable disabled-state error
- `v1` legacy data and desktop download artifacts remain preserved, pending a future standalone migration design
- Video, live, downloads, updates, login, the local sidecar, and window behavior remain available

**Placeholder-Phase Runtime Semantics**

Route semantics:

- The `/music` route remains directly reachable
- The `/music` page always renders the placeholder page and no longer renders the legacy `MusicPageShell`
- `/music` availability is no longer controlled by `EnableWebMusic`

Navigation semantics:

- The sidebar and mobile bottom navigation never render a “Music” entry during the placeholder phase
- Even if a legacy `EnableWebMusic` value still exists in persisted admin config, navigation may not use it to restore the old entry

Config semantics:

- The admin panel no longer shows the legacy “Enable web music” switch
- The stored legacy `EnableWebMusic` value is preserved, but during the placeholder phase `buildPublicRuntimeConfig` and desktop runtime refresh logic must force-project `ENABLE_WEB_MUSIC=false`
- Until the new music center ships, this field is a reserved config field (保留字段), not an active UI behavior switch

HTTP semantics:

- All legacy `/api/music/*` routes return `410 Gone` during the placeholder phase
- Responses must include `Cache-Control: no-store`
- Responses must include a stable structured error payload, for example `music feature disabled during placeholder phase`
- Legacy account QR, session, likes, playback, search, and profile routes all follow the same disabled-state rule

IPC semantics:

- Legacy music Tauri commands remain in source temporarily, but when invoked during the placeholder phase they must return a deterministic disabled-state error
- The error semantics must consistently mean “legacy music is disabled during the placeholder phase” and may not continue legacy downloads, playback, or tray-state synchronization

Tray semantics:

- Tauri `setup` no longer installs the legacy music tray
- The frontend no longer listens to or emits legacy music tray events

Session semantics:

- Legacy music account cookies, desktop download records, and profile data may remain preserved
- No active route during the placeholder phase may continue refreshing, writing, or mutating those legacy session assets

**Decommission Boundaries**

Preserved areas:

- Window configuration, build commands, and `externalBin` in `src-tauri/tauri.conf.json`
- Desktop shell, sidecar, local config, updater, and main-window lifecycle code in `src-tauri/src/main.rs` and `src-tauri/src/lib.rs`
- The unified Tauri frontend bridge facade (外观层) in `src/lib/desktop/tauri-client.ts`
- Existing video players, live players, download flow, and shared desktop layout
- Legacy music persisted data, desktop download files, and related JSON record files
- Legacy music source code, as long as its external behavior is constrained by the placeholder-phase runtime semantics

Temporarily retired areas:

- The formal music page content behind `src/app/music/page.tsx`
- The global `MusicPlayerRoot` mount in the root layout
- The “Music” entry in the sidebar and mobile bottom navigation
- The legacy “Enable web music” switch in the admin panel
- The legacy tray menu and tray-event bindings
- Any legacy download, settings, or account entry points confirmed during implementation audit

**Phase 0: Shared Contract Extraction**

Goal:

- Before freezing `src/features/music/**`, move the music contracts still depended on by shared layers out of the feature directory

Suggested new location:

```text
src/lib/music-contracts/
  entities.ts
  music-collection-profile-records.ts
  music-playback-session-records.ts
  music-preferences-records.ts
  music-profile-records.ts
```

Extraction requirements:

- Shared layers such as `src/lib/**`, `src/app/api/**`, `src/components/**`, and `src/lib/desktop/**` may no longer import `@/features/music/**` directly
- Only the music UI, legacy orchestration code, and future `music-legacy` code may depend on `src/features/music/**`
- Moving the remaining legacy frontend into `src/features/music-legacy/` is allowed only after shared-layer imports are fully switched to `src/lib/music-contracts/**`

**Migration Phases and Order**

1. `Phase 0`: extract shared contracts
   - Move `entities`, `record schemas`, and `sanitizers` from the legacy feature directory into `src/lib/music-contracts/**`
   - Update imports in the DB layer, profile service layer, desktop bridge, and API routes
   - Use `rg "@/features/music/" src` to verify shared-layer dependency cleanup
2. `Phase 1`: cut global side effects
   - Remove the legacy `MusicPlayerRoot` from the root layout
   - Disable legacy music tray installation during Tauri `setup`
   - Replace the `/music` route with the placeholder page
3. `Phase 2`: cut user entry points and misleading config affordances (错误配置暗示)
   - Hide the sidebar “Music” entry
   - Hide the mobile bottom-navigation “Music” entry
   - Hide the legacy “Enable web music” switch in admin
   - Continue auditing and removing any confirmed legacy download, settings, or account entry points
4. `Phase 3`: disable legacy runtime surfaces
   - Make all legacy `/api/music/*` routes return `410 Gone`
   - Make legacy music Tauri IPC return disabled-state errors
   - Stop any legacy cookie writes, tray events, and background-restore logic
5. `Phase 4`: freeze the legacy implementation
   - After shared-layer decoupling is complete, move the remaining legacy frontend implementation into `src/features/music-legacy/`
   - `music-legacy` becomes reference-only and no longer carries active runtime responsibility

**Rollback Points**

- Rollback point A: after `Phase 0`, behavior should still be unchanged, but shared layers no longer depend on `@/features/music/**`
- Rollback point B: after global side effects are cut, the app still starts, `/music` shows the placeholder page, and legacy music no longer auto-plays
- Rollback point C: after entry points and config affordances are cut, users can no longer enter legacy music through primary navigation and admin no longer exposes the misleading switch
- Rollback point D: after legacy runtime surfaces are disabled, direct calls into `/api/music/*` or legacy music IPC return only disabled-state responses
- Rollback point E: after the legacy implementation is frozen, new music work can continue without restoring shared legacy dependencies even if the rebuild timeline slips

**Rebuild Directory Plan**

The later rebuild should use the following structure:

```text
src/
  app/
    music/
      page.tsx
  features/
    music-legacy/
      ...legacy implementation, reference only
    music/
      app/
      components/
      domain/
      services/
        providers/
          yesplaymusic/
        desktop/
        playback/
      state/
      tests/
  lib/
    music-contracts/
    playback/
      media-arbiter.ts
```

Directory responsibilities:

- `src/app/music/page.tsx`
  - route entry composition only
- `src/features/music-legacy/*`
  - legacy implementation, read-only reference
- `src/features/music/app/*`
  - page-level containers and scene composition
- `src/features/music/components/*`
  - new music UI components
- `src/features/music/domain/*`
  - new music domain layer and repository interfaces
- `src/features/music/services/providers/yesplaymusic/*`
  - YesPlayMusic or upstream source adapter layer
- `src/features/music/services/desktop/*`
  - desktop-specific capability wrappers
- `src/features/music/state/*`
  - new music state layer
- `src/lib/music-contracts/*`
  - shared entities, record schemas, and sanitize helpers used by DB, profile, desktop bridge, and both the legacy and `v2` sides
- `src/lib/playback/media-arbiter.ts`
  - the audio/video mutual-exclusion coordinator (互斥协调器)

**Boundary Contracts**

1. UI must not talk to Tauri directly
   - React components must not import `@tauri-apps/api/*` directly
   - Desktop capabilities must go through `src/lib/desktop/tauri-client.ts` or a new desktop service layer
2. UI must not talk to third-party music sources directly
   - Pages and stores consume only unified domain entities
   - Upstream interface variance (差异) is allowed only inside the provider adapter layer
3. Audio mutual exclusion must be globally coordinated
   - When video starts playback, the coordinator pauses music
   - When music starts playback, the coordinator pauses video
   - This logic must not be scattered across individual pages
4. The route layer is composition-only
   - The `/music` route file must not own the playback core, network requests, or desktop IPC logic
5. Shared layers may not depend on the legacy feature directory
   - Shared layers such as `src/lib/**`, `src/app/api/**`, and `src/components/**` may not import `@/features/music/**` directly
6. The new music system must use a versioned namespace (版本化命名空间)
   - The new `v2` music module may not read `v1` local keys, profile records, or desktop download records by default
7. The legacy module becomes read-only
   - After it moves into `music-legacy`, it may be referenced, but new runtime code may not depend on it

**Legacy Data Policy**

- Do not clear legacy local music data or remote profile data during the placeholder phase
- Legacy local keys are treated as `v1 legacy`, including but not limited to:
  - `moontv_music_preferences`
  - `moontv_music_playback_session`
- Legacy profile data, favorites, play records, recent plays, search history, and collection records remain preserved, but active UI no longer writes them during the placeholder phase
- Legacy desktop download files and download records remain preserved, but active UI no longer exposes or mutates them
- The future YesPlayMusic module must adopt a new `v2` namespace, payload shape, and record schema
- If a `v1 -> v2` migration is needed later, it requires a dedicated migration design rather than implicit compatibility during the placeholder phase

**Test Baseline Migration**

- Update the `/music` page test so it no longer expects the legacy `MusicPageShell`
- Update navigation tests so `EnableWebMusic=true` no longer implies a visible music entry
- Update runtime-config tests to cover forced `ENABLE_WEB_MUSIC=false` projection during the placeholder phase
- Add tests that validate `410 Gone` on legacy `/api/music/*`
- Add tests that validate disabled-state errors on legacy music IPC
- Add a static check or grep-based acceptance guard ensuring shared layers no longer import `@/features/music/**`

**Acceptance Criteria**

Placeholder-phase acceptance:

- `pnpm typecheck` passes
- `pnpm desktop:check` passes
- The desktop application starts normally
- Visiting `/music` shows the placeholder page
- Regardless of the stored legacy `EnableWebMusic` value, the sidebar and mobile bottom navigation do not show “Music”
- The admin panel no longer shows the legacy “Enable web music” switch
- Direct requests to legacy `/api/music/*` return `410 Gone` and include `Cache-Control: no-store`
- Calls into legacy music Tauri IPC return stable disabled-state errors
- Legacy music does not auto-restore playback and does not continue occupying audio output
- The tray no longer exposes legacy music controls
- `/play`, `/live`, downloads, updates, login, and sidecar behavior show no regressions (回归)

Rebuild-preparation acceptance:

- Shared-layer imports are switched to `src/lib/music-contracts/**`
- Shared layers outside `src/features/music-legacy/**` no longer import `@/features/music/**`
- The new `music` module can be developed independently without depending on the legacy runtime
- The new music module does not read `v1 legacy` data by default
- The audio/video mutual-exclusion coordinator has a dedicated location and is not coupled to any single page

**Primary Risks and Mitigations**

- Risk: changing only the `/music` page while leaving the global player mount in the root layout allows legacy music to keep running in the background
  - Mitigation: cut global side effects first, then process the route and navigation
- Risk: moving directories before shared-contract extraction breaks DB, profile, desktop-bridge, and API-route compilation
  - Mitigation: make shared-contract extraction a `Phase 0` blocker
- Risk: `EnableWebMusic` remains treated as a live product switch, creating a split between config and UX
  - Mitigation: force-project `ENABLE_WEB_MUSIC=false` during the placeholder phase and hide the legacy admin switch
- Risk: the new music system accidentally reads `v1` legacy data and creates schema collisions or dirty restores
  - Mitigation: enforce `v2` namespace isolation and treat migration as a separate design

**Next Step**

After this design is approved, the next phase should write an implementation plan first, then execute in the order of `Phase 0 -> Phase 1 -> Phase 2 -> Phase 3 -> Phase 4`.
