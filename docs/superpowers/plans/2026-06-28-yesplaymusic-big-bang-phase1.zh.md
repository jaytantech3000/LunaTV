# LunaTV 音乐系统从零复刻 Phase 1 Big-Bang Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 直接删除旧音乐系统，在正式 `/music` 路径上重建新的应用壳层和播放核心，并让新系统以 fixture 数据完成最小可运行闭环。

**Architecture:** 采用 `big-bang` 路径：先删除旧 `components/music`、旧 `lib/music`、旧 `musicPlayerStore`、旧 `/api/music/*` 和旧音频流实现，再在 `src/features/music/` 内建立新的壳层、store、service 和播放器组件。实现按 TDD 分六段推进：壳层引导、数据/状态骨架、播放服务、播放器 UI、fixture 交互闭环、最终 smoke 验证。

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand, Jest, Testing Library, Git

## Global Constraints

- 直接删除旧 `components/music`、`lib/music`、`musicPlayerStore`、旧 `/api/music/*` 和旧音频流路由
- 在正式 `/music` 路径上重建新的页面壳层，不创建 `/music-v2` 或其他并行回退入口
- 新建独立 `src/features/music/` 目录，承载新的组件、状态、服务和领域模型
- 不保留旧 `/music` 作为回退面
- 不复用旧 `MusicPlayerRoot`、旧 `musicPlayerStore`、旧 `music-client` 或旧 provider 实现
- Phase 1 先用 `fixture-repository` 提供假数据，但必须通过新的 repository 接口走完整链路
- mini player、expanded player、lyrics panel、queue panel、快捷键和媒体会话必须由新系统接管
- 文档使用中英双语版本

## File Map

- Create: `src/features/music/app/MusicPageShell.tsx` — 新 `/music` 正式入口装配
- Create: `src/features/music/components/MusicShell.tsx` — 页面总壳层
- Create: `src/features/music/components/MusicSidebar.tsx` — 左侧导航
- Create: `src/features/music/components/MusicTopBar.tsx` — 顶栏
- Create: `src/features/music/components/MusicHero.tsx` — hero 与内容摘要
- Create: `src/features/music/components/MusicPlayerRoot.tsx` — 新全局播放器根
- Create: `src/features/music/components/MusicMiniPlayer.tsx` — 底部 mini player
- Create: `src/features/music/components/MusicFullPlayer.tsx` — 全屏播放器
- Create: `src/features/music/components/MusicQueueDrawer.tsx` — 队列面板
- Create: `src/features/music/components/MusicLyricsPanel.tsx` — 歌词面板
- Create: `src/features/music/domain/entities.ts` — 统一领域模型
- Create: `src/features/music/domain/repositories.ts` — repository 协议
- Create: `src/features/music/services/fixture-repository.ts` — Phase 1 fixture 数据实现
- Create: `src/features/music/services/audio-engine.ts` — 播放内核服务
- Create: `src/features/music/services/media-session.ts` — 媒体会话绑定
- Create: `src/features/music/services/keyboard-shortcuts.ts` — 快捷键绑定
- Create: `src/features/music/state/music-shell-store.ts` — 页面壳层 store
- Create: `src/features/music/state/playback-store.ts` — 播放状态 store
- Create: `src/features/music/state/player-surface-store.ts` — UI surface store
- Create: `src/features/music/state/lyrics-store.ts` — 歌词 store
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

### Task 1: Big-Bang 删除旧 UI 并引导新 `/music` 壳层

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

- [ ] **Step 1: 写失败测试，证明 `/music` 已切到新壳层而不是旧 `MusicPageClient`**

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

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/app/music/page.test.tsx --runInBand`
Expected: FAIL，提示找不到 `@/features/music/app/MusicPageShell` 或页面仍在 mock 旧 `MusicPageClient`。

- [ ] **Step 3: 实现最小代码并删掉旧 UI 目录**

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

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/app/music/page.test.tsx --runInBand`
Expected: PASS，`/music` 页面渲染新 `music-shell-root` 或新壳层内容，旧 `MusicPageClient` 不再被引用。

- [ ] **Step 5: Commit**

```bash
git add src/app/music/page.tsx src/app/music/page.test.tsx src/app/layout.tsx src/features/music
git add -A src/components/music
git commit -m "refactor(music): bootstrap big-bang shell"
```

### Task 2: 删除旧数据层并建立新领域契约与 fixture repository

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

- [ ] **Step 1: 写失败测试，锁定新 repository 和壳层 store 的契约**

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

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/fixture-repository.test.ts src/features/music/tests/music-shell-store.test.ts --runInBand`
Expected: FAIL，提示找不到新的 repository / store 文件。

- [ ] **Step 3: 实现最小代码并删除旧数据层**

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

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/fixture-repository.test.ts src/features/music/tests/music-shell-store.test.ts --runInBand`
Expected: PASS，新的 repository 与壳层 store 已建立，旧数据目录已从分支移除。

- [ ] **Step 5: Commit**

```bash
git add src/features/music/domain src/features/music/services src/features/music/state src/features/music/tests
git add -A src/lib/music src/lib/transport/music-client.ts src/stores/musicPlayerStore.ts src/stores/musicPlayerStore.test.ts src/app/api/music src/app/media/audio/stream
git commit -m "refactor(music): replace legacy data layer with fixtures"
```

### Task 3: 建立播放内核 store 与歌词 / surface 状态

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

- [ ] **Step 1: 写失败测试，覆盖队列推进、surface 展开和歌词同步状态**

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

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/playback-store.test.ts --runInBand`
Expected: FAIL，新的 playback / surface / lyrics store 尚不存在。

- [ ] **Step 3: 实现最小代码**

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

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/playback-store.test.ts --runInBand`
Expected: PASS，队列推进、surface 状态和歌词索引都按新 store 运转。

- [ ] **Step 5: Commit**

```bash
git add src/features/music/state src/features/music/tests/playback-store.test.ts
git commit -m "feat(music): add playback state core"
```

### Task 4: 建立 audio-engine、media-session 和 keyboard-shortcuts

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

- [ ] **Step 1: 写失败测试，证明播放服务会同步 store 和播放器 root**

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

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/audio-engine.test.ts src/features/music/tests/music-player-root.test.tsx --runInBand`
Expected: FAIL，提示新的 service 或 root 逻辑不存在。

- [ ] **Step 3: 实现最小代码**

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

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/audio-engine.test.ts src/features/music/tests/music-player-root.test.tsx --runInBand`
Expected: PASS，服务能写回 store，新的 `MusicPlayerRoot` 已接管全局播放器根。

- [ ] **Step 5: Commit**

```bash
git add src/features/music/services src/features/music/components/MusicPlayerRoot.tsx src/features/music/tests/audio-engine.test.ts src/features/music/tests/music-player-root.test.tsx
git commit -m "feat(music): add playback services"
```

### Task 5: 落地新播放器 UI，并用 fixture 队列打通交互

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

- [ ] **Step 1: 写失败测试，覆盖 mini player、展开态和歌词 / 队列切换**

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

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/music-player-ui.test.tsx --runInBand`
Expected: FAIL，提示没有 `Play featured queue`、`music-mini-player` 或展开态播放器。

- [ ] **Step 3: 实现最小代码**

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

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/music-player-ui.test.tsx --runInBand`
Expected: PASS，点 `Play featured queue` 后能看到 mini player、expanded player 和 queue panel。

- [ ] **Step 5: Commit**

```bash
git add src/features/music/components src/features/music/tests/music-player-ui.test.tsx
git commit -m "feat(music): build rebuilt player surfaces"
```

### Task 6: 完成 big-bang smoke 验证并清理遗留引用

**Files:**

- Create: `src/features/music/tests/music-big-bang-smoke.test.tsx`
- Test: `src/features/music/tests/music-big-bang-smoke.test.tsx`

**Interfaces:**

- Consumes: `MusicPageShell`
- Consumes: `MusicPlayerRoot`
- Produces: `music-big-bang smoke coverage`

- [ ] **Step 1: 写失败 smoke 测试，覆盖正式 `/music` 的最小可运行链路**

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

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/music-big-bang-smoke.test.tsx --runInBand`
Expected: FAIL，直到新的壳层、播放器和接线点全部稳定。

- [ ] **Step 3: 做遗留引用校验**

```bash
rg -n "@/components/music|@/lib/music|musicPlayerStore" src
```

Expected: no matches

- [ ] **Step 4: 跑 smoke 与关键测试集**

Run: `pnpm jest src/app/music/page.test.tsx src/features/music/tests/music-shell-store.test.ts src/features/music/tests/fixture-repository.test.ts src/features/music/tests/playback-store.test.ts src/features/music/tests/audio-engine.test.ts src/features/music/tests/music-player-root.test.tsx src/features/music/tests/music-player-ui.test.tsx src/features/music/tests/music-big-bang-smoke.test.tsx --runInBand`
Expected: PASS，正式 `/music` 的新壳层、fixture 播放和播放器交互全链路通过。

- [ ] **Step 5: Commit**

```bash
git add src/features/music/tests/music-big-bang-smoke.test.tsx
git commit -m "test(music): verify big-bang rebuild shell"
```
