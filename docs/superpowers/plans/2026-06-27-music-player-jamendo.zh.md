# LunaTV 音乐播放器与 Jamendo 降级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成歌单播放 icon 直播、Jamendo suspended 降级，以及网易云风格播放器重构，并验证、提交、推送 beta 代码。

**Architecture:** 保留 `musicPlayerStore` 与 `MusicPlayerRoot` 的既有播放核心，只在页面调度层补上“歌单摘要直播”链路，在 provider/service 层增加 Jamendo 可用性熔断与降级，再分别重构 `MusicMiniPlayer` 和 `MusicFullscreenPlayer` 的视图结构。实现按 TDD 分三段推进：播放链路、Jamendo 降级、播放器 UI，并在最后做集成验证和 beta 提交。

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand, Jest, Testing Library, Git

## Global Constraints

- 点击歌单卡片右上角播放 icon 时，直接拉取该歌单详情并整组播放
- 点击歌单卡片主体时，仍然进入歌单详情页，不改变原有浏览路径
- Jamendo 上游返回 suspended application 错误时，来源自动降级，不再把英文原始报错直接显示到页面
- 重构底部 mini player，使布局、控件分区、视觉层级贴近参考图
- 重构 expanded player，使其与底部控制条使用同一套视觉语言与控件语义
- 不重写 `musicPlayerStore`
- 不替换 `MusicPlayerRoot` 内现有 `audio` 播放链路
- 不新增新的音乐来源或新的播放模式
- 文档使用中英双语版本

---

### Task 1: 歌单播放 icon 直播链路

**Files:**

- Modify: `src/components/music/MusicCollectionGrid.tsx`
- Modify: `src/components/music/MusicPageClient.tsx`
- Modify: `src/components/music/MusicPageClient.test.tsx`

**Interfaces:**

- Consumes: `fetchMusicCollection(params: { source: MusicPlatformKey; id: string }): Promise<MusicCollection>`
- Consumes: `playQueue(queue: PlayerQueueItem[], startIndex?: number): void`
- Produces: `onPlayCollection(collection: MusicCollectionSummary): void`

- [ ] **Step 1: 写失败测试，证明播放 icon 不再走详情跳转**

```tsx
it('plays a collection immediately when the play icon is clicked', async () => {
  render(<MusicPageClient />);

  const playButton = await screen.findByRole('button', {
    name: '直接播放 城市夜航榜',
  });
  fireEvent.click(playButton);

  await waitFor(() => {
    expect(mockFetchMusicCollection).toHaveBeenCalledWith({
      source: 'netease',
      id: 'netease-rank-city',
    });
  });

  const state = useMusicPlayerStore.getState();
  expect(state.queue[0]).toEqual(
    expect.objectContaining({
      trackId: 'playlist-track-1',
      source: 'netease',
    })
  );
  expect(mockReplace).not.toHaveBeenCalledWith(
    '/music?source=netease&tab=rank&id=netease-rank-city',
    expect.anything()
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/components/music/MusicPageClient.test.tsx --runInBand`
Expected: FAIL，提示找不到独立播放按钮或点击后仍然只更新 URL。

- [ ] **Step 3: 实现最小代码**

```tsx
// src/components/music/MusicCollectionGrid.tsx
interface MusicCollectionGridProps {
  title: string;
  description?: string;
  collections: MusicCollectionSummary[];
  activeCollectionId?: string | null;
  onSelect: (collection: MusicCollectionSummary) => void;
  onPlayCollection?: (collection: MusicCollectionSummary) => void;
}

// 播放按钮
<button
  type='button'
  aria-label={`直接播放 ${collection.title}`}
  onClick={(event) => {
    event.stopPropagation();
    onPlayCollection?.(collection);
  }}
>
  <Play className='h-4 w-4 fill-current' />
</button>;
```

```tsx
// src/components/music/MusicPageClient.tsx
const handlePlayCollection = async (collection: MusicCollectionSummary) => {
  const detail = await fetchMusicCollection({
    source: collection.source,
    id: collection.id,
  });
  const playableTracks = detail.tracks.filter((track) => track.playable);

  if (!playableTracks.length) {
    setContentError('当前歌单暂无可播放曲目');
    return;
  }

  playQueue(playableTracks.map(buildQueueItemFromTrack), 0);
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/components/music/MusicPageClient.test.tsx --runInBand`
Expected: PASS，新增用例通过，原有“点击卡片主体进入详情”用例保持通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/music/MusicCollectionGrid.tsx src/components/music/MusicPageClient.tsx src/components/music/MusicPageClient.test.tsx
git commit -m "feat(music): play collections from card controls"
```

### Task 2: Jamendo suspended 自动降级

**Files:**

- Modify: `src/lib/music/jamendo.ts`
- Modify: `src/lib/music/service.ts`
- Modify: `src/app/api/music/routes.test.ts`
- Modify: `src/components/music/MusicPageClient.tsx`
- Modify: `src/components/music/MusicPageClient.test.tsx`

**Interfaces:**

- Consumes: `MusicApiError`
- Produces: `getJamendoSource(): MusicSource`
- Produces: `markJamendoUnavailable(reason: string): void`
- Produces: `isJamendoTemporarilyUnavailable(): boolean`

- [ ] **Step 1: 写失败测试，覆盖 suspended 响应后来源降级**

```ts
it('disables jamendo after a suspended application response', async () => {
  process.env.JAMENDO_CLIENT_ID = 'jamendo-test-client';
  global.fetch = createMusicFetchMock({ jamendoSuspended: true });

  const homeResponse = await getMusicHome(
    new NextRequest('http://localhost/api/music/home?source=jamendo')
  );
  expect(homeResponse.status).toBe(503);

  const sourcesResponse = await getMusicSources();
  const payload = await sourcesResponse.json();
  expect(
    payload.sources.find((source: { key: string }) => source.key === 'jamendo')
  ).toEqual(expect.objectContaining({ enabled: false }));
});
```

```tsx
it('falls back to the first available source when jamendo is disabled', async () => {
  mockSearchParams = 'source=jamendo&tab=home';
  mockSources[2] = { ...mockSources[2], enabled: false };

  render(<MusicPageClient />);

  await waitFor(() => {
    expect(mockReplace).toHaveBeenCalledWith('/music?source=netease&tab=home', {
      scroll: false,
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/app/api/music/routes.test.ts src/components/music/MusicPageClient.test.tsx --runInBand`
Expected: FAIL，Jamendo 仍返回 enabled，页面不会自动切回可用来源。

- [ ] **Step 3: 实现最小代码**

```ts
// src/lib/music/jamendo.ts
const JAMENDO_SUSPENDED_TTL_MS = 5 * 60 * 1000;
let jamendoSuspendedUntil = 0;

function markJamendoUnavailable() {
  jamendoSuspendedUntil = Date.now() + JAMENDO_SUSPENDED_TTL_MS;
}

function isJamendoTemporarilyUnavailable() {
  return jamendoSuspendedUntil > Date.now();
}

function isJamendoSuspendedMessage(message: string) {
  return /suspended application/i.test(message);
}
```

```ts
// fetchJamendoJson catch path
if (
  error instanceof MusicApiError &&
  isJamendoSuspendedMessage(error.message)
) {
  markJamendoUnavailable();
  throw new MusicApiError('Jamendo 官方接口当前不可用', 503);
}
```

```ts
// getJamendoSource
const enabled = isJamendoConfigured() && !isJamendoTemporarilyUnavailable();
```

```tsx
// src/components/music/MusicPageClient.tsx
useEffect(() => {
  if (!sources.length || !activeSource) {
    return;
  }

  if (activeSourceModel?.enabled !== false) {
    return;
  }

  const fallbackSource = sources.find((source) => source.enabled);
  if (!fallbackSource) {
    return;
  }

  updateUrl((params) => {
    params.set('source', fallbackSource.key);
    params.set('tab', fallbackSource.tabs[0]);
    params.delete('id');
    params.delete('q');
  });
  setContentError('Jamendo 官方接口当前不可用，已自动切换到其他平台');
}, [activeSource, activeSourceModel, sources]);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/app/api/music/routes.test.ts src/components/music/MusicPageClient.test.tsx --runInBand`
Expected: PASS，Jamendo suspended 返回 503，来源接口给出 disabled，页面自动切换来源。

- [ ] **Step 5: Commit**

```bash
git add src/lib/music/jamendo.ts src/lib/music/service.ts src/app/api/music/routes.test.ts src/components/music/MusicPageClient.tsx src/components/music/MusicPageClient.test.tsx
git commit -m "fix(music): degrade jamendo suspended source"
```

### Task 3: 网易云风格播放器重构

**Files:**

- Modify: `src/components/music/MusicMiniPlayer.tsx`
- Modify: `src/components/music/MusicFullscreenPlayer.tsx`
- Modify: `src/components/music/MusicQueuePanel.tsx`
- Modify: `src/components/music/MusicLyricsPanel.tsx`
- Modify: `src/components/music/MusicPlayerRoot.test.tsx`

**Interfaces:**

- Consumes: `MusicMiniPlayerProps`
- Consumes: `MusicFullscreenPlayerProps`
- Produces: 与现有 props 兼容的新布局，不新增 store 字段

- [ ] **Step 1: 写失败测试，锁定关键交互不回归**

```tsx
it('expands and minimizes the redesigned player without losing controls', async () => {
  primeMusicPlayerStore({ presentation: 'mini' });
  mountExpandedSlot();

  render(<MusicPlayerRoot />);

  fireEvent.click(await screen.findByText('mini-expand'));
  expect(await screen.findByTestId('expanded-player')).toBeInTheDocument();

  fireEvent.click(screen.getByText('minimize-player'));
  await waitFor(() => {
    expect(screen.queryByTestId('expanded-player')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/components/music/MusicPlayerRoot.test.tsx --runInBand`
Expected: FAIL，如果重构引入了新的控件语义或移除了现有触发器，测试会先暴露差异。

- [ ] **Step 3: 实现最小代码**

```tsx
// src/components/music/MusicMiniPlayer.tsx
<div className='overflow-hidden rounded-[36px] border border-emerald-400/25 bg-[linear-gradient(90deg,#0b1020_0%,#102438_52%,#0c4b3d_100%)] text-white shadow-2xl shadow-slate-950/45'>
  <div className='grid gap-4 px-5 py-5 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)_auto] lg:items-center'>
    {/* left metadata */}
    {/* center progress + volume */}
    {/* right transport controls */}
  </div>
</div>
```

```tsx
// src/components/music/MusicFullscreenPlayer.tsx
<div className='pointer-events-auto absolute inset-0 overflow-y-auto rounded-[36px] border border-emerald-400/15 bg-[linear-gradient(180deg,rgba(8,12,24,0.98),rgba(11,31,45,0.98)_45%,rgba(10,75,61,0.96))] text-white'>
  <div className='grid gap-6 p-6 xl:grid-cols-[minmax(0,1.15fr)_420px]'>
    {/* left: cover, title, progress, controls */}
    {/* right: lyrics / queue */}
  </div>
</div>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/components/music/MusicPlayerRoot.test.tsx --runInBand`
Expected: PASS，展开 / 收起 / 停止 / 关闭动作保持稳定。

- [ ] **Step 5: Commit**

```bash
git add src/components/music/MusicMiniPlayer.tsx src/components/music/MusicFullscreenPlayer.tsx src/components/music/MusicQueuePanel.tsx src/components/music/MusicLyricsPanel.tsx src/components/music/MusicPlayerRoot.test.tsx
git commit -m "feat(music): redesign player surfaces"
```

### Task 4: 集成验证、推送与 beta 交付

**Files:**

- Modify: `docs/superpowers/plans/2026-06-27-music-player-jamendo.zh.md`
- Modify: `docs/superpowers/plans/2026-06-27-music-player-jamendo.en.md`

**Interfaces:**

- Consumes: 完成后的工作树、Git 远端、现有发布流程
- Produces: 已推送代码与 beta 交付结果

- [ ] **Step 1: 跑完整验证命令**

Run: `pnpm jest src/components/music/MusicPageClient.test.tsx src/components/music/MusicPlayerRoot.test.tsx src/app/api/music/routes.test.ts --runInBand`
Expected: PASS，0 failures。

- [ ] **Step 2: 跑构建验证**

Run: `pnpm build`
Expected: exit 0，Next.js 构建成功。

- [ ] **Step 3: 更新计划打勾并检查 git 状态**

Run: `git status --short`
Expected: 只包含本次改动，没有意外生成物。

- [ ] **Step 4: 推送当前分支**

Run: `git push`
Expected: 远端分支更新成功。

- [ ] **Step 5: 发一个 beta**

```bash
# 如果仓库已有 beta 发布约定，优先沿用既有流程；
# 否则创建一个 beta tag 并推送，例如：
git tag beta-2026-06-27-music-player
git push origin beta-2026-06-27-music-player
```

Expected: 远端可见 beta 交付物，且不覆盖正式 release。
