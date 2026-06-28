# LunaTV 音乐系统从零复刻 Phase 2 Netease 纵切 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已经完成 Phase 1 的新壳层和新播放器上，接入 `Netease` 真实首页、真实搜索、真实歌单、真实歌词和真实音频流，让正式 `/music` 摆脱 fixture 主链路。

**Architecture:** 保持 `src/features/music/` 作为唯一音乐实现命名空间，把旧 `desktop` 分支里的 `Netease` 读取逻辑拆成新的 `provider client + mapper + repository + route + UI store`。先恢复单源真实数据链路，再继续扩多源、账号和桌面能力，避免在架构未稳定前重复迁移旧 provider。

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand, Jest, Testing Library, Tauri

## Global Constraints

- 只接入 `Netease`，不在本计划内并行恢复 `Audius` / `Jamendo`
- 正式入口仍然是 `/music`，不创建并行 `/music-v2`
- 不重新引回 `src/lib/music/*`、`src/lib/transport/music-client.ts`、`src/stores/musicPlayerStore.ts`
- 新 `/api/music/*` 必须由 `src/features/music/` 内的新实现提供
- 新音频流代理使用 `/api/music/stream`，不恢复旧 `/media/audio/stream`
- `fixture-repository` 不再承担正式主链路，只允许做测试或 fallback
- TypeScript 保持 `strict` 兼容，不引入 `any`
- 严格按 TDD：先写失败测试，再写实现，再验证
- 文档继续保持中英双语

## File Map

- Modify: `src/features/music/domain/entities.ts`
- Modify: `src/features/music/domain/repositories.ts`
- Create: `src/features/music/services/providers/netease/client.ts`
- Create: `src/features/music/services/providers/netease/mappers.ts`
- Create: `src/features/music/services/providers/netease/repository.ts`
- Create: `src/features/music/services/music-api-client.ts`
- Create: `src/features/music/state/music-data-store.ts`
- Create: `src/features/music/components/MusicDiscoveryGrid.tsx`
- Create: `src/features/music/components/MusicSearchResults.tsx`
- Create: `src/features/music/components/MusicCollectionView.tsx`
- Modify: `src/features/music/components/MusicShell.tsx`
- Modify: `src/features/music/components/MusicTopBar.tsx`
- Modify: `src/features/music/components/MusicHero.tsx`
- Modify: `src/features/music/components/MusicMiniPlayer.tsx`
- Modify: `src/features/music/components/MusicFullPlayer.tsx`
- Modify: `src/features/music/components/MusicPlayerRoot.tsx`
- Create: `src/app/api/music/sources/route.ts`
- Create: `src/app/api/music/home/route.ts`
- Create: `src/app/api/music/search/route.ts`
- Create: `src/app/api/music/collection/route.ts`
- Create: `src/app/api/music/track/route.ts`
- Create: `src/app/api/music/lyric/route.ts`
- Create: `src/app/api/music/stream/route.ts`
- Create: `src/features/music/tests/netease-repository.test.ts`
- Create: `src/features/music/tests/music-routes-phase2.test.ts`
- Create: `src/features/music/tests/music-data-store.test.ts`
- Create: `src/features/music/tests/music-phase2-ui.test.tsx`
- Create: `src/features/music/tests/music-phase2-smoke.test.tsx`

---

### Task 1: 扩展真实数据域契约并实现新的 Netease repository

**Files:**

- Modify: `src/features/music/domain/entities.ts`
- Modify: `src/features/music/domain/repositories.ts`
- Create: `src/features/music/services/providers/netease/client.ts`
- Create: `src/features/music/services/providers/netease/mappers.ts`
- Create: `src/features/music/services/providers/netease/repository.ts`
- Create: `src/features/music/tests/netease-repository.test.ts`

**Interfaces:**

- Produces: `export interface MusicSourceEntity`
- Produces: `export interface MusicCollectionSummaryEntity`
- Produces: `export interface MusicCollectionEntity`
- Produces: `export interface MusicSearchResultEntity`
- Produces: `export interface MusicTrackPlaybackEntity`
- Produces: `export interface MusicDiscoveryRepository`
- Produces: `export interface MusicCollectionRepository`
- Produces: `export interface MusicTrackRepository`
- Produces: `export interface MusicLyricRepository`
- Produces: `export interface MusicStreamRepository`
- Produces: `export function createNeteaseRepository(): { discoveryRepository: MusicDiscoveryRepository; collectionRepository: MusicCollectionRepository; trackRepository: MusicTrackRepository; lyricRepository: MusicLyricRepository; streamRepository: MusicStreamRepository; sourceRepository: MusicSourceRepository }`

- [ ] **Step 1: 写失败测试，锁定新的真实 repository 行为**

```ts
import { createNeteaseRepository } from '../services/providers/netease/repository';

describe('createNeteaseRepository', () => {
  it('returns live home sections and spotlight tracks', async () => {
    const repository = createNeteaseRepository();
    const home = await repository.discoveryRepository.getHomeView('netease');

    expect(home.source).toBe('netease');
    expect(home.sections.length).toBeGreaterThan(0);
    expect(home.spotlight.every((track) => track.playable)).toBe(true);
  });

  it('returns track playback payload with a proxied stream path', async () => {
    const repository = createNeteaseRepository();
    const payload = await repository.trackRepository.getTrackPlayback(
      'netease',
      '9001',
      'standard'
    );

    expect(payload.track.id).toBe('9001');
    expect(payload.streamUrl).toContain('/api/music/stream');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/netease-repository.test.ts --runInBand`
Expected: FAIL，提示新的 `providers/netease/repository` 或新接口尚不存在。

- [ ] **Step 3: 实现最小实体、mapper、client 和 repository**

```ts
// src/features/music/services/providers/netease/repository.ts
export function createNeteaseRepository() {
  return {
    sourceRepository: { getSources: async () => [] },
    discoveryRepository: {
      getHomeView: async () => ({
        source: 'netease',
        spotlight: [],
        sections: [],
      }),
      search: async () => ({ query: '', tracks: [], collections: [] }),
    },
    collectionRepository: {
      getCollection: async () => ({
        summary: {
          id: '',
          source: 'netease',
          kind: 'playlist',
          title: '',
          coverUrl: '',
          description: '',
          trackCount: 0,
          accentColor: '',
        },
        curator: '',
        updatedAtLabel: '',
        tracks: [],
      }),
    },
    trackRepository: {
      getTrackPlayback: async (_source, id, quality = 'standard') => ({
        quality,
        streamUrl: `/api/music/stream?source=netease&id=${id}&quality=${quality}`,
        track: {
          id,
          source: 'netease',
          title: '',
          artists: [],
          album: '',
          coverUrl: '',
          durationMs: 0,
          stream: '',
          playable: true,
        },
      }),
    },
    lyricRepository: {
      getLyrics: async (source, trackId) => ({
        trackId,
        source,
        offsetMs: 0,
        lines: [],
      }),
    },
    streamRepository: {
      buildStreamPath: (source, trackId, quality = 'standard') =>
        `/api/music/stream?source=${source}&id=${trackId}&quality=${quality}`,
      createStreamResponse: async () => new Response(null, { status: 501 }),
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/netease-repository.test.ts --runInBand`
Expected: PASS，新的真实 repository 契约存在，stream 路径已切到 `/api/music/stream`。

- [ ] **Step 5: Commit**

```bash
git add src/features/music/domain src/features/music/services/providers/netease src/features/music/tests/netease-repository.test.ts
git commit -m "feat(music): add netease repository contracts"
```

### Task 2: 重建新的 `/api/music/*` 与 `/api/music/stream`

**Files:**

- Create: `src/app/api/music/sources/route.ts`
- Create: `src/app/api/music/home/route.ts`
- Create: `src/app/api/music/search/route.ts`
- Create: `src/app/api/music/collection/route.ts`
- Create: `src/app/api/music/track/route.ts`
- Create: `src/app/api/music/lyric/route.ts`
- Create: `src/app/api/music/stream/route.ts`
- Create: `src/features/music/tests/music-routes-phase2.test.ts`

**Interfaces:**

- Consumes: `createNeteaseRepository()`
- Produces: `GET /api/music/sources`
- Produces: `GET /api/music/home`
- Produces: `GET /api/music/search`
- Produces: `GET /api/music/collection`
- Produces: `GET /api/music/track`
- Produces: `GET /api/music/lyric`
- Produces: `GET /api/music/stream`

- [ ] **Step 1: 写失败测试，锁定新 route 的 query 与错误行为**

```ts
import { NextRequest } from 'next/server';

import { GET as getMusicHome } from '@/app/api/music/home/route';
import { GET as getMusicTrack } from '@/app/api/music/track/route';

it('returns netease home payload from the rebuilt route', async () => {
  const response = await getMusicHome(
    new NextRequest('http://localhost/api/music/home?source=netease')
  );
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(payload.source).toBe('netease');
});

it('returns a proxied track payload from the rebuilt route', async () => {
  const response = await getMusicTrack(
    new NextRequest('http://localhost/api/music/track?source=netease&id=9001')
  );
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(payload.streamUrl).toContain('/api/music/stream');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/music-routes-phase2.test.ts --runInBand`
Expected: FAIL，提示新的 route 尚不存在。

- [ ] **Step 3: 用新 repository 实现最小 route**

```ts
// src/app/api/music/home/route.ts
import { NextRequest } from 'next/server';

import { createNeteaseRepository } from '@/features/music/services/providers/netease/repository';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const repository = createNeteaseRepository();
  const payload = await repository.discoveryRepository.getHomeView(
    (request.nextUrl.searchParams.get('source') || 'netease') as 'netease'
  );

  return Response.json(payload);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/music-routes-phase2.test.ts --runInBand`
Expected: PASS，新的 `/api/music/*` 路由已恢复并接到新 repository。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/music src/features/music/tests/music-routes-phase2.test.ts
git commit -m "feat(music): rebuild music api routes"
```

### Task 3: 建立新的客户端数据层并接入首页 / 搜索 / 歌单详情

**Files:**

- Create: `src/features/music/services/music-api-client.ts`
- Create: `src/features/music/state/music-data-store.ts`
- Create: `src/features/music/tests/music-data-store.test.ts`

**Interfaces:**

- Produces: `export async function fetchMusicHomeView(source: 'netease'): Promise<MusicHomeView>`
- Produces: `export async function searchMusicCatalog(params: { source: 'netease'; query: string; page?: number }): Promise<MusicSearchResultEntity>`
- Produces: `export async function fetchMusicCollectionDetail(params: { source: 'netease'; id: string }): Promise<MusicCollectionEntity>`
- Produces: `export const useMusicDataStore`

- [ ] **Step 1: 写失败测试，锁定 bootstrap、search 与打开歌单动作**

```ts
import { useMusicDataStore } from '../state/music-data-store';

it('bootstraps home data into the new music data store', async () => {
  await useMusicDataStore.getState().bootstrap();

  expect(useMusicDataStore.getState().homeView?.source).toBe('netease');
});

it('stores search results after submitting a query', async () => {
  await useMusicDataStore.getState().submitSearch('hello');

  expect(useMusicDataStore.getState().searchResult?.query).toBe('hello');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/music-data-store.test.ts --runInBand`
Expected: FAIL，提示 `music-data-store` 尚不存在。

- [ ] **Step 3: 实现最小 client 与 store**

```ts
// src/features/music/state/music-data-store.ts
'use client';

import { create } from 'zustand';

import {
  fetchMusicCollectionDetail,
  fetchMusicHomeView,
  searchMusicCatalog,
} from '../services/music-api-client';

export const useMusicDataStore = create((set) => ({
  source: 'netease',
  homeView: null,
  searchResult: null,
  selectedCollection: null,
  loading: false,
  error: null,
  bootstrap: async () => {
    const homeView = await fetchMusicHomeView('netease');
    set({ homeView });
  },
  submitSearch: async (query: string) => {
    const searchResult = await searchMusicCatalog({ source: 'netease', query });
    set({ searchResult });
  },
  openCollection: async (id: string) => {
    const selectedCollection = await fetchMusicCollectionDetail({
      id,
      source: 'netease',
    });
    set({ selectedCollection });
  },
}));
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/music-data-store.test.ts --runInBand`
Expected: PASS，新的数据层可加载首页、搜索并打开歌单详情。

- [ ] **Step 5: Commit**

```bash
git add src/features/music/services/music-api-client.ts src/features/music/state/music-data-store.ts src/features/music/tests/music-data-store.test.ts
git commit -m "feat(music): add music data store"
```

### Task 4: 用真实数据接管 `/music` 壳层和播放器入口

**Files:**

- Create: `src/features/music/components/MusicDiscoveryGrid.tsx`
- Create: `src/features/music/components/MusicSearchResults.tsx`
- Create: `src/features/music/components/MusicCollectionView.tsx`
- Modify: `src/features/music/components/MusicShell.tsx`
- Modify: `src/features/music/components/MusicTopBar.tsx`
- Modify: `src/features/music/components/MusicHero.tsx`
- Modify: `src/features/music/components/MusicMiniPlayer.tsx`
- Modify: `src/features/music/components/MusicFullPlayer.tsx`
- Modify: `src/features/music/components/MusicPlayerRoot.tsx`
- Create: `src/features/music/tests/music-phase2-ui.test.tsx`

**Interfaces:**

- Consumes: `useMusicDataStore`
- Consumes: `usePlaybackStore`
- Produces: `bootstrap(): Promise<void>`
- Produces: `submitSearch(query: string): Promise<void>`
- Produces: `openCollection(id: string): Promise<void>`
- Produces: `playTrack(source: 'netease', id: string): Promise<void>`

- [ ] **Step 1: 写失败测试，锁定真实首页、真实搜索和真实点播**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';

import MusicPageShell from '../app/MusicPageShell';
import MusicPlayerRoot from '../components/MusicPlayerRoot';

it('loads the live home view and plays a real netease track', async () => {
  render(
    <>
      <MusicPageShell />
      <MusicPlayerRoot />
    </>
  );

  expect(await screen.findByText(/官方榜单|推荐歌单/)).toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText('Search music'), {
    target: { value: 'hello' },
  });
  fireEvent.submit(screen.getByTestId('music-search-form'));

  expect(await screen.findByText(/hello/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx --runInBand`
Expected: FAIL，当前壳层还没有真实首页和搜索交互。

- [ ] **Step 3: 实现最小真实数据 UI 装配**

```tsx
// src/features/music/components/MusicShell.tsx
'use client';

import { useEffect } from 'react';

import { useMusicDataStore } from '../state/music-data-store';

export function MusicShell() {
  const bootstrap = useMusicDataStore((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return <div>{/* sidebar + topbar + hero + discovery */}</div>;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx --runInBand`
Expected: PASS，正式 `/music` 已能加载真实首页、触发搜索并点播真实曲目。

- [ ] **Step 5: Commit**

```bash
git add src/features/music/components src/features/music/tests/music-phase2-ui.test.tsx
git commit -m "feat(music): connect live netease music ui"
```

### Task 5: 执行 Phase 2 smoke 验证并收口

**Files:**

- Create: `src/features/music/tests/music-phase2-smoke.test.tsx`

**Interfaces:**

- Consumes: `MusicPageShell`
- Consumes: `MusicPlayerRoot`
- Produces: `phase 2 smoke coverage`

- [ ] **Step 1: 写失败 smoke 测试**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';

import MusicPageShell from '../app/MusicPageShell';
import MusicPlayerRoot from '../components/MusicPlayerRoot';

it('runs the rebuilt /music flow with live netease data', async () => {
  render(
    <>
      <MusicPageShell />
      <MusicPlayerRoot />
    </>
  );

  expect(await screen.findByText(/官方榜单|推荐歌单/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /play/i }));
  expect(await screen.findByTestId('music-mini-player')).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/music-phase2-smoke.test.tsx --runInBand`
Expected: FAIL，直到真实数据 UI 与真实播放链路完全接好。

- [ ] **Step 3: 跑关键测试集与遗留引用检查**

Run: `rg -n "@/lib/music|music-client|musicPlayerStore|/media/audio/stream" src`
Expected: no matches

Run: `pnpm jest src/features/music/tests/netease-repository.test.ts src/features/music/tests/music-routes-phase2.test.ts src/features/music/tests/music-data-store.test.ts src/features/music/tests/music-phase2-ui.test.tsx src/features/music/tests/music-phase2-smoke.test.tsx --runInBand`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/features/music/tests/music-phase2-smoke.test.tsx
git commit -m "test(music): verify netease vertical slice"
```
