# YesPlayMusic Phase 4a Desktop Download / Offline Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop-first manual download MVP (手动下载 MVP) to the rebuilt `/music` flow so single tracks and collections can be saved into an app-managed directory (应用托管目录) and playback prefers local files.

**Architecture:** Add a dedicated `music-download` domain and frontend store, while Tauri IPC owns all file download and record persistence. The player only resolves priority between a local file and a remote stream, without introducing a new playback core.

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Zustand, Jest, Tauri 2, Rust, reqwest, serde

## Global Constraints

- Work only inside the current `React + Next.js + Tauri` rebuild path; do not reconnect the legacy music system.
- Default to ASCII, ban `any`, and follow existing music store / desktop IPC / Tauri helper patterns.
- First cut only covers manual download, app-managed directory, and local-first playback; no custom directory, auto-cache, or resumable download.
- Write the failing tests first, then the minimum implementation, then run targeted and regression verification.
- Persisted download records must never keep `track.stream`.

---

### Task 1: Define the download contract and frontend store

**Files:**

- Create: `src/features/music/services/music-download-records.ts`
- Create: `src/features/music/state/music-download-store.ts`
- Create: `src/features/music/tests/music-download-records.test.ts`
- Create: `src/features/music/tests/music-download-store.test.ts`
- Modify: `src/features/music/domain/entities.ts`

**Interfaces:**

- Produces:
  - `interface MusicDownloadRecord`
  - `createEmptyMusicDownloadState()`
  - `sanitizeMusicDownloadRecord()`
  - `buildMusicDownloadId(source, trackId, quality)`
  - `useMusicDownloadStore`

- [ ] Step 1: write failing tests in `music-download-records.test.ts` for stream stripping, invalid-state fallback, and missing-path fallback.
- [ ] Step 2: Run `pnpm jest src/features/music/tests/music-download-records.test.ts src/features/music/tests/music-download-store.test.ts --runInBand`
- [ ] Step 3: implement the minimum contract and store so records can hydrate, upsert, and remove predictably.
- [ ] Step 4: rerun the same test set and expect PASS.

### Task 2: Add Tauri IPC and the desktop bridge

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/desktop/tauri-client.ts`
- Create: `src/features/music/services/music-downloads.ts`
- Create: `src/features/music/tests/music-downloads.desktop.test.ts`

**Interfaces:**

- Produces:
  - `listMusicDownloads()`
  - `downloadMusicTrack()`
  - `deleteMusicDownload()`
  - `resolveMusicDownloadPlayback()`
  - Tauri commands:
    - `list_music_downloads`
    - `download_music_track`
    - `delete_music_download`
    - `resolve_music_download_playback`

- [ ] Step 1: write failing desktop-bridge tests for desktop invocation, non-desktop rejection, and normalized returned records.
- [ ] Step 2: Run `pnpm jest src/features/music/tests/music-downloads.desktop.test.ts --runInBand`
- [ ] Step 3: add Rust helpers for `music/downloads/records.json`, audio-file download, delete, and playback-path resolution.
- [ ] Step 4: add IPC wrappers in `tauri-client.ts` and the frontend adapter in `music-downloads.ts`.
- [ ] Step 5: rerun the desktop-bridge test and expect PASS.

### Task 3: Integrate local-first playback into the player

**Files:**

- Modify: `src/features/music/components/MusicPlayerRoot.tsx`
- Modify: `src/features/music/tests/music-player-root.test.tsx`

**Interfaces:**

- Consumes:
  - `resolveMusicDownloadPlayback()`
  - `hydrateMusicDownloads()`
- Produces:
  - downloaded tracks prefer local playback
  - missing local files fall back to remote `streamUrl`

- [ ] Step 1: add two failing tests in `music-player-root.test.tsx`:
  - a downloaded track loads a local `asset` URL
  - local-resolution failure still requests `/api/music/track`
- [ ] Step 2: Run `pnpm jest src/features/music/tests/music-player-root.test.tsx --runInBand`
- [ ] Step 3: minimally change `MusicPlayerRoot` so local resolution happens before remote track hydration.
- [ ] Step 4: rerun the player test and expect PASS.

### Task 4: Add UI entry points and interaction regression coverage

**Files:**

- Modify: `src/features/music/components/MusicCollectionView.tsx`
- Modify: `src/features/music/components/MusicFullPlayer.tsx`
- Modify: `src/features/music/components/MusicLibraryView.tsx`
- Modify: `src/features/music/components/MusicSettingsView.tsx`
- Modify: `src/features/music/tests/music-phase2-ui.test.tsx`
- Modify: `src/features/music/tests/music-big-bang-smoke.test.tsx`

**Interfaces:**

- Produces:
  - collection-level `Download all`
  - single-track `Download` / `Delete download`
  - library `Offline downloads`

- [ ] Step 1: write failing UI tests for download buttons, downloaded-state copy, and the library offline section.
- [ ] Step 2: Run `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx src/features/music/tests/music-big-bang-smoke.test.tsx --runInBand`
- [ ] Step 3: implement the smallest UI surface without adding a separate page.
- [ ] Step 4: rerun the UI tests and expect PASS.

### Task 5: Run end-to-end verification

**Files:**

- Modify: `docs/superpowers/specs/2026-06-28-yesplaymusic-phase4a-desktop-download-design.zh.md`
- Modify: `docs/superpowers/specs/2026-06-28-yesplaymusic-phase4a-desktop-download-design.en.md`
- Modify: `docs/superpowers/plans/2026-06-28-yesplaymusic-phase4a-desktop-download.zh.md`
- Modify: `docs/superpowers/plans/2026-06-28-yesplaymusic-phase4a-desktop-download.en.md`

- [ ] Step 1: Run `pnpm jest src/features/music/tests/music-download-records.test.ts src/features/music/tests/music-download-store.test.ts src/features/music/tests/music-downloads.desktop.test.ts src/features/music/tests/music-player-root.test.tsx src/features/music/tests/music-phase2-ui.test.tsx src/features/music/tests/music-big-bang-smoke.test.tsx --runInBand`
- [ ] Step 2: Run `pnpm typecheck`
- [ ] Step 3: Run `pnpm desktop:test`
- [ ] Step 4: if any command output differs from expectation, fix by failure point; only consider a commit after all checks are fresh and green.
