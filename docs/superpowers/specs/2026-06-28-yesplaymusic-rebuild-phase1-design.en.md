# LunaTV Music System Rebuild Phase 1 Design

**Goal**

Rebuild a new music subsystem from scratch inside the current `React + Next.js + Tauri` host, using `YesPlayMusic` as a reference for information architecture (信息架构), player interaction (播放器交互), and page organization (页面组织). Phase 1 delivers only the new application shell (应用壳层) and playback core (播放核心), without reusing the old music frontend implementation.

**Full Program Breakdown**

The full rebuild is split into five independently deliverable sub-projects:

1. Application shell (应用壳层): `/music` layout, navigation, theme, responsive structure
2. Playback core (播放核心): mini player, full player, lyrics, queue, shortcuts, media session
3. Data domain (数据域): search, playlists, albums, artists, lyrics, stream URLs, unified provider contract (统一 provider 协议)
4. Account capabilities (账号能力): login, personal playlists, favorites, history, daily recommendations, FM, settings
5. Desktop integration (桌面集成): Tauri media keys, tray, cache, downloads, native desktop features

This design document covers only **Phase 1 = sub-projects 1 + 2**. Later Phase 2 and Phase 3 work will get their own specs after this phase becomes stable.

**Scope**

- Build an isolated `music-v2` feature and mount it first behind a temporary `/music-v2` entry
- Rebuild the overall page information architecture, navigation zones, main content layout, and responsive shell
- Rebuild the playback-related state layer, including queue, play state, surface state, and lyric-sync state
- Rebuild the mini player, expanded player, lyrics panel, queue panel, keyboard shortcuts, and media-session bindings
- Add automated coverage for the new state model, component interaction, and cutover flow
- Reserve clean repository / adapter boundaries for later Phase 2 data-domain integration

**Out of Scope**

- Do not reuse the old player shell, page components, or interaction state under `components/music`
- Do not reuse the old `musicPlayerStore`, old `MusicPlayerRoot`, or old `/api/music/*` as bridge implementations (过桥实现)
- Do not add login, daily recommendations, comments, FM, settings pages, tray integration, or the full product surface (产品面) in Phase 1
- Do not require fully live data connectivity in Phase 1; fixture / mock data is acceptable as long as the new boundaries are exercised
- Do not delete the old `/music` implementation at the start; keep it as the rollback surface before the final cutover

**Current Findings**

- The current music feature is spread across layout, sidebar, mobile bottom navigation, the `/music` route, `/api/music/*`, `lib/music/*`, and `musicPlayerStore`, so this is not a single-page replacement
- The old system couples UI, playback state, and provider data boundaries too tightly to serve as a valid base for a “from-scratch rebuild”
- A direct big-bang deletion would keep `/music` unavailable for too long during development and would make rollback much harder

**Core Approach**

1. Use the `Strangler Fig Pattern`: build `music-v2` in parallel and cut over to the official `/music` route only after it is ready
2. Use `Repository Pattern + Adapter Pattern`: define stable music-domain interfaces first, then adapt each source behind them
3. Split player state into a playback core and a UI shell so provider-specific fields do not leak into global state
4. Deliver only the new shell and new playback core in Phase 1, then layer data and account capabilities in later phases

**Target Directory Structure**

```text
src/features/music-v2/
  app/
  components/
  domain/
  hooks/
  services/
  state/
  styles/
  utils/
  tests/
```

Suggested responsibilities:

- `app/`
  - page composition (页面装配), route-level containers, layout assembly
- `components/`
  - `MusicShell`
  - `MusicSidebar`
  - `MusicMiniPlayer`
  - `MusicFullPlayer`
  - `MusicQueueDrawer`
  - `MusicLyricsPanel`
  - `MusicTopBar`
- `domain/`
  - `track`
  - `playlist`
  - `queue`
  - `lyric`
  - `playback`
  - unified interfaces, normalizers, and mappers
- `services/`
  - `audio-engine`
  - `media-session`
  - `keyboard-shortcuts`
  - `theme-palette`
  - later extensible `music-repository`
- `state/`
  - four dedicated zustand stores
- `tests/`
  - store, service, component, and integration coverage

**State Model**

Phase 1 keeps only stable domain state and forbids source-specific fields.

- `musicShellStore`
  - owns the page shell
  - primary fields:
    - `activeView`
    - `sidebarCollapsed`
    - `mobileDrawerOpen`
    - `activeTab`
    - `layoutMode`
- `playbackStore`
  - owns the playback core
  - primary fields:
    - `queue`
    - `currentTrackId`
    - `playState`
    - `playMode`
    - `volume`
    - `muted`
    - `positionMs`
    - `durationMs`
    - `bufferedMs`
    - `quality`
    - `error`
- `playerSurfaceStore`
  - owns the UI shell
  - primary fields:
    - `miniVisible`
    - `fullPlayerOpen`
    - `lyricsPanelOpen`
    - `queuePanelOpen`
    - `transitionState`
- `lyricsStore`
  - owns the lyric timeline
  - primary fields:
    - `lines`
    - `activeLineIndex`
    - `offsetMs`
    - `followMode`
    - `manualSeekLock`

**Unified Domain Models**

Queue items, playable track objects, and lyric documents all use new unified entities:

- `MusicTrackEntity`
  - `id`
  - `source`
  - `title`
  - `artists`
  - `album`
  - `coverUrl`
  - `durationMs`
  - `stream`
  - `playable`
- `QueueItemEntity`
  - `queueId`
  - `track`
  - `addedAt`
  - `fromContext`
- `LyricDocumentEntity`
  - `trackId`
  - `source`
  - `lines`
  - `offsetMs`

Explicit constraints:

- Do not put raw upstream fields such as `neteaseSong`, `audiusTrack`, or `jamendoTrack` directly into stores
- Components may consume only unified entities and selectors
- When a provider changes, only the adapter / repository layer should change; UI components must stay insulated (隔离)

**Information Architecture and UI Shell**

The Phase 1 `music-v2` page uses a new shell structure without requiring the full business surface on day one:

- Left side:
  - primary music navigation
  - first-level section placeholders
  - future account area placeholder
- Top:
  - search-entry shell
  - current context title
  - future user-action area placeholder
- Main content:
  - new visual shell by default
  - initial iterations may use mock data to validate lists, artwork, switching, and responsiveness
- Bottom:
  - persistent new mini player shell
- Fullscreen layer:
  - new full player
  - internal lyrics / queue switching

Visual and interaction principles:

- Preserve the `YesPlayMusic` semantics of left-right columns and a bottom player, but do not copy the Vue / Electron implementation literally
- Keep one unified visual language for colors, radii, outlines, button hierarchy, and motion rhythm
- On mobile, allow drawers and vertical stacking instead of forcing the desktop arrangement

**Playback Core and Service Boundaries**

The Phase 1 playback core is driven by an `audio-engine` service, while UI components interact only through actions:

- `audio-engine`
  - drives `HTMLAudioElement`
  - syncs `playbackStore`
  - owns `play / pause / seek / next / previous / setVolume`
- `media-session`
  - binds system media session behavior
  - maps artwork, title, pause, and track-skip actions
- `keyboard-shortcuts`
  - binds play/pause on space, track skip, volume, and expand/collapse shortcuts
- `theme-palette`
  - derives player background and accent colors from cover art

Constraints:

- Components must not own the low-level `audio` instance
- Stores must not issue HTTP requests directly
- Services must not mutate internal JSX component state

**Data Boundaries**

`music-v2` is fully isolated from the old data layer:

- It must not depend on:
  - `src/lib/music/service.ts`
  - `src/lib/transport/music-client.ts`
  - `src/stores/musicPlayerStore.ts`
  - the current `/api/music/*`
- New namespace:
  - `src/features/music-v2/domain/*`
  - `src/features/music-v2/services/*`
  - `src/features/music-v2/state/*`
  - new `/api/music-v2/*` routes

Interfaces reserved for Phase 2:

- `searchRepository`
- `playlistRepository`
- `trackRepository`
- `lyricRepository`
- `streamRepository`
- `authRepository`

Even if Phase 1 starts with fixture / mock data, it must still travel through these interfaces end to end instead of borrowing the old API surface.

**Cutover and Migration Strategy**

Use parallel rebuild plus final cutover:

1. Create `/music-v2`
2. Finish the new shell, stores, player services, and base interaction
3. Stabilize `music-v2` with automated tests and smoke verification
4. Cut the official `/music` route over to `music-v2`
5. Delete the old music system

This still satisfies “tear down and rebuild everything” while avoiding a long period where the official `/music` route is unavailable.

**Deletion List**

After the final cutover to `music-v2`, delete the old system as a batch:

- `src/components/music/*`
- `src/lib/music/*`
- `src/stores/musicPlayerStore.ts`
- `src/stores/musicPlayerStore.test.ts`
- `src/app/api/music/*`
- `src/app/media/audio/stream/route.ts`
- `src/app/media/audio/stream/route.test.ts`

Replacement points:

- `src/app/music/page.tsx`
- `src/app/layout.tsx`
- `src/components/Sidebar.tsx`
- `src/components/MobileBottomNav.tsx`

Notes:

- `Sidebar` and `MobileBottomNav` keep the `/music` navigation semantics and only change implementation targets during the final cutover
- Deleting the old system should be its own purge stage so new and old code are not removed in a tangled way

**Error Handling and Edge Cases**

- When no track exists:
  - hide the mini player
  - do not auto-open the full player
- When cover art or lyrics are missing:
  - keep placeholder behavior
  - prevent layout collapse
- When shortcuts, media session, or browser capabilities are unavailable:
  - log a meaningful error
  - degrade gracefully (优雅降级) without blocking base playback
- When audio loading fails:
  - keep the current queue
  - write the failure into `playbackStore.error`
  - show a recoverable UI error

**Testing Strategy**

Phase 1 adds four testing layers:

1. Domain / store tests
   - queue progression
   - play-mode changes
   - lyric highlighting sync
   - player-surface expand / collapse / switch
2. Service tests
   - `audio-engine`
   - `media-session`
   - `keyboard-shortcuts`
3. Component interaction tests
   - `MusicMiniPlayer`
   - `MusicFullPlayer`
   - `MusicQueueDrawer`
   - `MusicLyricsPanel`
4. Pre-cutover smoke test
   - open `music-v2`
   - start one track
   - expand player
   - change track
   - confirm lyric highlighting
   - collapse back to the mini player

Priority:

- Prefer adding `Playwright` for page-level smoke verification
- If this iteration does not add `Playwright`, use `RTL + Jest` to cover the critical end-to-end behavior instead
- Manual verification alone is not acceptable

**Acceptance Criteria**

- `music-v2` exists as an isolated directory, state layer, and service boundary
- `music-v2` can run without depending on the old `musicPlayerStore` or old `/api/music/*`
- The new system owns the mini player, full player, lyrics, queue, shortcuts, and media session
- Before final cutover, the old `/music` route still exists as a rollback surface
- After cutover, the old music directory and old audio-stream implementation can be deleted as one batch
- Automated coverage exists for the new critical state and interaction paths

**Later Phases**

- **Phase 2**
  - integrate real search, playlists, albums, artists, lyrics, and stream providers
  - implement the new `/api/music-v2/*`
- **Phase 3**
  - integrate login, personal playlists, favorites, history, daily recommendations, FM, and settings
  - integrate desktop media keys, tray, cache, downloads, and other desktop-specific capabilities

**Milestones**

1. Establish the `music-v2` shell and base directory
2. Build the four stores and `audio-engine`
3. Ship mini player, full player, lyrics, and queue
4. Connect mock data and base smoke coverage
5. Cut over `/music`
6. Purge the old music system
