# LunaTV Music Reset and Placeholder-Phase Design

**Goal**

Safely retire the current `/music` UI and runtime behavior inside the active desktop worktree, while preserving the reusable `Rust + TypeScript + Tauri` desktop foundation for a later YesPlayMusic rebuild. This design is not about shipping the new player immediately. It is about finishing a controlled soft decommission (软下线), keeping the desktop infrastructure intact, and stabilizing the rebuild boundaries (重建边界).

**Confirmed Decisions**

1. The current `/music` implementation will not be evolved incrementally (渐进式改造); it will be cleared and rebuilt
2. This phase uses a “clear UI only, keep desktop music infrastructure” path
3. The `/music` route stays in place, but becomes a placeholder page
4. Existing legacy music playback behavior is temporarily disabled, including background restore, continued playback, and audio-output contention (音频输出竞争)
5. Related side paths are hidden or disabled together, including primary navigation entries, tray music controls, legacy download entry points, and legacy music settings entry points

**Scope**

- Keep the official `/music` route path, but replace its content with a placeholder page
- Remove the legacy global music runtime mount so application startup no longer restores legacy playback
- Hide music entries from the sidebar, mobile bottom navigation, and other visible entry points
- Disable the legacy tray menu and its related frontend event wiring
- Preserve `src-tauri/**`, current window logic, the Tauri bridge, the local sidecar, desktop update flow, and the video desktop shell
- Preserve legacy music APIs, Rust music commands, and legacy frontend music source code as dormant assets (休眠资产) as long as they are unreachable at runtime
- Reserve a stable directory structure and contract set for the upcoming YesPlayMusic rebuild

**Out of Scope**

- Do not ship the new YesPlayMusic UI or playback core in this phase
- Do not fully delete `src/features/music/**` in this phase
- Do not delete `/api/music/*` in this phase
- Do not remove Rust music IPC commands in this phase
- Do not provide a parallel rollback page for the legacy music system
- Do not alter the main flows for video, live, downloads, updates, login, or other desktop shell behavior

**Current Findings**

- The current music feature is not a single route page. It is distributed across the root layout, navigation, a global player root, the desktop tray, download bridges, and `/api/music/*`
- The legacy player root is mounted globally in the application layout, so changing only the `/music` page does not actually disable legacy playback behavior
- Existing desktop integration for windows, Tauri commands, sidecar services, local config, and updates is already stable and should not be torn down together with the music UI
- The legacy music code may remain as a reference asset, but it should no longer participate in the live runtime

**Core Approach**

1. Use a “soft decommission legacy music, keep desktop infrastructure” path instead of immediate full-stack deletion
2. Cut global side effects first, then cut user entry points, then freeze the legacy module
3. Turn `/music` into a stable placeholder during the transition instead of a 404, blank page, or hidden route
4. Preserve reusable Tauri, Rust, and desktop-shell capabilities so the later YesPlayMusic rebuild does not recreate infrastructure unnecessarily
5. Enforce clear boundaries (边界) between legacy and future music systems so the rebuild does not regress into patching the old module

**Target State**

After the placeholder phase lands, the system should satisfy the following:

- Visiting `/music` renders only the placeholder page
- Application startup no longer restores any legacy music playback session
- The desktop tray no longer exposes legacy music playback controls
- The sidebar and mobile bottom navigation no longer show a music entry
- Legacy music downloads, legacy music settings, legacy keyboard shortcuts, and legacy media-session bindings are no longer triggered
- Video, live, downloads, updates, login, the local sidecar, and window behavior remain available
- The repository still keeps reusable legacy music infrastructure for later reference or reuse

**Decommission Boundaries**

Preserved areas:

- Window configuration, build commands, and `externalBin` in `src-tauri/tauri.conf.json`
- Desktop shell, sidecar, local config, updater, and main-window lifecycle code in `src-tauri/src/main.rs` and `src-tauri/src/lib.rs`
- The unified Tauri frontend bridge facade (外观层) in `src/lib/desktop/tauri-client.ts`
- Existing video players, live players, download flow, and shared desktop layout
- Legacy `/api/music/*` and Rust music commands, provided they are no longer called by the active UI

Temporarily retired areas:

- The formal music page content behind `src/app/music/page.tsx`
- The global `MusicPlayerRoot` mount in the root layout
- The “Music” entry in the sidebar and mobile bottom navigation
- The legacy tray menu and tray-event bindings
- Legacy music download entry points and legacy music settings entry points

**Removal Sequence**

1. Cut global side effects first
   - Remove the legacy `MusicPlayerRoot` from the root layout
   - Disable legacy music tray installation during Tauri `setup`
   - Replace the `/music` route with a placeholder page
2. Cut user entry points next
   - Hide the sidebar “Music” entry
   - Hide the mobile bottom-navigation “Music” entry
   - Hide legacy music download and settings entry points
3. Freeze the legacy implementation last
   - Keep `src/features/music/**` temporarily, but forbid runtime imports
   - Keep `/api/music/*` temporarily, but do not treat it as an active frontend capability
   - After the placeholder version is stable, move the full legacy module to `src/features/music-legacy/`

**Rollback Points**

- Rollback point A: after global side effects are cut, the app still starts, `/music` shows the placeholder page, and legacy music no longer auto-plays
- Rollback point B: after entry points are cut, users cannot enter legacy music from primary navigation, while video and core desktop flows remain intact
- Rollback point C: after the legacy module is frozen, a temporary rollback only needs to restore the entry points and global mount; the desktop foundation itself does not need restoration

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
    playback/
      media-arbiter.ts
```

Directory responsibilities:

- `src/app/music/page.tsx`
  - route entry composition only
- `src/features/music/app/*`
  - page-level containers and scene composition
- `src/features/music/components/*`
  - new music UI components
- `src/features/music/domain/*`
  - unified entities, repository interfaces, and mapping boundaries
- `src/features/music/services/providers/yesplaymusic/*`
  - YesPlayMusic or upstream source adapter layer
- `src/features/music/services/desktop/*`
  - desktop-specific capability wrappers
- `src/features/music/state/*`
  - independent music state layer
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
5. The legacy module becomes read-only
   - After it moves into `music-legacy`, it may be referenced, but new runtime code may not depend on it

**Acceptance Criteria**

Placeholder-phase acceptance:

- `pnpm typecheck` passes
- `pnpm desktop:check` passes
- The desktop application starts normally
- Visiting `/music` shows the placeholder page
- The sidebar and mobile bottom navigation no longer show “Music”
- Legacy music does not auto-restore playback and does not continue occupying audio output
- The tray no longer exposes legacy music controls
- `/play`, `/live`, downloads, updates, login, and sidecar behavior show no regressions (回归)

Rebuild-preparation acceptance:

- The new `music` module can be developed independently without depending on the legacy runtime
- The boundary between new and legacy modules is explicit, allowing the old implementation to move wholesale into `music-legacy`
- The audio/video mutual-exclusion coordinator has a dedicated location and is not coupled to any single page

**Primary Risks and Mitigations**

- Risk: changing only the `/music` page while leaving the global player mount in the root layout allows legacy music to keep running in the background
  - Mitigation: cut global side effects first, then process the route and navigation
- Risk: hard-deleting legacy directories too early may break layout imports, type references, or desktop-bridge compilation
  - Mitigation: perform an unreachable soft retirement first, then freeze and migrate
- Risk: the rebuild later regresses into patching the old module and reintroduces boundary coupling (耦合)
  - Mitigation: require the legacy module to become read-only reference material after it moves into `music-legacy`

**Next Step**

After this design is approved, the next phase should write an implementation plan first, then execute in the order of “cut global side effects -> cut entry points -> land the placeholder page -> freeze the legacy module.”
