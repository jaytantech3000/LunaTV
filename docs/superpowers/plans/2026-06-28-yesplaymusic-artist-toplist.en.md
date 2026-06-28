# YesPlayMusic Artist Toplist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an artist vertical slice to the rebuilt `/music` experience so search results can open an artist page and render top songs plus hot albums inside the existing collection/player architecture.

**Architecture:** Reuse the current `search -> collection -> player` flow instead of creating a separate artist page stack. Extend the Netease provider with artist search and artist-toplist detail, then let `MusicSearchResults`, `MusicCollectionView`, and the existing `playTrack` action consume the normalized result. (`normalized` = 统一归一化后的)

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Zustand, Jest, Testing Library

## Global Constraints

- Stay inside the current `React + Next.js + Tauri` rewrite and do not reconnect the deleted legacy music system.
- Default to ASCII, do not introduce `any`, and follow the current store / route / provider patterns.
- Write the failing test first, then the minimal implementation, then run targeted tests and full music regression.
- Reuse the existing `collection` path with the `artist-toplist` kind instead of adding a dedicated artist route.

---

### Task 1: Extend artist search and provider detail models

**Files:**

- Modify: `src/features/music/domain/entities.ts`
- Modify: `src/features/music/services/providers/netease/client.ts`
- Modify: `src/features/music/services/providers/netease/mappers.ts`
- Modify: `src/features/music/services/providers/netease/repository.ts`
- Test: `src/features/music/tests/netease-repository.test.ts`

**Interfaces:**

- Consumes: `MusicCollectionEntity`, `MusicCollectionSummaryEntity`, `MusicSearchResultEntity`
- Produces:

  - `MusicCollectionEntity.relatedCollections?: MusicCollectionSummaryEntity[]`
  - `fetchSearchArtists(query: string, page: number)`
  - `fetchArtistTopSongs(artistId: string)`
  - `fetchArtistAlbums(artistId: string, page?: number)`
  - `collectionRepository.getCollection(source, id, 'artist-toplist')`

- [ ] **Step 1: Write the failing test**
- [ ] Add to `src/features/music/tests/netease-repository.test.ts`:

```ts
it('returns artist hits in live search results', async () => {
  const { createNeteaseRepository } = await importNeteaseRepository();
  const repository = createNeteaseRepository();
  const result = await repository.discoveryRepository.search('netease', 'jay');

  expect(result.collections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: '6452',
        kind: 'artist-toplist',
        title: '周杰伦',
      }),
    ])
  );
});

it('returns artist toplist collections with top tracks and related albums', async () => {
  const { createNeteaseRepository } = await importNeteaseRepository();
  const repository = createNeteaseRepository();
  const collection = await repository.collectionRepository.getCollection(
    'netease',
    '6452',
    'artist-toplist'
  );

  expect(collection.summary).toEqual(
    expect.objectContaining({
      id: '6452',
      kind: 'artist-toplist',
      title: '周杰伦',
    })
  );
  expect(collection.tracks[0]).toEqual(
    expect.objectContaining({
      title: '布拉格广场',
    })
  );
  expect(collection.relatedCollections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'album',
        title: '即兴曲',
      }),
    ])
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm jest src/features/music/tests/netease-repository.test.ts --runInBand`

Expected: FAIL because artist search and artist-toplist detail are not implemented yet.

- [ ] **Step 3: Write minimal implementation**
- [ ] Add to `entities.ts`:

```ts
relatedCollections?: MusicCollectionSummaryEntity[];
```

- [ ] Add artist payloads and three fetchers to `client.ts`.
- [ ] Add artist summary and artist-toplist collection mappers to `mappers.ts`.
- [ ] In `repository.ts`:

  - fetch `type=100` alongside current search sources
  - merge artist summaries into `collections`
  - when `kind === 'artist-toplist'`, return top songs plus hot albums

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm jest src/features/music/tests/netease-repository.test.ts --runInBand`

Expected: PASS

### Task 2: Add route and API mock support for artist flows

**Files:**

- Modify: `src/features/music/tests/music-routes-phase2.test.ts`
- Modify: `src/features/music/tests/live-music-test-utils.ts`
- Test: `src/features/music/tests/music-routes-phase2.test.ts`

**Interfaces:**

- Consumes: `collectionRepository.getCollection(..., 'artist-toplist')`, `discoveryRepository.search(...)`
- Produces:

  - `/api/music/search` returns `artist-toplist` collections
  - `/api/music/collection?kind=artist-toplist` returns artist detail
  - UI integration mocks can open an artist page

- [ ] **Step 1: Write the failing test**
- [ ] Add to `music-routes-phase2.test.ts`:

```ts
expect(searchPayload.collections).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      id: '6452',
      kind: 'artist-toplist',
      title: '周杰伦',
    }),
  ])
);

expect(collectionPayload.summary.kind).toBe('artist-toplist');
expect(collectionPayload.relatedCollections).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      kind: 'album',
      title: '即兴曲',
    }),
  ])
);
```

- [ ] Extend `live-music-test-utils.ts` with artist search and artist collection responses.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm jest src/features/music/tests/music-routes-phase2.test.ts --runInBand`

Expected: FAIL because the route mocks do not understand `artist-toplist` yet.

- [ ] **Step 3: Write minimal implementation**
- [ ] Add to the route test fetch mocks:

  - search artist `type=100`
  - artist collection detail
  - artist top-song `tracks`
  - artist hot-album `relatedCollections`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm jest src/features/music/tests/music-routes-phase2.test.ts --runInBand`

Expected: PASS

### Task 3: Render artist search results and artist detail UI

**Files:**

- Modify: `src/features/music/components/MusicSearchResults.tsx`
- Modify: `src/features/music/components/MusicCollectionView.tsx`
- Modify: `src/features/music/tests/music-phase2-ui.test.tsx`
- Test: `src/features/music/tests/music-phase2-ui.test.tsx`

**Interfaces:**

- Consumes: `MusicCollectionEntity.relatedCollections`, artist collection summaries from search
- Produces:

  - search results show artist cards
  - clicking an artist card opens an artist-toplist detail surface
  - artist detail renders top songs and hot albums

- [ ] **Step 1: Write the failing test**
- [ ] Add to `music-phase2-ui.test.tsx`:

```ts
it('opens an artist toplist from search and renders hot songs with hot albums', async () => {
  render(
    <>
      <MusicPageShell />
      <MusicPlayerRoot />
    </>
  );

  await screen.findByRole('button', { name: 'Open collection 官方榜单' });
  fireEvent.change(screen.getByPlaceholderText('Search music'), {
    target: { value: 'jay' },
  });
  fireEvent.submit(screen.getByTestId('music-search-form'));

  expect(
    await screen.findByRole('button', {
      name: 'Open search collection 周杰伦',
    })
  ).toBeInTheDocument();

  fireEvent.click(
    screen.getByRole('button', { name: 'Open search collection 周杰伦' })
  );

  expect(
    await screen.findByRole('heading', { name: '周杰伦' })
  ).toBeInTheDocument();
  expect(screen.getByText('热门专辑')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Play collection track 布拉格广场' })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Open related collection 即兴曲' })
  ).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx --runInBand`

Expected: FAIL because artist search results and artist detail UI are not rendered yet.

- [ ] **Step 3: Write minimal implementation**
- [ ] Keep `MusicSearchResults.tsx` generic so artist summaries reuse the existing collection card path.
- [ ] Update `MusicCollectionView.tsx`:

  - use artist-focused copy when `collection.summary.kind === 'artist-toplist'`
  - add a `Hot albums` section
  - render `relatedCollections` as clickable cards

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx --runInBand`

Expected: PASS

### Task 4: Regression verification

**Files:**

- Test only

**Interfaces:**

- Consumes: complete implementation from Tasks 1-3
- Produces: artist vertical slice passes targeted and full music regression

- [ ] **Step 1: Run targeted artist tests**

Run:

```bash
pnpm jest \
  src/features/music/tests/netease-repository.test.ts \
  src/features/music/tests/music-routes-phase2.test.ts \
  src/features/music/tests/music-phase2-ui.test.tsx \
  --runInBand
```

Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS

- [ ] **Step 3: Run full music regression**

Run: `pnpm jest src/features/music/tests src/app/music/page.test.tsx --runInBand`

Expected: PASS, with the existing `act(...)` warnings still tolerated because they are pre-existing test noise rather than new failures.
