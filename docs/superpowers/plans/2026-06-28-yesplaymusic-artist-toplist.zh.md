# YesPlayMusic Artist Toplist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在新的 `/music` 重写线里补齐艺人搜索与艺人详情纵切，让搜索结果可以打开艺人页，并在同一套 collection/player 架构内显示热门歌曲与热门专辑。

**Architecture:** 复用现有 `search -> collection -> player` 链路，不新开独立 artist 页面栈。Netease provider 补 artist 搜索与 artist-toplist 详情，前端继续通过 `MusicSearchResults`、`MusicCollectionView` 和现有 `playTrack` action 驱动。

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Zustand, Jest, Testing Library

## Global Constraints

- 只在当前 `React + Next.js + Tauri` 重写线上补能力，不回接旧音乐系统。
- 默认 ASCII，禁止引入 `any`，保持现有 store / route / provider 模式。
- 先写失败测试，再写最小实现，再跑定向测试与完整音乐回归。
- 复用现有 `collection` 路径与 `artist-toplist` kind，不新增独立 artist route。

---

### Task 1: 扩展 artist 搜索与 provider 详情模型

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

- [ ] **Step 1: 写失败测试**
- [ ] 在 `src/features/music/tests/netease-repository.test.ts` 增加：

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

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/netease-repository.test.ts --runInBand`

Expected: FAIL，因为 artist 搜索与 artist-toplist 详情尚未实现。

- [ ] **Step 3: 写最小实现**
- [ ] 在 `entities.ts` 给 `MusicCollectionEntity` 增加：

```ts
relatedCollections?: MusicCollectionSummaryEntity[];
```

- [ ] 在 `client.ts` 增加 artist payload 与 3 个 fetcher。
- [ ] 在 `mappers.ts` 增加 artist summary 与 artist-toplist collection mapper。
- [ ] 在 `repository.ts`：

  - 搜索时并行拉 `type=100`
  - `collections` 合并 artist summary
  - `kind === 'artist-toplist'` 时返回 artist 热门歌 + 热门专辑

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/netease-repository.test.ts --runInBand`

Expected: PASS

### Task 2: 补齐 route 与 API mock 对 artist 的支持

**Files:**

- Modify: `src/features/music/tests/music-routes-phase2.test.ts`
- Modify: `src/features/music/tests/live-music-test-utils.ts`
- Test: `src/features/music/tests/music-routes-phase2.test.ts`

**Interfaces:**

- Consumes: `collectionRepository.getCollection(..., 'artist-toplist')`, `discoveryRepository.search(...)`
- Produces:

  - `/api/music/search` 返回 `artist-toplist` collection
  - `/api/music/collection?kind=artist-toplist` 返回艺人详情
  - UI integration mock 可打开艺人页

- [ ] **Step 1: 写失败测试**
- [ ] 在 `music-routes-phase2.test.ts` 补两个断言：

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

- [ ] 在 `live-music-test-utils.ts` 的 mock 搜索与 mock collection 里加入 artist 返回。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/music-routes-phase2.test.ts --runInBand`

Expected: FAIL，因为 route mock 还不认识 `artist-toplist`。

- [ ] **Step 3: 写最小实现**
- [ ] 在 route 相关 mock 中加入：

  - 搜索 artist `type=100`
  - artist collection detail
  - artist 热门歌 `tracks`
  - artist 热门专辑 `relatedCollections`

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/music-routes-phase2.test.ts --runInBand`

Expected: PASS

### Task 3: 渲染 artist 搜索结果与 artist 详情 UI

**Files:**

- Modify: `src/features/music/components/MusicSearchResults.tsx`
- Modify: `src/features/music/components/MusicCollectionView.tsx`
- Modify: `src/features/music/tests/music-phase2-ui.test.tsx`
- Test: `src/features/music/tests/music-phase2-ui.test.tsx`

**Interfaces:**

- Consumes: `MusicCollectionEntity.relatedCollections`, search artist collection summary
- Produces:

  - 搜索结果可见 artist card
  - 点击 artist card 可进入 artist-toplist 详情
  - artist 详情可见热门歌曲和热门专辑

- [ ] **Step 1: 写失败测试**
- [ ] 在 `music-phase2-ui.test.tsx` 增加：

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

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx --runInBand`

Expected: FAIL，因为 artist 搜索结果与 artist 详情 UI 尚未渲染。

- [ ] **Step 3: 写最小实现**
- [ ] `MusicSearchResults.tsx` 不特殊分支，只让 artist summary 也复用 collection card。
- [ ] `MusicCollectionView.tsx`：

  - `artist-toplist` 标题区改成 artist 文案
  - 新增 “热门专辑” section
  - `relatedCollections` 渲染为可点击 card

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx --runInBand`

Expected: PASS

### Task 4: 回归验证

**Files:**

- Test only

**Interfaces:**

- Consumes: Task 1-3 完整实现
- Produces: artist 纵切通过定向与完整音乐回归

- [ ] **Step 1: 跑 artist 定向测试**

Run:

```bash
pnpm jest \
  src/features/music/tests/netease-repository.test.ts \
  src/features/music/tests/music-routes-phase2.test.ts \
  src/features/music/tests/music-phase2-ui.test.tsx \
  --runInBand
```

Expected: PASS

- [ ] **Step 2: 跑类型检查**

Run: `pnpm typecheck`

Expected: PASS

- [ ] **Step 3: 跑完整音乐回归**

Run: `pnpm jest src/features/music/tests src/app/music/page.test.tsx --runInBand`

Expected: PASS（允许保留现有已知 `act(...)` warning，不算失败）
