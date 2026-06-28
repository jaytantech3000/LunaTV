# LunaTV Music System Rebuild Phase 2 Netease Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixture-driven primary flow on `/music` with a live `Netease`-backed data path for home discovery, search, playlist detail, lyric loading, and stream playback.

**Architecture:** Keep `src/features/music/` as the only implementation namespace and split the old monolith (单体实现) into a new provider client, mapper, repository, route, and UI data store chain. Prove the architecture with one live provider first, then expand to more providers and account features later.

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand, Jest, Testing Library, Tauri

## Global Constraints

- Only integrate `Netease` in this plan
- Keep `/music` as the live route; do not create `/music-v2`
- Do not reintroduce old `src/lib/music/*`, `src/lib/transport/music-client.ts`, or `src/stores/musicPlayerStore.ts`
- Rebuilt `/api/music/*` must be powered by code under `src/features/music/`
- Stream proxying must move to `/api/music/stream`, not back to `/media/audio/stream`
- `fixture-repository` may remain only for tests or fallback, not the default runtime path
- Preserve TypeScript `strict` compatibility and avoid `any`
- Follow TDD strictly
- Keep documentation bilingual

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

### Task 1: Extend the live-data domain and build the new Netease repository

**Files:**

- Modify: `src/features/music/domain/entities.ts`
- Modify: `src/features/music/domain/repositories.ts`
- Create: `src/features/music/services/providers/netease/client.ts`
- Create: `src/features/music/services/providers/netease/mappers.ts`
- Create: `src/features/music/services/providers/netease/repository.ts`
- Create: `src/features/music/tests/netease-repository.test.ts`

**Interfaces:**

- Produces: `MusicSourceEntity`
- Produces: `MusicCollectionSummaryEntity`
- Produces: `MusicCollectionEntity`
- Produces: `MusicSearchResultEntity`
- Produces: `MusicTrackPlaybackEntity`
- Produces: `MusicDiscoveryRepository`
- Produces: `MusicCollectionRepository`
- Produces: `MusicTrackRepository`
- Produces: `MusicLyricRepository`
- Produces: `MusicStreamRepository`
- Produces: `createNeteaseRepository()`

- [ ] **Step 1: Write the failing repository tests**

```ts
import { createNeteaseRepository } from '../services/providers/netease/repository';

describe('createNeteaseRepository', () => {
  it('returns live home sections and playable spotlight tracks', async () => {
    const repository = createNeteaseRepository();
    const home = await repository.discoveryRepository.getHomeView('netease');

    expect(home.source).toBe('netease');
    expect(home.sections.length).toBeGreaterThan(0);
    expect(home.spotlight.every((track) => track.playable)).toBe(true);
  });

  it('returns a proxied stream path for track playback', async () => {
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

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm jest src/features/music/tests/netease-repository.test.ts --runInBand`  
Expected: FAIL because the new `providers/netease/repository` does not exist yet.

- [ ] **Step 3: Implement the minimal live repository stack**

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

- [ ] **Step 4: Run the test to verify success**

Run: `pnpm jest src/features/music/tests/netease-repository.test.ts --runInBand`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/music/domain src/features/music/services/providers/netease src/features/music/tests/netease-repository.test.ts
git commit -m "feat(music): add netease repository contracts"
```

### Task 2: Rebuild `/api/music/*` and `/api/music/stream`

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

- [ ] **Step 1: Write the failing route tests**

```ts
import { NextRequest } from 'next/server';

import { GET as getMusicHome } from '@/app/api/music/home/route';
import { GET as getMusicTrack } from '@/app/api/music/track/route';

it('returns a live home payload from the rebuilt route', async () => {
  const response = await getMusicHome(
    new NextRequest('http://localhost/api/music/home?source=netease')
  );
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(payload.source).toBe('netease');
});

it('returns a proxied playback payload from the rebuilt track route', async () => {
  const response = await getMusicTrack(
    new NextRequest('http://localhost/api/music/track?source=netease&id=9001')
  );
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(payload.streamUrl).toContain('/api/music/stream');
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm jest src/features/music/tests/music-routes-phase2.test.ts --runInBand`  
Expected: FAIL because the new routes do not exist yet.

- [ ] **Step 3: Implement minimal route handlers**

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

- [ ] **Step 4: Run the test to verify success**

Run: `pnpm jest src/features/music/tests/music-routes-phase2.test.ts --runInBand`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/music src/features/music/tests/music-routes-phase2.test.ts
git commit -m "feat(music): rebuild music api routes"
```

### Task 3: Build the client data layer for home, search, and collection detail

**Files:**

- Create: `src/features/music/services/music-api-client.ts`
- Create: `src/features/music/state/music-data-store.ts`
- Create: `src/features/music/tests/music-data-store.test.ts`

**Interfaces:**

- Produces: `fetchMusicHomeView(source: 'netease')`
- Produces: `searchMusicCatalog({ source: 'netease', query: string, page?: number })`
- Produces: `fetchMusicCollectionDetail({ source: 'netease', id: string })`
- Produces: `useMusicDataStore`

- [ ] **Step 1: Write the failing store tests**

```ts
import { useMusicDataStore } from '../state/music-data-store';

it('bootstraps home data into the new store', async () => {
  await useMusicDataStore.getState().bootstrap();

  expect(useMusicDataStore.getState().homeView?.source).toBe('netease');
});

it('stores search results after submitting a query', async () => {
  await useMusicDataStore.getState().submitSearch('hello');

  expect(useMusicDataStore.getState().searchResult?.query).toBe('hello');
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm jest src/features/music/tests/music-data-store.test.ts --runInBand`  
Expected: FAIL because `music-data-store` does not exist yet.

- [ ] **Step 3: Implement the minimal API client and store**

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

- [ ] **Step 4: Run the test to verify success**

Run: `pnpm jest src/features/music/tests/music-data-store.test.ts --runInBand`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/music/services/music-api-client.ts src/features/music/state/music-data-store.ts src/features/music/tests/music-data-store.test.ts
git commit -m "feat(music): add music data store"
```

### Task 4: Replace fixture-driven `/music` UI flows with live Netease data

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

- [ ] **Step 1: Write the failing UI test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';

import MusicPageShell from '../app/MusicPageShell';
import MusicPlayerRoot from '../components/MusicPlayerRoot';

it('loads live home data and submits a live search', async () => {
  render(
    <>
      <MusicPageShell />
      <MusicPlayerRoot />
    </>
  );

  expect(
    await screen.findByText(
      /Official Charts|Recommended Playlists|官方榜单|推荐歌单/
    )
  ).toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText('Search music'), {
    target: { value: 'hello' },
  });
  fireEvent.submit(screen.getByTestId('music-search-form'));

  expect(await screen.findByText(/hello/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx --runInBand`  
Expected: FAIL because the shell still renders fixture-only content.

- [ ] **Step 3: Implement the minimal live-data UI wiring**

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

- [ ] **Step 4: Run the test to verify success**

Run: `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx --runInBand`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/music/components src/features/music/tests/music-phase2-ui.test.tsx
git commit -m "feat(music): connect live netease music ui"
```

### Task 5: Run the Phase 2 smoke gate

**Files:**

- Create: `src/features/music/tests/music-phase2-smoke.test.tsx`

**Interfaces:**

- Consumes: `MusicPageShell`
- Consumes: `MusicPlayerRoot`
- Produces: `phase 2 smoke coverage`

- [ ] **Step 1: Write the failing smoke test**

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

  expect(
    await screen.findByText(
      /Official Charts|Recommended Playlists|官方榜单|推荐歌单/
    )
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /play/i }));
  expect(await screen.findByTestId('music-mini-player')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the smoke test to verify failure**

Run: `pnpm jest src/features/music/tests/music-phase2-smoke.test.tsx --runInBand`  
Expected: FAIL until the live data path is fully wired.

- [ ] **Step 3: Run the regression gate**

Run: `rg -n "@/lib/music|music-client|musicPlayerStore|/media/audio/stream" src`  
Expected: no matches

Run: `pnpm jest src/features/music/tests/netease-repository.test.ts src/features/music/tests/music-routes-phase2.test.ts src/features/music/tests/music-data-store.test.ts src/features/music/tests/music-phase2-ui.test.tsx src/features/music/tests/music-phase2-smoke.test.tsx --runInBand`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/features/music/tests/music-phase2-smoke.test.tsx
git commit -m "test(music): verify netease vertical slice"
```
