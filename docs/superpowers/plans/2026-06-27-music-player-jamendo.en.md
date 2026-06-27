# LunaTV Music Player and Jamendo Degradation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish direct playlist playback from card controls, Jamendo suspended-source degradation, and the NetEase-style player rebuild, then verify, commit, push, and ship a beta.

**Architecture:** Keep the existing `musicPlayerStore` and `MusicPlayerRoot` playback core intact, add a “play from collection summary” path at the page orchestration layer, add Jamendo source-health degradation in the provider/service layer, and then rebuild `MusicMiniPlayer` and `MusicFullscreenPlayer` as presentation-only changes. Execute the work in three TDD slices: playback flow, Jamendo degradation, and player UI, followed by integration verification and beta delivery.

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand, Jest, Testing Library, Git

## Global Constraints

- Clicking the playlist card play icon directly fetches the playlist detail and starts full-playlist playback
- Clicking the playlist card body still opens the playlist detail view and keeps the existing browsing path
- When Jamendo returns a suspended application error, the source degrades automatically and no longer exposes the raw English upstream message in the page UI
- Rebuild the bottom mini player so its layout, control zoning, and visual hierarchy match the reference more closely
- Rebuild the expanded player so it shares the same visual language and control semantics as the bottom player
- Do not rewrite `musicPlayerStore`
- Do not replace the existing `audio` playback chain inside `MusicPlayerRoot`
- Do not add new music sources or new play modes
- Keep formal documents in bilingual versions

---

### Task 1: Direct Playlist Playback from Card Controls

**Files:**

- Modify: `src/components/music/MusicCollectionGrid.tsx`
- Modify: `src/components/music/MusicPageClient.tsx`
- Modify: `src/components/music/MusicPageClient.test.tsx`

**Interfaces:**

- Consumes: `fetchMusicCollection(params: { source: MusicPlatformKey; id: string }): Promise<MusicCollection>`
- Consumes: `playQueue(queue: PlayerQueueItem[], startIndex?: number): void`
- Produces: `onPlayCollection(collection: MusicCollectionSummary): void`

- [ ] **Step 1: Write the failing test that proves the play icon no longer uses the detail-navigation path**

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

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm jest src/components/music/MusicPageClient.test.tsx --runInBand`
Expected: FAIL because there is no dedicated play button or the click still only updates the URL.

- [ ] **Step 3: Write the minimal implementation**

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

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm jest src/components/music/MusicPageClient.test.tsx --runInBand`
Expected: PASS, and the existing “card body opens detail” path still passes.

- [ ] **Step 5: Commit**

```bash
git add src/components/music/MusicCollectionGrid.tsx src/components/music/MusicPageClient.tsx src/components/music/MusicPageClient.test.tsx
git commit -m "feat(music): play collections from card controls"
```

### Task 2: Jamendo Suspended-Source Degradation

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

- [ ] **Step 1: Write the failing tests for suspended responses and source fallback**

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

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm jest src/app/api/music/routes.test.ts src/components/music/MusicPageClient.test.tsx --runInBand`
Expected: FAIL because Jamendo still reports enabled and the page does not switch away.

- [ ] **Step 3: Write the minimal implementation**

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
if (
  error instanceof MusicApiError &&
  isJamendoSuspendedMessage(error.message)
) {
  markJamendoUnavailable();
  throw new MusicApiError('Jamendo 官方接口当前不可用', 503);
}
```

```ts
const enabled = isJamendoConfigured() && !isJamendoTemporarilyUnavailable();
```

```tsx
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

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm jest src/app/api/music/routes.test.ts src/components/music/MusicPageClient.test.tsx --runInBand`
Expected: PASS, with a 503 suspended response, disabled Jamendo source metadata, and client fallback.

- [ ] **Step 5: Commit**

```bash
git add src/lib/music/jamendo.ts src/lib/music/service.ts src/app/api/music/routes.test.ts src/components/music/MusicPageClient.tsx src/components/music/MusicPageClient.test.tsx
git commit -m "fix(music): degrade jamendo suspended source"
```

### Task 3: NetEase-Style Player Surface Rebuild

**Files:**

- Modify: `src/components/music/MusicMiniPlayer.tsx`
- Modify: `src/components/music/MusicFullscreenPlayer.tsx`
- Modify: `src/components/music/MusicQueuePanel.tsx`
- Modify: `src/components/music/MusicLyricsPanel.tsx`
- Modify: `src/components/music/MusicPlayerRoot.test.tsx`

**Interfaces:**

- Consumes: `MusicMiniPlayerProps`
- Consumes: `MusicFullscreenPlayerProps`
- Produces: a new layout that remains compatible with the existing props and does not add new store fields

- [ ] **Step 1: Write the failing test that locks the main player interactions**

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

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm jest src/components/music/MusicPlayerRoot.test.tsx --runInBand`
Expected: FAIL if the rebuild changes or drops the current interaction hooks.

- [ ] **Step 3: Write the minimal implementation**

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

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm jest src/components/music/MusicPlayerRoot.test.tsx --runInBand`
Expected: PASS, with expand / collapse / stop / dismiss still working.

- [ ] **Step 5: Commit**

```bash
git add src/components/music/MusicMiniPlayer.tsx src/components/music/MusicFullscreenPlayer.tsx src/components/music/MusicQueuePanel.tsx src/components/music/MusicLyricsPanel.tsx src/components/music/MusicPlayerRoot.test.tsx
git commit -m "feat(music): redesign player surfaces"
```

### Task 4: Integration Verification, Push, and Beta Delivery

**Files:**

- Modify: `docs/superpowers/plans/2026-06-27-music-player-jamendo.zh.md`
- Modify: `docs/superpowers/plans/2026-06-27-music-player-jamendo.en.md`

**Interfaces:**

- Consumes: the finished worktree, the Git remote, and the existing release workflow
- Produces: pushed code plus a beta delivery artifact

- [ ] **Step 1: Run the full verification command**

Run: `pnpm jest src/components/music/MusicPageClient.test.tsx src/components/music/MusicPlayerRoot.test.tsx src/app/api/music/routes.test.ts --runInBand`
Expected: PASS with 0 failures.

- [ ] **Step 2: Run the build verification**

Run: `pnpm build`
Expected: exit 0 and a successful Next.js build.

- [ ] **Step 3: Update plan checkboxes and inspect git status**

Run: `git status --short`
Expected: only intentional changes, with no unexpected generated files.

- [ ] **Step 4: Push the current branch**

Run: `git push`
Expected: remote branch update succeeds.

- [ ] **Step 5: Ship a beta**

```bash
# Prefer the repo's existing beta release convention if one already exists.
# Otherwise create and push a beta tag, for example:
git tag beta-2026-06-27-music-player
git push origin beta-2026-06-27-music-player
```

Expected: a visible remote beta artifact that does not overwrite a stable release.
