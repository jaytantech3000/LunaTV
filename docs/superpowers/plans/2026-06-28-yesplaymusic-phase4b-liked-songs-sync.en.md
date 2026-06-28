# YesPlayMusic Phase 4b Liked Songs Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the authenticated `Netease` `Saved tracks / Save` path to the remote “liked songs” source of truth, while keeping the current local favorites flow as the signed-out fallback (兜底).

**Architecture:** Add remote liked-song read/write support at the provider layer and under `/api/music/account/likes`, then introduce a dedicated `music-liked-tracks` front-end service that makes the library store account-aware. The UI shell stays intact; only copy, counts, and action semantics (动作语义) change.

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Zustand, Jest, Testing Library

## Global Constraints

- Only extend the current `React + Next.js + Tauri` rebuild line; do not reconnect the legacy music system.
- Default to ASCII, forbid `any`, and follow existing account route, provider, and store patterns.
- Write failing tests first, then the minimal implementation, then run targeted tests and the full music regression.
- Remote liked songs win only when authenticated; signed-out mode keeps the current local favorites fallback.
- Do not auto-upload, delete, or overwrite existing local favorites data.

---

### Task 1: Add Netease liked-song provider support and the account-likes route

**Files:**

- Modify: `src/features/music/domain/repositories.ts`
- Modify: `src/features/music/services/providers/netease/client.ts`
- Modify: `src/features/music/services/providers/netease/repository.ts`
- Create: `src/app/api/music/account/likes/route.ts`
- Modify: `src/features/music/tests/netease-repository.test.ts`
- Modify: `src/features/music/tests/music-account-routes.test.ts`

**Interfaces:**

- Produces:
  - `MusicAccountRepository.getLikedTracks(...)`
  - `MusicAccountRepository.setTrackLiked(...)`
  - `GET /api/music/account/likes`
  - `POST /api/music/account/likes`
  - `DELETE /api/music/account/likes`

- [ ] Step 1: Write failing tests in `netease-repository.test.ts` for:
  - reading the liked-song list
  - returning the refreshed list after a like
  - returning the refreshed list after an unlike
- [ ] Step 2: Write failing tests in `music-account-routes.test.ts` for:
  - successful `GET /api/music/account/likes`
  - `401` when the music session is missing
  - refreshed list payloads from `POST / DELETE`
- [ ] Step 3: Run `pnpm jest src/features/music/tests/netease-repository.test.ts src/features/music/tests/music-account-routes.test.ts --runInBand`
- [ ] Step 4: Extend `MusicAccountRepository` in `repositories.ts` with the remote liked-song contract.
- [ ] Step 5: Add liked-song fetchers in `client.ts`, preferring liked-playlist detail as the first implementation path.
- [ ] Step 6: Implement `getLikedTracks / setTrackLiked` in `repository.ts`, returning the refreshed liked list after a successful mutation.
- [ ] Step 7: Create `src/app/api/music/account/likes/route.ts`, reusing the current session-cookie and route-support patterns.
- [ ] Step 8: Re-run the same test set and expect PASS.

### Task 2: Add a unified liked-tracks service and make the library store account-aware

**Files:**

- Create: `src/features/music/services/music-liked-tracks.ts`
- Create: `src/features/music/tests/music-liked-tracks.test.ts`
- Create: `src/features/music/tests/music-library-store.test.ts`
- Modify: `src/features/music/state/music-library-store.ts`

**Interfaces:**

- Produces:
  - `listMusicLikedTracks()`
  - `likeMusicTrack()`
  - `unlikeMusicTrack()`
  - account-aware `useMusicLibraryStore().favoriteTracks`

- [ ] Step 1: Write failing tests in `music-liked-tracks.test.ts` for remote route wrapping, `401` propagation, and payload normalization.
- [ ] Step 2: Write failing tests in `music-library-store.test.ts` for:
  - authenticated hydrate reading remote liked tracks
  - signed-out hydrate reading local favorites
  - preserving previous state when the remote toggle fails
- [ ] Step 3: Run `pnpm jest src/features/music/tests/music-liked-tracks.test.ts src/features/music/tests/music-library-store.test.ts --runInBand`
- [ ] Step 4: Implement `music-liked-tracks.ts` as the front-end wrapper over the account-likes route.
- [ ] Step 5: Modify `music-library-store.ts` so hydrate and toggle split between remote and local favorite branches by account state, while preserving previous `favoriteTracks` on remote failure.
- [ ] Step 6: Re-run the same test set and expect PASS.

### Task 3: Update player, library, and account-summary copy/actions for account-aware liked songs

**Files:**

- Modify: `src/features/music/components/MusicFullPlayer.tsx`
- Modify: `src/features/music/components/MusicLibraryView.tsx`
- Modify: `src/features/music/components/MusicAccountCard.tsx`
- Modify: `src/features/music/components/MusicTopBar.tsx`
- Modify: `src/features/music/components/MusicSettingsView.tsx`
- Modify: `src/features/music/tests/music-player-ui.test.tsx`
- Modify: `src/features/music/tests/music-sidebar.test.tsx`
- Modify: `src/features/music/tests/music-phase2-ui.test.tsx`

**Interfaces:**

- Produces:
  - authenticated `Like / Liked / Liked songs`
  - signed-out fallback back to `Save / Saved / Saved tracks`

- [ ] Step 1: Write a failing test in `music-player-ui.test.tsx` for authenticated `Like / Liked` copy in the full player.
- [ ] Step 2: Write failing tests in `music-sidebar.test.tsx` and `music-phase2-ui.test.tsx` for:
  - account card + library switching to `Liked`
  - disconnect restoring the local `Saved` semantics
- [ ] Step 3: Run `pnpm jest src/features/music/tests/music-player-ui.test.tsx src/features/music/tests/music-sidebar.test.tsx src/features/music/tests/music-phase2-ui.test.tsx --runInBand`
- [ ] Step 4: Implement the minimal UI copy and account-aware button semantics without adding new pages.
- [ ] Step 5: Re-run the same test set and expect PASS.

### Task 4: Run end-to-end verification

**Files:**

- Test only

**Interfaces:**

- Consumes: complete Task 1-3 implementation
- Produces: liked-song sync vertical slice passes targeted and full music regression

- [ ] Step 1: Run

```bash
pnpm jest \
  src/features/music/tests/netease-repository.test.ts \
  src/features/music/tests/music-account-routes.test.ts \
  src/features/music/tests/music-liked-tracks.test.ts \
  src/features/music/tests/music-library-store.test.ts \
  src/features/music/tests/music-player-ui.test.tsx \
  src/features/music/tests/music-sidebar.test.tsx \
  src/features/music/tests/music-phase2-ui.test.tsx \
  --runInBand
```

- [ ] Step 2: Run `pnpm jest src/features/music/tests src/app/music/page.test.tsx --runInBand`
- [ ] Step 3: Run `pnpm typecheck`
- [ ] Step 4: If output differs from expectation, fix the failing point first; only consider commit flow after all checks pass.
