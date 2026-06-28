# YesPlayMusic Phase 4c Recent Plays Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the authenticated `Recently played` flow to remote `Netease` recent-play history and refresh that list when new tracks start playing, while keeping the existing local recent-track path as the signed-out fallback (兜底). `resumeTracks` stay local-only.

**Architecture:** Add remote recent-play read/write support at the provider layer and under `/api/music/account/recent-tracks`, then introduce a dedicated `music-recent-tracks` front-end service and a `music-library-store.reportRecentTrack(...)` bridge so `MusicPlayerRoot`, the library, and settings all follow the same account-aware path.

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Zustand, Jest, Testing Library

## Global Constraints

- Stay inside the current `React + Next.js + Tauri` rebuild; do not reconnect the old music system.
- Default to ASCII, avoid `any`, and follow the existing account route / provider / store patterns.
- Write the failing test first, then the minimal implementation, then targeted verification and full music regression.
- Remote recent plays win only when authenticated; signed-out mode keeps the current local recent-play fallback.
- `resumeTracks` continue reading local play records only.
- Do not add destructive “clear Netease recent plays” account actions in this slice.

---

### Task 1: Add Netease recent-play provider support and the account recent-tracks route

**Files:**

- Modify: `src/features/music/domain/repositories.ts`
- Modify: `src/features/music/services/providers/netease/client.ts`
- Modify: `src/features/music/services/providers/netease/repository.ts`
- Create: `src/app/api/music/account/recent-tracks/route.ts`
- Modify: `src/features/music/tests/netease-repository.test.ts`
- Modify: `src/features/music/tests/music-account-routes.test.ts`

**Interfaces:**

- Produces:
  - `MusicAccountRepository.getRecentTracks(...)`
  - `MusicAccountRepository.reportTrackPlayed(...)`
  - `GET /api/music/account/recent-tracks`
  - `POST /api/music/account/recent-tracks`

- [ ] Step 1: Write failing tests in `netease-repository.test.ts` for:
  - reading the recent-play list
  - reporting a play and getting the refreshed list back
- [ ] Step 2: Write failing tests in `music-account-routes.test.ts` for:
  - successful `GET /api/music/account/recent-tracks`
  - `401` when no music session exists
  - successful `POST` returning the refreshed list
- [ ] Step 3: Run `pnpm jest src/features/music/tests/netease-repository.test.ts src/features/music/tests/music-account-routes.test.ts --runInBand`
- [ ] Step 4: Extend `MusicAccountRepository` in `repositories.ts` with the remote recent-play contract.
- [ ] Step 5: Add recent-play fetchers in `client.ts`.
- [ ] Step 6: Implement `getRecentTracks / reportTrackPlayed` in `repository.ts`, returning the refreshed recent list after a successful report.
- [ ] Step 7: Add `src/app/api/music/account/recent-tracks/route.ts`, reusing the existing session-cookie and route-support patterns.
- [ ] Step 8: Re-run the same test command and expect PASS.

### Task 2: Add a unified recent-tracks service and make the library store / player root account-aware

**Files:**

- Create: `src/features/music/services/music-recent-tracks.ts`
- Create: `src/features/music/tests/music-recent-tracks.test.ts`
- Modify: `src/features/music/tests/music-library-store.test.ts`
- Modify: `src/features/music/tests/music-player-root.test.tsx`
- Modify: `src/features/music/state/music-library-store.ts`
- Modify: `src/features/music/components/MusicPlayerRoot.tsx`

**Interfaces:**

- Produces:
  - `listMusicRecentTracks()`
  - `reportMusicTrackPlayed()`
  - `useMusicLibraryStore().reportRecentTrack(...)`
  - `useMusicLibraryStore().recentTracks` switching data sources by account state

- [ ] Step 1: Write failing tests in `music-recent-tracks.test.ts` for route wrapping, `401` propagation, and normalized payloads.
- [ ] Step 2: Extend `music-library-store.test.ts` with failing tests for:
  - authenticated hydrate reading remote recent tracks
  - signed-out hydrate reading local recent tracks
  - `reportRecentTrack()` switching between remote and local branches
  - `resumeTracks` staying untouched
- [ ] Step 3: Extend `music-player-root.test.tsx` with failing tests for:
  - authenticated playback reporting remote recent plays
  - signed-out playback still using the local recent service
- [ ] Step 4: Run `pnpm jest src/features/music/tests/music-recent-tracks.test.ts src/features/music/tests/music-library-store.test.ts src/features/music/tests/music-player-root.test.tsx --runInBand`
- [ ] Step 5: Implement `music-recent-tracks.ts` as the front-end wrapper over the account recent-tracks route.
- [ ] Step 6: Update `music-library-store.ts`:
  - choose remote vs local recent tracks during hydrate
  - add `reportRecentTrack(track)` as the single write entry
  - preserve the previous `recentTracks` on remote failures
- [ ] Step 7: Update `MusicPlayerRoot.tsx` so the current recent-play write path flows through `reportRecentTrack()`.
- [ ] Step 8: Re-run the same test command and expect PASS.

### Task 3: Update account-summary and settings semantics for remote recent plays

**Files:**

- Modify: `src/features/music/components/MusicAccountCard.tsx`
- Modify: `src/features/music/components/MusicSettingsView.tsx`
- Modify: `src/features/music/components/MusicTopBar.tsx`
- Modify: `src/features/music/tests/music-sidebar.test.tsx`
- Modify: `src/features/music/tests/music-phase2-ui.test.tsx`

**Interfaces:**

- Produces:
  - signed-in account copy explicitly says recent plays also sync
  - signed-in settings keep the `Recent plays` count but drop the local clear action
  - signed-out mode restores the local clear semantics

- [ ] Step 1: Write failing tests in `music-sidebar.test.tsx` and `music-phase2-ui.test.tsx` for:
  - account-card detail copy mentioning recent-play sync
  - authenticated settings hiding `Clear recent plays`
  - signed-out settings restoring the local clear action
- [ ] Step 2: Run `pnpm jest src/features/music/tests/music-sidebar.test.tsx src/features/music/tests/music-phase2-ui.test.tsx --runInBand`
- [ ] Step 3: Implement the minimal UI-copy and action-boundary changes without adding new pages.
- [ ] Step 4: Re-run the same test command and expect PASS.

### Task 4: Run full verification

**Files:**

- Test only

**Interfaces:**

- Consumes: full Task 1-3 implementation
- Produces: recent-plays sync vertical slice passing targeted and full music regression

- [ ] Step 1: Run

```bash
pnpm jest \
  src/features/music/tests/netease-repository.test.ts \
  src/features/music/tests/music-account-routes.test.ts \
  src/features/music/tests/music-recent-tracks.test.ts \
  src/features/music/tests/music-library-store.test.ts \
  src/features/music/tests/music-player-root.test.tsx \
  src/features/music/tests/music-sidebar.test.tsx \
  src/features/music/tests/music-phase2-ui.test.tsx \
  --runInBand
```

- [ ] Step 2: Run `pnpm jest src/features/music/tests src/app/music/page.test.tsx --runInBand`
- [ ] Step 3: Run `pnpm typecheck`
- [ ] Step 4: If output diverges from expectation, fix the failing point; only treat the slice as done after everything passes.
