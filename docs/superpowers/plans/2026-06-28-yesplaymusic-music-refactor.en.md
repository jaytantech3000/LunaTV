# LunaTV YesPlayMusic Music Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a complete LunaTV music player system refactored around the interaction model of YesPlayMusic.

**Architecture:** Keep the existing `audio + MusicPlayerRoot + provider` core chain, and only refactor the player state model, bottom control bar, expanded player, and music-page information architecture. Every behavior change is locked with Jest tests first, then implemented minimally, then visually polished.

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand, Jest, Testing Library, Tailwind CSS

## Global Constraints

- Do not rewrite the existing `audio` element playback chain
- Do not copy YesPlayMusic source code directly
- Keep the multi-source provider architecture and current degradation behavior
- Keep TypeScript `strict: true`
- Do not use `any`
- Keep formal docs bilingual

---

### Task 1: Lock YesPlayMusic-style player behavior with tests

**Files:**

- Modify: `src/components/music/MusicMiniPlayer.test.tsx`
- Modify: `src/components/music/MusicFullscreenPlayer.test.tsx`
- Modify: `src/components/music/MusicPlayerRoot.test.tsx`
- Modify: `src/stores/musicPlayerStore.test.ts`

- [ ] Add bottom-bar behavior tests for queue, lyrics, repeat, shuffle, and volume
- [ ] Add tests for the default expanded-player panel
- [ ] Add end-of-track transition tests across repeat/shuffle scenarios
- [ ] Run: `pnpm jest src/components/music/MusicMiniPlayer.test.tsx src/components/music/MusicFullscreenPlayer.test.tsx src/components/music/MusicPlayerRoot.test.tsx src/stores/musicPlayerStore.test.ts --runInBand`

### Task 2: Refactor the player state model

**Files:**

- Modify: `src/lib/music/types.ts`
- Modify: `src/lib/music/format.ts`
- Modify: `src/stores/musicPlayerStore.ts`
- Modify: `src/stores/musicPlayerStore.test.ts`

- [ ] Split `playMode` into `repeatMode` and `shuffleEnabled`
- [ ] Implement the new `playNext`, `playPrevious`, `cycleRepeatMode`, and `toggleShuffle`
- [ ] Preserve persistence compatibility and migrate old state safely
- [ ] Run: `pnpm jest src/stores/musicPlayerStore.test.ts --runInBand`

### Task 3: Rebuild the bottom bar and expanded player

**Files:**

- Modify: `src/components/music/MusicMiniPlayer.tsx`
- Modify: `src/components/music/MusicFullscreenPlayer.tsx`
- Modify: `src/components/music/MusicQueuePanel.tsx`
- Modify: `src/components/music/MusicLyricsPanel.tsx`
- Modify: `src/components/music/MusicMiniPlayer.test.tsx`
- Modify: `src/components/music/MusicFullscreenPlayer.test.tsx`

- [ ] Turn the bottom bar into a three-zone YesPlayMusic-style layout
- [ ] Add queue, lyrics, repeat, shuffle, and favorite entry points
- [ ] Let expanded mode open directly on lyrics or queue from the mini player
- [ ] Unify empty-state styling for lyrics and queue
- [ ] Run: `pnpm jest src/components/music/MusicMiniPlayer.test.tsx src/components/music/MusicFullscreenPlayer.test.tsx --runInBand`

### Task 4: Update MusicPlayerRoot orchestration

**Files:**

- Modify: `src/components/music/MusicPlayerRoot.tsx`
- Modify: `src/components/music/MusicPlayerRoot.test.tsx`

- [ ] Wire in the new repeat/shuffle state and callbacks
- [ ] Add control over the default expanded-player panel
- [ ] Keep favorites, recents, and play-record persistence stable
- [ ] Run: `pnpm jest src/components/music/MusicPlayerRoot.test.tsx --runInBand`

### Task 5: Rework the music-page information architecture

**Files:**

- Modify: `src/components/music/MusicPageClient.tsx`
- Modify: `src/components/music/MusicCollectionGrid.tsx`
- Modify: `src/components/music/MusicTrackList.tsx`
- Modify: `src/components/music/MusicSourceTabs.tsx`
- Modify: `src/components/music/MusicSectionTabs.tsx`
- Modify: `src/components/music/MusicPageClient.test.tsx`

- [ ] Remove the marketing-style hero and reshape the page into a player-product layout
- [ ] Unify source navigation, section navigation, collection-detail headers, and track lists
- [ ] Keep source switching, search, library, and collection playback on one queue-based entry path
- [ ] Run: `pnpm jest src/components/music/MusicPageClient.test.tsx --runInBand`

### Task 6: Integrated verification, commit, and beta build

**Files:**

- Modify: `docs/superpowers/specs/2026-06-28-yesplaymusic-music-refactor-design.zh.md`
- Modify: `docs/superpowers/specs/2026-06-28-yesplaymusic-music-refactor-design.en.md`
- Modify: `docs/superpowers/plans/2026-06-28-yesplaymusic-music-refactor.zh.md`
- Modify: `docs/superpowers/plans/2026-06-28-yesplaymusic-music-refactor.en.md`

- [ ] Run: `pnpm jest src/components/music src/stores/musicPlayerStore.test.ts src/app/api/music/routes.test.ts --runInBand`
- [ ] Run: `pnpm typecheck`
- [ ] Run: `pnpm build`
- [ ] Run the beta build command and confirm the artifact
- [ ] Commit: `git commit -m "feat(music): refactor player to yesplaymusic layout"`
- [ ] Push the current branch
