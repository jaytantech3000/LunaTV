# LunaTV Music System Rebuild Phase 1 Big-Bang Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the old music system directly, rebuild the new application shell (应用壳层) and playback core (播放核心) on the live `/music` route, and make the new system complete a minimum runnable loop with fixture data.

**Architecture:** Use a `big-bang` path: remove the old `components/music`, old `lib/music`, old `musicPlayerStore`, old `/api/music/*`, and old audio-stream implementation first, then build the new shell, stores, services, and player components under `src/features/music/`. Execute the work in six TDD slices: shell bootstrap, data/state scaffold, playback services, player UI, fixture interaction loop, and final smoke verification.

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand, Jest, Testing Library, Git

## Global Constraints

- Delete the old `components/music`, `lib/music`, `musicPlayerStore`, old `/api/music/*`, and old audio-stream route directly
- Rebuild the page shell on the official `/music` route without creating `/music-v2` or any parallel fallback entry
- Create an isolated `src/features/music/` directory for the new components, state, services, and domain models
- Do not keep the old `/music` implementation as a rollback surface (回退面)
- Do not reuse the old `MusicPlayerRoot`, old `musicPlayerStore`, old `music-client`, or old provider implementations
- Phase 1 uses a `fixture-repository`, but the full chain must still go through the new repository interfaces
- The mini player, expanded player, lyrics panel, queue panel, shortcuts, and media session must all be owned by the new system
- Keep formal documents in bilingual versions

## File Map

- Create: `src/features/music/app/MusicPageShell.tsx` — new `/music` route composition
- Create: `src/features/music/components/MusicShell.tsx` — top-level page shell
- Create: `src/features/music/components/MusicSidebar.tsx` — left navigation
- Create: `src/features/music/components/MusicTopBar.tsx` — top bar
- Create: `src/features/music/components/MusicHero.tsx` — hero and summary content
- Create: `src/features/music/components/MusicPlayerRoot.tsx` — new global player root
- Create: `src/features/music/components/MusicMiniPlayer.tsx` — bottom mini player
- Create: `src/features/music/components/MusicFullPlayer.tsx` — fullscreen player
- Create: `src/features/music/components/MusicQueueDrawer.tsx` — queue panel
- Create: `src/features/music/components/MusicLyricsPanel.tsx` — lyrics panel
- Create: `src/features/music/domain/entities.ts` — unified domain models (统一领域模型)
- Create: `src/features/music/domain/repositories.ts` — repository contracts (仓储契约)
- Create: `src/features/music/services/fixture-repository.ts` — Phase 1 fixture-data implementation
- Create: `src/features/music/services/audio-engine.ts` — playback-core service
- Create: `src/features/music/services/media-session.ts` — media-session binding
- Create: `src/features/music/services/keyboard-shortcuts.ts` — keyboard bindings
- Create: `src/features/music/state/music-shell-store.ts` — page-shell store
- Create: `src/features/music/state/playback-store.ts` — playback store
- Create: `src/features/music/state/player-surface-store.ts` — UI-surface store
- Create: `src/features/music/state/lyrics-store.ts` — lyrics store
- Create: `src/features/music/tests/music-page-shell.test.tsx`
- Create: `src/features/music/tests/music-shell-store.test.ts`
- Create: `src/features/music/tests/fixture-repository.test.ts`
- Create: `src/features/music/tests/playback-store.test.ts`
- Create: `src/features/music/tests/audio-engine.test.ts`
- Create: `src/features/music/tests/music-player-root.test.tsx`
- Create: `src/features/music/tests/music-player-ui.test.tsx`
- Create: `src/features/music/tests/music-big-bang-smoke.test.tsx`
- Modify: `src/app/music/page.tsx`
- Modify: `src/app/music/page.test.tsx`
- Modify: `src/app/layout.tsx`
- Delete: `src/components/music/`
- Delete: `src/lib/music/`
- Delete: `src/lib/transport/music-client.ts`
- Delete: `src/stores/musicPlayerStore.ts`
- Delete: `src/stores/musicPlayerStore.test.ts`
- Delete: `src/app/api/music/`
- Delete: `src/app/media/audio/stream/route.ts`
- Delete: `src/app/media/audio/stream/route.test.ts`

---

### Task 1: Big-Bang Delete the Old UI and Bootstrap the New `/music` Shell

**Files:**

- Delete: `src/components/music/`
- Create: `src/features/music/app/MusicPageShell.tsx`
- Create: `src/features/music/components/MusicShell.tsx`
- Create: `src/features/music/components/MusicSidebar.tsx`
- Create: `src/features/music/components/MusicTopBar.tsx`
- Create: `src/features/music/components/MusicHero.tsx`
- Create: `src/features/music/components/MusicPlayerRoot.tsx`
- Modify: `src/app/music/page.tsx`
- Modify: `src/app/music/page.test.tsx`
- Modify: `src/app/layout.tsx`
- Test: `src/app/music/page.test.tsx`

**Interfaces:**

- Produces: `export default function MusicPageShell(): JSX.Element`
- Produces: `export default function MusicPlayerRoot(): JSX.Element | null`
- Produces: `export function MusicShell(): JSX.Element`

- [ ] **Step 1: Write the failing test that proves `/music` now points to the new shell instead of the old `MusicPageClient`**

```tsx
jest.mock('@/features/music/app/MusicPageShell', () => ({
  __esModule: true,
  default: () => <div>music-shell-root</div>,
}));

it('renders the rebuilt music shell when web music is enabled', async () => {
  mockGetRuntimeConfig.mockReturnValue({
    ENABLE_WEB_MUSIC: true,
  });

  const MusicPage = (await import('./page')).default;
  render(<MusicPage />);

  expect(await screen.findByText('music-shell-root')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm jest src/app/music/page.test.tsx --runInBand`
Expected: FAIL because `@/features/music/app/MusicPageShell` does not exist yet or the page still mocks the old `MusicPageClient`.

- [ ] **Step 3: Write the minimal implementation and remove the old UI directory**

```tsx
// src/features/music/app/MusicPageShell.tsx
'use client';

import PageLayout from '@/components/PageLayout';

import { MusicShell } from '../components/MusicShell';

export default function MusicPageShell() {
  return (
    <PageLayout activePath='/music'>
      <MusicShell />
    </PageLayout>
  );
}
```

```tsx
// src/features/music/components/MusicShell.tsx
import { MusicHero } from './MusicHero';
import { MusicSidebar } from './MusicSidebar';
import { MusicTopBar } from './MusicTopBar';

export function MusicShell() {
  return (
    <div className='grid min-h-[60vh] gap-6 lg:grid-cols-[240px_minmax(0,1fr)]'>
      <MusicSidebar />
      <section className='space-y-6 rounded-[32px] bg-neutral-950/95 p-6 text-white'>
        <MusicTopBar />
        <MusicHero />
      </section>
    </div>
  );
}
```

```tsx
// src/features/music/components/MusicSidebar.tsx
export function MusicSidebar() {
  return (
    <aside className='rounded-[32px] border border-white/10 bg-black/90 p-5 text-white'>
      <div className='text-sm uppercase tracking-[0.24em] text-white/45'>
        Luna Music
      </div>
      <nav className='mt-6 space-y-3 text-sm'>
        <a className='block rounded-2xl bg-white/10 px-4 py-3'>Home</a>
        <a className='block rounded-2xl px-4 py-3 text-white/72'>Explore</a>
        <a className='block rounded-2xl px-4 py-3 text-white/72'>Library</a>
      </nav>
    </aside>
  );
}
```

```tsx
// src/features/music/components/MusicTopBar.tsx
export function MusicTopBar() {
  return (
    <header className='flex items-center justify-between gap-4'>
      <input
        readOnly
        value='Search music'
        className='w-full rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm'
      />
      <button className='rounded-full border border-white/10 px-4 py-3 text-sm'>
        Theme
      </button>
    </header>
  );
}
```

```tsx
// src/features/music/components/MusicHero.tsx
export function MusicHero() {
  return (
    <section className='rounded-[28px] bg-[radial-gradient(circle_at_top_left,#f97316,transparent_35%),linear-gradient(135deg,#111827,#020617)] p-6'>
      <p className='text-xs uppercase tracking-[0.24em] text-white/55'>
        Rebuild in progress
      </p>
      <h1 className='mt-3 text-3xl font-semibold'>Music big-bang rewrite</h1>
      <p className='mt-3 max-w-2xl text-sm leading-7 text-white/72'>
        The old music UI has been removed. This shell is now the official
        `/music` surface for the rebuild.
      </p>
    </section>
  );
}
```

```tsx
// src/features/music/components/MusicPlayerRoot.tsx
export default function MusicPlayerRoot() {
  return null;
}
```

```tsx
// src/app/music/page.tsx
'use client';

import { Suspense } from 'react';

import MusicPageShell from '@/features/music/app/MusicPageShell';

export default function MusicPage() {
  return (
    <Suspense fallback={<div className='min-h-[60vh]' />}>
      <MusicPageShell />
    </Suspense>
  );
}
```

```tsx
// src/app/layout.tsx
import MusicPlayerRoot from '@/features/music/components/MusicPlayerRoot';
```

```bash
git rm -r src/components/music
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm jest src/app/music/page.test.tsx --runInBand`
Expected: PASS, and `/music` renders the new shell instead of the removed `MusicPageClient`.

- [ ] **Step 5: Commit**

```bash
git add src/app/music/page.tsx src/app/music/page.test.tsx src/app/layout.tsx src/features/music
git add -A src/components/music
git commit -m "refactor(music): bootstrap big-bang shell"
```

### Task 2: Delete the Old Data Layer and Establish New Domain Contracts plus Fixture Repository

**Files:**

- Delete: `src/lib/music/`
- Delete: `src/lib/transport/music-client.ts`
- Delete: `src/app/api/music/`
- Delete: `src/app/media/audio/stream/route.ts`
- Delete: `src/app/media/audio/stream/route.test.ts`
- Delete: `src/stores/musicPlayerStore.ts`
- Delete: `src/stores/musicPlayerStore.test.ts`
- Create: `src/features/music/domain/entities.ts`
- Create: `src/features/music/domain/repositories.ts`
- Create: `src/features/music/services/fixture-repository.ts`
- Create: `src/features/music/state/music-shell-store.ts`
- Create: `src/features/music/tests/fixture-repository.test.ts`
- Create: `src/features/music/tests/music-shell-store.test.ts`
- Test: `src/features/music/tests/fixture-repository.test.ts`
- Test: `src/features/music/tests/music-shell-store.test.ts`

**Interfaces:**

- Produces: `export interface MusicRepository`
- Produces: `export function createFixtureRepository(): MusicRepository`
- Produces: `export const useMusicShellStore`

- [ ] **Step 1: Write the failing tests that lock the new repository and shell-store contracts**

```ts
import { createFixtureRepository } from '../services/fixture-repository';

it('returns Home, Explore, and Library fixture sections', async () => {
  const repository = createFixtureRepository();
  const home = await repository.getHomeView();

  expect(home.sections.map((section) => section.id)).toEqual([
    'home',
    'explore',
    'library',
  ]);
  expect(home.featuredQueue).toHaveLength(3);
});
```

```ts
import { useMusicShellStore } from '../state/music-shell-store';

it('toggles the sidebar without touching provider data', () => {
  const store = useMusicShellStore.getState();

  expect(store.sidebarCollapsed).toBe(false);
  store.toggleSidebar();
  expect(useMusicShellStore.getState().sidebarCollapsed).toBe(true);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm jest src/features/music/tests/fixture-repository.test.ts src/features/music/tests/music-shell-store.test.ts --runInBand`
Expected: FAIL because the new repository and store files do not exist yet.

- [ ] **Step 3: Write the minimal implementation and remove the old data layer**

```ts
// src/features/music/domain/entities.ts
export interface MusicTrackEntity {
  id: string;
  source: 'fixture';
  title: string;
  artists: string[];
  album: string;
  coverUrl: string;
  durationMs: number;
  stream: string;
  playable: boolean;
}

export interface QueueItemEntity {
  queueId: string;
  track: MusicTrackEntity;
  addedAt: number;
  fromContext: 'featured' | 'recent' | 'library';
}

export interface LyricDocumentEntity {
  trackId: string;
  source: 'fixture';
  offsetMs: number;
  lines: Array<{ timeMs: number; text: string }>;
}

export interface MusicHomeView {
  sections: Array<{ id: 'home' | 'explore' | 'library'; title: string }>;
  featuredQueue: QueueItemEntity[];
}
```

```ts
// src/features/music/domain/repositories.ts
import type {
  LyricDocumentEntity,
  MusicHomeView,
  QueueItemEntity,
} from './entities';

export interface MusicRepository {
  getHomeView(): Promise<MusicHomeView>;
  getLyrics(trackId: string): Promise<LyricDocumentEntity>;
  getQueueByContext(
    context: 'featured' | 'recent' | 'library'
  ): Promise<QueueItemEntity[]>;
}
```

```ts
// src/features/music/services/fixture-repository.ts
import type {
  LyricDocumentEntity,
  MusicHomeView,
  QueueItemEntity,
} from '../domain/entities';
import type { MusicRepository } from '../domain/repositories';

const FEATURED_QUEUE: QueueItemEntity[] = [
  {
    queueId: 'fixture-1',
    addedAt: 1,
    fromContext: 'featured',
    track: {
      id: 'track-1',
      source: 'fixture',
      title: 'Neon Harbour',
      artists: ['Luna Ensemble'],
      album: 'Afterglow',
      coverUrl: '/logo.png',
      durationMs: 215000,
      stream: '/fixtures/music/neon-harbour.mp3',
      playable: true,
    },
  },
  {
    queueId: 'fixture-2',
    addedAt: 2,
    fromContext: 'featured',
    track: {
      id: 'track-2',
      source: 'fixture',
      title: 'Signal Bloom',
      artists: ['Night Drive'],
      album: 'Soft Static',
      coverUrl: '/logo.png',
      durationMs: 194000,
      stream: '/fixtures/music/signal-bloom.mp3',
      playable: true,
    },
  },
  {
    queueId: 'fixture-3',
    addedAt: 3,
    fromContext: 'featured',
    track: {
      id: 'track-3',
      source: 'fixture',
      title: 'Glass Sunrise',
      artists: ['Arc Radio'],
      album: 'Morning Loop',
      coverUrl: '/logo.png',
      durationMs: 228000,
      stream: '/fixtures/music/glass-sunrise.mp3',
      playable: true,
    },
  },
];

export function createFixtureRepository(): MusicRepository {
  return {
    async getHomeView(): Promise<MusicHomeView> {
      return {
        sections: [
          { id: 'home', title: 'Home' },
          { id: 'explore', title: 'Explore' },
          { id: 'library', title: 'Library' },
        ],
        featuredQueue: FEATURED_QUEUE,
      };
    },
    async getLyrics(trackId: string): Promise<LyricDocumentEntity> {
      return {
        trackId,
        source: 'fixture',
        offsetMs: 0,
        lines: [
          { timeMs: 0, text: 'Lights on the harbour line' },
          { timeMs: 12000, text: 'We move with the midnight tide' },
        ],
      };
    },
    async getQueueByContext() {
      return FEATURED_QUEUE;
    },
  };
}
```

```ts
// src/features/music/state/music-shell-store.ts
'use client';

import { create } from 'zustand';

interface MusicShellState {
  activeSection: 'home' | 'explore' | 'library';
  sidebarCollapsed: boolean;
  mobileDrawerOpen: boolean;
  layoutMode: 'desktop' | 'mobile';
  themeVariant: 'sunset' | 'midnight';
  toggleSidebar: () => void;
  setActiveSection: (section: MusicShellState['activeSection']) => void;
}

export const useMusicShellStore = create<MusicShellState>((set) => ({
  activeSection: 'home',
  sidebarCollapsed: false,
  mobileDrawerOpen: false,
  layoutMode: 'desktop',
  themeVariant: 'midnight',
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setActiveSection: (activeSection) => set({ activeSection }),
}));
```

```bash
git rm -r src/lib/music src/app/api/music
git rm src/lib/transport/music-client.ts src/stores/musicPlayerStore.ts src/stores/musicPlayerStore.test.ts
git rm src/app/media/audio/stream/route.ts src/app/media/audio/stream/route.test.ts
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm jest src/features/music/tests/fixture-repository.test.ts src/features/music/tests/music-shell-store.test.ts --runInBand`
Expected: PASS, with a new repository/store scaffold and the old data layer removed from the branch.

- [ ] **Step 5: Commit**

```bash
git add src/features/music/domain src/features/music/services src/features/music/state src/features/music/tests
git add -A src/lib/music src/lib/transport/music-client.ts src/stores/musicPlayerStore.ts src/stores/musicPlayerStore.test.ts src/app/api/music src/app/media/audio/stream
git commit -m "refactor(music): replace legacy data layer with fixtures"
```

### Task 3: Build the Playback-Core Stores plus Lyrics and Surface State

**Files:**

- Create: `src/features/music/state/playback-store.ts`
- Create: `src/features/music/state/player-surface-store.ts`
- Create: `src/features/music/state/lyrics-store.ts`
- Create: `src/features/music/tests/playback-store.test.ts`
- Test: `src/features/music/tests/playback-store.test.ts`

**Interfaces:**

- Produces: `export const usePlaybackStore`
- Produces: `export const usePlayerSurfaceStore`
- Produces: `export const useLyricsStore`
- Produces: `export function selectCurrentQueueItem(...)`

- [ ] **Step 1: Write the failing tests for queue progression, surface expansion, and lyric-sync state**

```ts
import { useLyricsStore } from '../state/lyrics-store';
import { usePlaybackStore } from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

it('advances to the next track in list-loop mode', () => {
  const playback = usePlaybackStore.getState();
  playback.seedQueue([
    {
      queueId: 'a',
      addedAt: 1,
      fromContext: 'featured',
      track: {
        id: 't1',
        source: 'fixture',
        title: 'A',
        artists: ['x'],
        album: 'aa',
        coverUrl: '/logo.png',
        durationMs: 1000,
        stream: '/a.mp3',
        playable: true,
      },
    },
    {
      queueId: 'b',
      addedAt: 2,
      fromContext: 'featured',
      track: {
        id: 't2',
        source: 'fixture',
        title: 'B',
        artists: ['y'],
        album: 'bb',
        coverUrl: '/logo.png',
        durationMs: 1000,
        stream: '/b.mp3',
        playable: true,
      },
    },
  ]);

  playback.playNext();

  expect(usePlaybackStore.getState().currentTrackId).toBe('t2');
});

it('opens the full player without mutating the queue', () => {
  usePlayerSurfaceStore.getState().openFullPlayer();

  expect(usePlayerSurfaceStore.getState().fullPlayerOpen).toBe(true);
});

it('tracks the active lyric line index', () => {
  useLyricsStore.getState().setLyrics({
    trackId: 't1',
    source: 'fixture',
    offsetMs: 0,
    lines: [{ timeMs: 0, text: 'line 1' }],
  });

  useLyricsStore.getState().setActiveLineIndex(0);
  expect(useLyricsStore.getState().activeLineIndex).toBe(0);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm jest src/features/music/tests/playback-store.test.ts --runInBand`
Expected: FAIL because the new playback, surface, and lyrics stores do not exist yet.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/features/music/state/playback-store.ts
'use client';

import { create } from 'zustand';

import type { QueueItemEntity } from '../domain/entities';

interface PlaybackState {
  queue: QueueItemEntity[];
  currentTrackId: string | null;
  playState: 'idle' | 'playing' | 'paused';
  playMode: 'list-loop' | 'single-loop';
  volume: number;
  muted: boolean;
  positionMs: number;
  durationMs: number;
  bufferedMs: number;
  error: string | null;
  seedQueue: (queue: QueueItemEntity[]) => void;
  playNext: () => void;
  playPrevious: () => void;
  setPlayState: (playState: PlaybackState['playState']) => void;
  setPositionMs: (positionMs: number) => void;
  setDurationMs: (durationMs: number) => void;
  setError: (error: string | null) => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  queue: [],
  currentTrackId: null,
  playState: 'idle',
  playMode: 'list-loop',
  volume: 0.9,
  muted: false,
  positionMs: 0,
  durationMs: 0,
  bufferedMs: 0,
  error: null,
  seedQueue: (queue) =>
    set({
      queue,
      currentTrackId: queue[0]?.track.id ?? null,
      playState: queue.length ? 'playing' : 'idle',
      positionMs: 0,
      durationMs: queue[0]?.track.durationMs ?? 0,
      error: null,
    }),
  playNext: () =>
    set((state) => {
      const currentIndex = state.queue.findIndex(
        (item) => item.track.id === state.currentTrackId
      );
      const nextItem = state.queue[currentIndex + 1] ?? state.queue[0] ?? null;

      return {
        currentTrackId: nextItem?.track.id ?? null,
        durationMs: nextItem?.track.durationMs ?? 0,
        positionMs: 0,
      };
    }),
  playPrevious: () =>
    set((state) => {
      const currentIndex = state.queue.findIndex(
        (item) => item.track.id === state.currentTrackId
      );
      const previousItem =
        state.queue[currentIndex - 1] ??
        state.queue[state.queue.length - 1] ??
        null;

      return {
        currentTrackId: previousItem?.track.id ?? null,
        durationMs: previousItem?.track.durationMs ?? 0,
        positionMs: 0,
      };
    }),
  setPlayState: (playState) => set({ playState }),
  setPositionMs: (positionMs) => set({ positionMs }),
  setDurationMs: (durationMs) => set({ durationMs }),
  setError: (error) => set({ error }),
}));
```

```ts
// src/features/music/state/player-surface-store.ts
'use client';

import { create } from 'zustand';

interface PlayerSurfaceState {
  miniVisible: boolean;
  fullPlayerOpen: boolean;
  lyricsPanelOpen: boolean;
  queuePanelOpen: boolean;
  transitionState: 'idle' | 'expanding' | 'collapsing';
  showMiniPlayer: () => void;
  openFullPlayer: () => void;
  closeFullPlayer: () => void;
  toggleQueuePanel: () => void;
  toggleLyricsPanel: () => void;
}

export const usePlayerSurfaceStore = create<PlayerSurfaceState>((set) => ({
  miniVisible: false,
  fullPlayerOpen: false,
  lyricsPanelOpen: true,
  queuePanelOpen: false,
  transitionState: 'idle',
  showMiniPlayer: () => set({ miniVisible: true }),
  openFullPlayer: () =>
    set({ fullPlayerOpen: true, transitionState: 'expanding' }),
  closeFullPlayer: () =>
    set({ fullPlayerOpen: false, transitionState: 'collapsing' }),
  toggleQueuePanel: () =>
    set((state) => ({ queuePanelOpen: !state.queuePanelOpen })),
  toggleLyricsPanel: () =>
    set((state) => ({ lyricsPanelOpen: !state.lyricsPanelOpen })),
}));
```

```ts
// src/features/music/state/lyrics-store.ts
'use client';

import { create } from 'zustand';

import type { LyricDocumentEntity } from '../domain/entities';

interface LyricsState {
  lyrics: LyricDocumentEntity | null;
  activeLineIndex: number;
  followMode: 'auto' | 'manual';
  manualSeekLock: boolean;
  setLyrics: (lyrics: LyricDocumentEntity | null) => void;
  setActiveLineIndex: (activeLineIndex: number) => void;
}

export const useLyricsStore = create<LyricsState>((set) => ({
  lyrics: null,
  activeLineIndex: -1,
  followMode: 'auto',
  manualSeekLock: false,
  setLyrics: (lyrics) => set({ lyrics, activeLineIndex: lyrics ? 0 : -1 }),
  setActiveLineIndex: (activeLineIndex) => set({ activeLineIndex }),
}));
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm jest src/features/music/tests/playback-store.test.ts --runInBand`
Expected: PASS, with queue progression, surface transitions, and lyric indexes all running on the new stores.

- [ ] **Step 5: Commit**

```bash
git add src/features/music/state src/features/music/tests/playback-store.test.ts
git commit -m "feat(music): add playback state core"
```

### Task 4: Build `audio-engine`, `media-session`, and `keyboard-shortcuts`

**Files:**

- Create: `src/features/music/services/audio-engine.ts`
- Create: `src/features/music/services/media-session.ts`
- Create: `src/features/music/services/keyboard-shortcuts.ts`
- Modify: `src/features/music/components/MusicPlayerRoot.tsx`
- Create: `src/features/music/tests/audio-engine.test.ts`
- Create: `src/features/music/tests/music-player-root.test.tsx`
- Test: `src/features/music/tests/audio-engine.test.ts`
- Test: `src/features/music/tests/music-player-root.test.tsx`

**Interfaces:**

- Produces: `export function createAudioEngine(audio: HTMLAudioElement): AudioEngine`
- Produces: `export function bindMusicMediaSession(...)`
- Produces: `export function bindMusicKeyboardShortcuts(...)`

- [ ] **Step 1: Write the failing tests that prove the playback services sync state and mount the new player root**

```ts
import { createAudioEngine } from '../services/audio-engine';
import { usePlaybackStore } from '../state/playback-store';

it('writes current time and pause state back into playbackStore', () => {
  const audio = document.createElement('audio');
  const engine = createAudioEngine(audio);

  engine.syncDuration(215000);
  engine.syncPosition(32000);
  engine.pause();

  expect(usePlaybackStore.getState().durationMs).toBe(215000);
  expect(usePlaybackStore.getState().positionMs).toBe(32000);
  expect(usePlaybackStore.getState().playState).toBe('paused');
});
```

```tsx
it('mounts the rebuilt player root without importing legacy music modules', () => {
  const { container } = render(<MusicPlayerRoot />);
  expect(container).toBeTruthy();
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm jest src/features/music/tests/audio-engine.test.ts src/features/music/tests/music-player-root.test.tsx --runInBand`
Expected: FAIL because the new service logic and player root are not implemented yet.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/features/music/services/audio-engine.ts
import { usePlaybackStore } from '../state/playback-store';

export interface AudioEngine {
  load: (src: string) => void;
  play: () => void;
  pause: () => void;
  syncDuration: (durationMs: number) => void;
  syncPosition: (positionMs: number) => void;
}

export function createAudioEngine(audio: HTMLAudioElement): AudioEngine {
  return {
    load(src) {
      audio.src = src;
    },
    play() {
      usePlaybackStore.getState().setPlayState('playing');
    },
    pause() {
      usePlaybackStore.getState().setPlayState('paused');
    },
    syncDuration(durationMs) {
      usePlaybackStore.getState().setDurationMs(durationMs);
    },
    syncPosition(positionMs) {
      usePlaybackStore.getState().setPositionMs(positionMs);
    },
  };
}
```

```ts
// src/features/music/services/media-session.ts
import type { QueueItemEntity } from '../domain/entities';

export function bindMusicMediaSession(track: QueueItemEntity | null) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return;
  }

  navigator.mediaSession.metadata = track
    ? new MediaMetadata({
        title: track.track.title,
        artist: track.track.artists.join(' / '),
        album: track.track.album,
      })
    : null;
}
```

```ts
// src/features/music/services/keyboard-shortcuts.ts
export function bindMusicKeyboardShortcuts(
  onTogglePlay: () => void,
  onNext: () => void
) {
  const listener = (event: KeyboardEvent) => {
    if (event.code === 'Space') {
      event.preventDefault();
      onTogglePlay();
    }
    if (event.code === 'ArrowRight') {
      event.preventDefault();
      onNext();
    }
  };

  window.addEventListener('keydown', listener);
  return () => window.removeEventListener('keydown', listener);
}
```

```tsx
// src/features/music/components/MusicPlayerRoot.tsx
'use client';

import { useEffect, useRef } from 'react';

import { createAudioEngine } from '../services/audio-engine';

export default function MusicPlayerRoot() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!audioRef.current) {
      return;
    }

    const engine = createAudioEngine(audioRef.current);
    engine.syncPosition(0);
  }, []);

  return <audio ref={audioRef} hidden preload='metadata' />;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm jest src/features/music/tests/audio-engine.test.ts src/features/music/tests/music-player-root.test.tsx --runInBand`
Expected: PASS, with service state sync working and the new `MusicPlayerRoot` now owning the global player mount.

- [ ] **Step 5: Commit**

```bash
git add src/features/music/services src/features/music/components/MusicPlayerRoot.tsx src/features/music/tests/audio-engine.test.ts src/features/music/tests/music-player-root.test.tsx
git commit -m "feat(music): add playback services"
```

### Task 5: Build the New Player UI and Drive It from the Fixture Queue

**Files:**

- Create: `src/features/music/components/MusicMiniPlayer.tsx`
- Create: `src/features/music/components/MusicFullPlayer.tsx`
- Create: `src/features/music/components/MusicQueueDrawer.tsx`
- Create: `src/features/music/components/MusicLyricsPanel.tsx`
- Modify: `src/features/music/components/MusicShell.tsx`
- Modify: `src/features/music/components/MusicHero.tsx`
- Modify: `src/features/music/components/MusicPlayerRoot.tsx`
- Create: `src/features/music/tests/music-player-ui.test.tsx`
- Test: `src/features/music/tests/music-player-ui.test.tsx`

**Interfaces:**

- Consumes: `createFixtureRepository(): MusicRepository`
- Consumes: `usePlaybackStore`
- Consumes: `usePlayerSurfaceStore`
- Produces: `onPlayFeaturedQueue(): Promise<void>`

- [ ] **Step 1: Write the failing test for the mini player, expanded player, and queue/lyrics surfaces**

```tsx
import MusicPageShell from '../app/MusicPageShell';
import MusicPlayerRoot from '../components/MusicPlayerRoot';

it('plays the fixture queue, shows lyrics, and expands the rebuilt player', async () => {
  render(
    <>
      <MusicPageShell />
      <MusicPlayerRoot />
    </>
  );

  fireEvent.click(screen.getByRole('button', { name: 'Play featured queue' }));

  expect(await screen.findByTestId('music-mini-player')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Open full player' }));
  expect(await screen.findByTestId('music-full-player')).toBeInTheDocument();
  expect(screen.getByTestId('music-lyrics-panel')).toBeInTheDocument();
  expect(screen.getByText('Lights on the harbour line')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Open queue panel' }));
  expect(screen.getByTestId('music-queue-drawer')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm jest src/features/music/tests/music-player-ui.test.tsx --runInBand`
Expected: FAIL because there is no `Play featured queue` action, no `music-mini-player`, and no expanded player yet.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// src/features/music/components/MusicHero.tsx
'use client';

import { createFixtureRepository } from '../services/fixture-repository';
import { useLyricsStore } from '../state/lyrics-store';
import { usePlaybackStore } from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

export function MusicHero() {
  const seedQueue = usePlaybackStore((state) => state.seedQueue);
  const showMiniPlayer = usePlayerSurfaceStore((state) => state.showMiniPlayer);

  const handlePlayFeaturedQueue = async () => {
    const repository = createFixtureRepository();
    const queue = await repository.getQueueByContext('featured');
    const lyrics = await repository.getLyrics(queue[0].track.id);
    seedQueue(queue);
    useLyricsStore.getState().setLyrics(lyrics);
    showMiniPlayer();
  };

  return (
    <section className='rounded-[28px] bg-[radial-gradient(circle_at_top_left,#f97316,transparent_35%),linear-gradient(135deg,#111827,#020617)] p-6'>
      <p className='text-xs uppercase tracking-[0.24em] text-white/55'>
        Rebuild in progress
      </p>
      <h1 className='mt-3 text-3xl font-semibold'>Music big-bang rewrite</h1>
      <button
        type='button'
        onClick={handlePlayFeaturedQueue}
        className='mt-6 rounded-full bg-white px-5 py-3 text-sm font-medium text-black'
      >
        Play featured queue
      </button>
    </section>
  );
}
```

```tsx
// src/features/music/components/MusicMiniPlayer.tsx
'use client';

import { usePlaybackStore } from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

import { MusicLyricsPanel } from './MusicLyricsPanel';
import { MusicQueueDrawer } from './MusicQueueDrawer';

export function MusicMiniPlayer() {
  const currentTrackId = usePlaybackStore((state) => state.currentTrackId);
  const queue = usePlaybackStore((state) => state.queue);
  const openFullPlayer = usePlayerSurfaceStore((state) => state.openFullPlayer);

  const currentTrack = queue.find((item) => item.track.id === currentTrackId);
  if (!currentTrack) {
    return null;
  }

  return (
    <div
      data-testid='music-mini-player'
      className='fixed bottom-6 left-1/2 z-40 w-[min(960px,calc(100vw-32px))] -translate-x-1/2 rounded-full bg-black/92 px-6 py-4 text-white shadow-2xl'
    >
      <div className='flex items-center justify-between gap-4'>
        <div>
          <div className='text-sm font-semibold'>
            {currentTrack.track.title}
          </div>
          <div className='text-xs text-white/65'>
            {currentTrack.track.artists.join(' / ')}
          </div>
        </div>
        <button
          type='button'
          aria-label='Open full player'
          onClick={openFullPlayer}
          className='rounded-full border border-white/15 px-4 py-2 text-xs'
        >
          Expand
        </button>
      </div>
    </div>
  );
}
```

```tsx
// src/features/music/components/MusicFullPlayer.tsx
'use client';

import { usePlaybackStore } from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

export function MusicFullPlayer() {
  const fullPlayerOpen = usePlayerSurfaceStore((state) => state.fullPlayerOpen);
  const closeFullPlayer = usePlayerSurfaceStore(
    (state) => state.closeFullPlayer
  );
  const toggleQueuePanel = usePlayerSurfaceStore(
    (state) => state.toggleQueuePanel
  );
  const queue = usePlaybackStore((state) => state.queue);

  if (!fullPlayerOpen) {
    return null;
  }

  return (
    <div
      data-testid='music-full-player'
      className='fixed inset-0 z-50 bg-slate-950/96 p-8 text-white'
    >
      <div className='mx-auto flex h-full max-w-6xl flex-col gap-6 rounded-[36px] border border-white/10 bg-black/60 p-8'>
        <div className='flex items-center justify-between'>
          <h2 className='text-2xl font-semibold'>Now Playing</h2>
          <div className='flex gap-3'>
            <button aria-label='Open queue panel' onClick={toggleQueuePanel}>
              Queue
            </button>
            <button aria-label='Close full player' onClick={closeFullPlayer}>
              Close
            </button>
          </div>
        </div>
        <div className='grid flex-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_360px]'>
          <div className='text-sm text-white/70'>{queue[0]?.track.title}</div>
          <div className='space-y-4'>
            <MusicLyricsPanel />
            <MusicQueueDrawer />
          </div>
        </div>
      </div>
    </div>
  );
}
```

```tsx
// src/features/music/components/MusicQueueDrawer.tsx
'use client';

import { usePlaybackStore } from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

export function MusicQueueDrawer() {
  const queuePanelOpen = usePlayerSurfaceStore((state) => state.queuePanelOpen);
  const queue = usePlaybackStore((state) => state.queue);

  if (!queuePanelOpen) {
    return null;
  }

  return (
    <aside
      data-testid='music-queue-drawer'
      className='rounded-[28px] border border-white/10 bg-white/5 p-5'
    >
      {queue.map((item) => (
        <div key={item.queueId} className='py-2 text-sm'>
          {item.track.title}
        </div>
      ))}
    </aside>
  );
}
```

```tsx
// src/features/music/components/MusicLyricsPanel.tsx
'use client';

import { useLyricsStore } from '../state/lyrics-store';

export function MusicLyricsPanel() {
  const lyrics = useLyricsStore((state) => state.lyrics);
  const activeLineIndex = useLyricsStore((state) => state.activeLineIndex);

  return (
    <section
      data-testid='music-lyrics-panel'
      className='rounded-[28px] border border-white/10 bg-white/5 p-5'
    >
      {(lyrics?.lines ?? []).map((line, index) => (
        <div
          key={`${line.timeMs}-${index}`}
          className={index === activeLineIndex ? 'text-white' : 'text-white/55'}
        >
          {line.text}
        </div>
      ))}
    </section>
  );
}
```

```tsx
// src/features/music/components/MusicPlayerRoot.tsx
'use client';

import { MusicFullPlayer } from './MusicFullPlayer';
import { MusicMiniPlayer } from './MusicMiniPlayer';

export default function MusicPlayerRoot() {
  return (
    <>
      <MusicMiniPlayer />
      <MusicFullPlayer />
      <audio hidden preload='metadata' />
    </>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm jest src/features/music/tests/music-player-ui.test.tsx --runInBand`
Expected: PASS, with the fixture queue showing the mini player, expanded player, and queue drawer.

- [ ] **Step 5: Commit**

```bash
git add src/features/music/components src/features/music/tests/music-player-ui.test.tsx
git commit -m "feat(music): build rebuilt player surfaces"
```

### Task 6: Finish the Big-Bang Smoke Verification and Clean Up Legacy References

**Files:**

- Create: `src/features/music/tests/music-big-bang-smoke.test.tsx`
- Test: `src/features/music/tests/music-big-bang-smoke.test.tsx`

**Interfaces:**

- Consumes: `MusicPageShell`
- Consumes: `MusicPlayerRoot`
- Produces: `music-big-bang smoke coverage`

- [ ] **Step 1: Write the failing smoke test for the official `/music` flow**

```tsx
import MusicPageShell from '../app/MusicPageShell';
import MusicPlayerRoot from '../components/MusicPlayerRoot';

it('runs the rebuilt /music flow end to end with fixture data', async () => {
  render(
    <>
      <MusicPageShell />
      <MusicPlayerRoot />
    </>
  );

  expect(screen.getByText('Music big-bang rewrite')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Play featured queue' }));
  expect(await screen.findByTestId('music-mini-player')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Open full player' }));
  expect(await screen.findByTestId('music-full-player')).toBeInTheDocument();
  expect(screen.getByTestId('music-lyrics-panel')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Close full player' }));
  await waitFor(() => {
    expect(screen.queryByTestId('music-full-player')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm jest src/features/music/tests/music-big-bang-smoke.test.tsx --runInBand`
Expected: FAIL until the shell, player root, and final wiring are all stable.

- [ ] **Step 3: Verify that no legacy music imports remain**

```bash
rg -n "@/components/music|@/lib/music|musicPlayerStore" src
```

Expected: no matches

- [ ] **Step 4: Run the smoke suite and the critical test set**

Run: `pnpm jest src/app/music/page.test.tsx src/features/music/tests/music-shell-store.test.ts src/features/music/tests/fixture-repository.test.ts src/features/music/tests/playback-store.test.ts src/features/music/tests/audio-engine.test.ts src/features/music/tests/music-player-root.test.tsx src/features/music/tests/music-player-ui.test.tsx src/features/music/tests/music-big-bang-smoke.test.tsx --runInBand`
Expected: PASS, covering the new `/music` shell, fixture playback, and rebuilt player interaction end to end.

- [ ] **Step 5: Commit**

```bash
git add src/features/music/tests/music-big-bang-smoke.test.tsx
git commit -m "test(music): verify big-bang rebuild shell"
```
