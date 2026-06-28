# YesPlayMusic Phase 4d Cloud Playlist Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch signed-in `playlist` save semantics to remote `Netease` subscribe / unsubscribe so `My playlists` and the library playlist surface refresh from the cloud account, while signed-out users keep the current local fallback.

**Architecture:** Add a provider + route mutation path for cloud playlist subscribe / unsubscribe, then connect it through a dedicated frontend `music-account-playlists` service into `music-account-store` and `music-library-store`. The UI shell stays intact; only signed-in playlist behavior changes from “local pin” to “cloud playlist library sync.”

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Zustand, Jest, Testing Library

## Global Constraints

- Stay inside the current `React + Next.js + Tauri` rewrite and do not reconnect any legacy music system.
- Default to ASCII, forbid `any`, and follow the existing account route / provider / store patterns.
- Write failing tests first, then minimal implementation, then targeted regression and full music regression.
- Only signed-in `playlist` collections switch to remote cloud-library semantics; `rank / album / artist-toplist` stays local.
- Signed-in `savedCollections` must stop representing remote playlists.
- Do not add playlist CRUD, track editing, playlist ordering, or privacy editing in this slice.

---

### Task 1: Add account-playlist roles plus playlist subscribe provider / route

**Files:**

- Modify: `src/features/music/domain/entities.ts`
- Modify: `src/features/music/domain/repositories.ts`
- Modify: `src/features/music/services/providers/netease/client.ts`
- Modify: `src/features/music/services/providers/netease/mappers.ts`
- Modify: `src/features/music/services/providers/netease/repository.ts`
- Create: `src/app/api/music/account/playlists/subscriptions/route.ts`
- Modify: `src/features/music/tests/netease-repository.test.ts`
- Modify: `src/features/music/tests/music-account-routes.test.ts`

**Interfaces:**

- Produces:
  - `MusicCollectionSummaryEntity.accountPlaylistRole?: 'owned' | 'subscribed'`
  - `MusicAccountRepository.setPlaylistSubscribed(...)`
  - `POST /api/music/account/playlists/subscriptions`
  - `DELETE /api/music/account/playlists/subscriptions`

- [ ] Step 1: Add failing tests in `netease-repository.test.ts` covering:
  - account playlist summaries expose `owned / subscribed`
  - subscribing a playlist returns the refreshed account playlist list
  - unsubscribing a playlist returns the refreshed account playlist list
- [ ] Step 2: Add failing tests in `music-account-routes.test.ts` covering:
  - `POST /api/music/account/playlists/subscriptions` returns the refreshed list
  - `DELETE /api/music/account/playlists/subscriptions` returns the refreshed list
  - missing session returns `401`
- [ ] Step 3: Run `pnpm jest src/features/music/tests/netease-repository.test.ts src/features/music/tests/music-account-routes.test.ts --runInBand`
- [ ] Step 4: Add the playlist role field in `entities.ts`.
- [ ] Step 5: Add the `setPlaylistSubscribed` contract in `repositories.ts`.
- [ ] Step 6: Add playlist subscribe / unsubscribe fetchers in `client.ts`.
- [ ] Step 7: Add role mapping and refreshed-list mutation logic in `mappers.ts` and `repository.ts`.
- [ ] Step 8: Create `src/app/api/music/account/playlists/subscriptions/route.ts` using the existing session-cookie and route-support patterns.
- [ ] Step 9: Re-run the same test group and expect PASS.

### Task 2: Add the frontend account-playlist service and make account store / library store account-aware

**Files:**

- Create: `src/features/music/services/music-account-playlists.ts`
- Modify: `src/features/music/state/music-account-store.ts`
- Modify: `src/features/music/state/music-library-store.ts`
- Modify: `src/features/music/tests/music-account-store.test.ts`
- Modify: `src/features/music/tests/music-library-store.test.ts`

**Interfaces:**

- Produces:
  - `subscribeMusicAccountPlaylist()`
  - `unsubscribeMusicAccountPlaylist()`
  - `useMusicAccountStore().togglePlaylistSubscription(...)`
  - a remote playlist branch inside `useMusicLibraryStore().toggleSavedCollection(...)`

- [ ] Step 1: Add failing tests in `music-account-store.test.ts` covering:
  - subscribing refreshes `account.playlists`
  - unsubscribing refreshes `account.playlists`
  - remote failures keep the previous playlist list
- [ ] Step 2: Add failing tests in `music-library-store.test.ts` covering:
  - signed-in `toggleSavedCollection(playlist)` uses the remote branch
  - signed-in hydration filters local playlist saved-collection entries
  - signed-out `toggleSavedCollection(playlist)` keeps the local branch
  - `clearSavedCollections()` does not change remote account playlists
- [ ] Step 3: Run `pnpm jest src/features/music/tests/music-account-store.test.ts src/features/music/tests/music-library-store.test.ts --runInBand`
- [ ] Step 4: Implement `music-account-playlists.ts` as the frontend wrapper for the playlist-subscription route.
- [ ] Step 5: Modify `music-account-store.ts` to add the playlist mutation and rollback behavior.
- [ ] Step 6: Modify `music-library-store.ts` to:
  - filter local playlist saved-collection entries from signed-in views
  - delegate signed-in playlist saves to the account store
  - keep local clear semantics local-only
- [ ] Step 7: Re-run the same test group and expect PASS.

### Task 3: Update library / collection / sidebar semantics for cloud playlists

**Files:**

- Modify: `src/features/music/components/MusicCollectionView.tsx`
- Modify: `src/features/music/components/MusicLibraryView.tsx`
- Modify: `src/features/music/components/MusicSidebar.tsx`
- Modify: `src/features/music/components/MusicTopBar.tsx`
- Modify: `src/features/music/tests/music-phase2-ui.test.tsx`
- Modify: `src/features/music/tests/music-sidebar.test.tsx`

**Interfaces:**

- Produces:
  - signed-in playlist pages show `Collect playlist / Collected / In your playlists`
  - signed-in library shows a `My playlists` section
  - collect / uncollect refreshes sidebar playlist state immediately

- [ ] Step 1: Add failing tests in `music-phase2-ui.test.tsx` and `music-sidebar.test.tsx` covering:
  - signed-in playlist-page button copy switches to cloud playlist semantics
  - owned playlists render a read-only state
  - collect / uncollect refreshes `My playlists` count and rows
  - signed-in library renders an account playlist section
  - signing out restores local `Save to library`
- [ ] Step 2: Run `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx src/features/music/tests/music-sidebar.test.tsx --runInBand`
- [ ] Step 3: Implement the minimal UI copy, button-state logic, and account playlist section without adding a new page.
- [ ] Step 4: Re-run the same test group and expect PASS.

### Task 4: Run full verification

**Files:**

- Test only

**Interfaces:**

- Consumes: full Task 1-3 implementation
- Produces: a verified end-to-end cloud-playlist vertical slice

- [ ] Step 1: Run

```bash
pnpm jest \
  src/features/music/tests/netease-repository.test.ts \
  src/features/music/tests/music-account-routes.test.ts \
  src/features/music/tests/music-account-store.test.ts \
  src/features/music/tests/music-library-store.test.ts \
  src/features/music/tests/music-phase2-ui.test.tsx \
  src/features/music/tests/music-sidebar.test.tsx \
  --runInBand
```

- [ ] Step 2: Run `pnpm jest src/features/music/tests src/app/music/page.test.tsx --runInBand`
- [ ] Step 3: Run `pnpm typecheck`
- [ ] Step 4: If output diverges from expectations, fix from the failing point; only consider commit preparation after everything passes.
