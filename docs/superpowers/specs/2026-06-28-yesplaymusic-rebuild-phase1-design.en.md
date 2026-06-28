# LunaTV Music System Rebuild Phase 1 Big-Bang Design

**Goal**

Rebuild the music subsystem from scratch inside the current `React + Next.js + Tauri` host, using `YesPlayMusic` as the reference for information architecture (信息架构), player interaction (播放器交互), and page organization (页面组织), and replace the live `/music` entry directly. Phase 1 uses a `big-bang` path: delete the old music system first, then rebuild the new application shell (应用壳层) and playback core (播放核心) in the same route space.

**Full Program Breakdown**

The full rebuild is split into five independently deliverable sub-projects:

1. Application shell (应用壳层): `/music` layout, navigation, theme, responsive structure
2. Playback core (播放核心): mini player, full player, lyrics, queue, shortcuts, media session
3. Data domain (数据域): search, playlists, albums, artists, lyrics, stream URLs, unified provider contract (统一 provider 协议)
4. Account capabilities (账号能力): login, personal playlists, favorites, history, daily recommendations, FM, settings
5. Desktop integration (桌面集成): Tauri media keys, tray, cache, downloads, native desktop features

This design document covers only **Phase 1 = sub-projects 1 + 2**. The full objective still requires finishing the data domain, account capabilities, and desktop integration later, but the current phase focuses first on “delete old + rebuild the shell and playback core.”

**Scope**

- Delete the old `components/music`, `lib/music`, `musicPlayerStore`, old `/api/music/*`, and old audio-stream route directly
- Rebuild the page shell on the official `/music` route without creating `/music-v2` or any parallel fallback entry
- Create a new `src/features/music/` directory to own the new components, state, services, and domain models
- Rebuild the playback state layer, including queue, play state, surface state, and lyric-sync state
- Rebuild the mini player, expanded player, lyrics panel, queue panel, keyboard shortcuts, and media-session bindings
- Allow fixture / mock data in Phase 1 as long as the new boundaries are already running independently
- Reserve clean repository / adapter boundaries for later Phase 2 data integration

**Out of Scope**

- Do not keep the old `/music` implementation as a rollback surface
- Do not reuse the old `MusicPlayerRoot`, old `musicPlayerStore`, old `music-client`, or old provider implementations
- Do not add login, daily recommendations, comments, FM, settings pages, tray integration, or the full product surface in Phase 1
- Do not finish every live data source in Phase 1
- Do not preserve dual-track components or dual-track state just for compatibility with the deleted system

**Current Findings**

- The current music feature is spread across layout, sidebar, mobile bottom navigation, the `/music` route, `/api/music/*`, `lib/music/*`, and `musicPlayerStore`
- The old system couples UI, playback state, and provider data boundaries too tightly to serve as the base for a true rebuild-from-scratch
- The user has explicitly accepted the `big-bang` path, so `/music` is allowed to be in an active rebuild state during development and no parallel fallback version is required

**Core Approach**

1. Use a `Big Bang Rewrite`: clear the old music system first, then rebuild the new one on the same route
2. Use `Repository Pattern + Adapter Pattern`: define stable music-domain interfaces first, then adapt each source behind them
3. Split player state into a playback core and a UI shell so provider-specific fields do not leak into global state
4. Deliver the new application shell and playback core on the official `/music` route in Phase 1, then layer data and account capabilities in later phases

**Target Directory Structure**

```text
src/features/music/
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
  - `MusicTopBar`
  - `MusicHero`
  - `MusicMiniPlayer`
  - `MusicFullPlayer`
  - `MusicQueueDrawer`
  - `MusicLyricsPanel`
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
  - `fixture-repository`
- `state/`
  - four dedicated zustand stores
- `tests/`
  - store, service, component, and integration coverage

**State Model**

Phase 1 keeps only stable domain state and forbids source-specific fields.

- `musicShellStore`
  - owns the page shell
  - primary fields:
    - `activeSection`
    - `sidebarCollapsed`
    - `mobileDrawerOpen`
    - `layoutMode`
    - `themeVariant`
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

Queue items, playable tracks, and lyric documents all use new unified models:

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
- When a provider changes, only the adapter / repository layer may change; UI components must remain insulated (隔离)

**Information Architecture and UI Shell**

Phase 1 rewires the official `/music` page directly into a new shell structure:

- Left side:
  - `Home`
  - `Explore`
  - `Library`
  - a static account card
- Top:
  - search-shell input
  - current section title
  - view-switch and theme action slots
- Main content:
  - hero zone
  - recommendation card grid
  - recent-play area
  - current queue summary
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
  - binds system media-session behavior
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

Phase 1 cuts all dependencies on the old data layer immediately:

- Delete:
  - `src/lib/music/service.ts`
  - `src/lib/transport/music-client.ts`
  - `src/stores/musicPlayerStore.ts`
  - the current `/api/music/*`
  - the old `/media/audio/stream`
- New namespace:
  - `src/features/music/domain/*`
  - `src/features/music/services/*`
  - `src/features/music/state/*`

Interfaces reserved for Phase 2:

- `searchRepository`
- `playlistRepository`
- `trackRepository`
- `lyricRepository`
- `streamRepository`
- `authRepository`

Phase 1 starts with a `fixture-repository`, but it must still travel through these interfaces end to end instead of borrowing the old API surface.

**Big-Bang Migration Strategy**

Use a “delete old first, then restore a minimal runnable shell” path:

1. Create the `codex/music` branch
2. Delete the old music directories, old store, old API routes, and old audio-stream implementation
3. Create the new `src/features/music/` tree and the minimal `/music` shell immediately
4. Recover `/music` quickly into a page that can open, interact, and play fixture data
5. Continue shipping the shell, player, lyrics, queue, and shortcuts in the same branch

Constraints:

- Deletions and the new shell must land together so the branch never sits in a non-compiling midpoint
- The official `/music` route may not reattach the old components or the old store

**Deletion List**

The old system is deleted at the start of this phase:

- `src/components/music/*`
- `src/lib/music/*`
- `src/stores/musicPlayerStore.ts`
- `src/stores/musicPlayerStore.test.ts`
- `src/app/api/music/*`
- `src/app/media/audio/stream/route.ts`
- `src/app/media/audio/stream/route.test.ts`

The following connection points must be replaced or repaired immediately:

- `src/app/music/page.tsx`
- `src/app/layout.tsx`
- `src/components/Sidebar.tsx`
- `src/components/MobileBottomNav.tsx`

Notes:

- `Sidebar` and `MobileBottomNav` keep the `/music` navigation semantics
- The old `MusicPlayerRoot` in `layout.tsx` must be removed during the same deletion batch and replaced with the new player root

**Error Handling and Edge Cases**

- When no track exists:
  - hide the mini player
  - do not auto-open the full player
- When cover art or lyrics are missing:
  - use fallback artwork and an empty-lyrics message
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
4. Big-bang smoke test
   - open the official `/music`
   - render the new shell
   - play a fixture track
   - expand the player
   - switch tracks
   - confirm lyric highlighting
   - collapse back to the mini player

Priority:

- Prefer adding `Playwright` for page-level smoke verification
- If this iteration does not add `Playwright`, cover the critical end-to-end path with `RTL + Jest`
- Manual verification alone is not acceptable

**Acceptance Criteria**

- The old `music` frontend implementation, old store, old API routes, and old audio-stream implementation are deleted on this branch
- The official `/music` route is owned by the new `src/features/music/` implementation
- The new system does not depend on the old `musicPlayerStore`, old `/api/music/*`, or old `lib/music/*`
- The new system owns the mini player, full player, lyrics, queue, shortcuts, and media session
- Automated coverage exists for the new critical state and interaction paths

**Later Phases**

- **Phase 2**
  - integrate real search, playlists, albums, artists, lyrics, and stream providers
  - rebuild the new `/api/music/*`
- **Phase 3**
  - integrate login, personal playlists, favorites, history, daily recommendations, FM, and settings
  - integrate desktop media keys, tray, cache, downloads, and other desktop-specific capabilities

**Milestones**

1. Delete the old music system and restore a minimal runnable `/music` shell
2. Build the four stores and `audio-engine`
3. Ship the mini player, full player, lyrics, and queue
4. Connect fixture data and the big-bang smoke test
5. Integrate the real data domain
6. Integrate account and desktop capabilities
