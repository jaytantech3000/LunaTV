# YesPlayMusic Phase 3b 播放现场恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前 `/music` 重写线中补齐桌面优先的播放现场快照，让应用重启后恢复活动队列、当前曲目和进度，并默认以 `paused` 状态回到 mini player。

**Architecture:** 新增独立 `music-playback-session` 资料域，继续复用现有 “local cache + profile route” 存储模式，不污染 `playRecords`。恢复逻辑放在 `MusicPlayerRoot`，因为它掌管 audio、stream hydrate 和 seek 时机。

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Zustand, Jest, Testing Library

## Global Constraints

- 只在当前 `React + Next.js + Tauri` 重写线上补能力，不回接旧音乐系统。
- 默认 ASCII，禁止引入 `any`，保持现有 profile / route / store 模式。
- 先写失败测试，再写最小实现，再跑定向测试与音乐回归。
- 恢复后默认 `paused`，不允许冷启动自动播出声音。
- 持久化快照禁止写入 `streamUrl`。

---

### Task 1: 补齐播放现场快照 contract、存储服务与 profile route

**Files:**

- Create: `src/features/music/services/music-playback-session-records.ts`
- Create: `src/features/music/services/music-playback-session.ts`
- Create: `src/app/api/music/profile/playback-session/route.ts`
- Create: `src/features/music/tests/music-playback-session.test.ts`
- Create: `src/features/music/tests/music-playback-session.desktop.test.ts`
- Modify: `src/features/music/tests/music-profile-routes.test.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/redis-base.db.ts`
- Modify: `src/lib/upstash.db.ts`
- Modify: `src/lib/core/profile/music-user-data-service.ts`

**Interfaces:**

- Consumes:
  - `QueueItemEntity`
  - `buildPersistedTrackSnapshot(track: MusicTrackEntity): MusicTrackEntity`
  - `shouldUseProfileApiStorage()`
- Produces:

  - `interface MusicPlaybackSession { queue: QueueItemEntity[]; currentTrackId: string | null; positionMs: number; durationMs: number; savedAt: number }`
  - `createEmptyMusicPlaybackSession(): MusicPlaybackSession`
  - `sanitizeMusicPlaybackSession(value: unknown): MusicPlaybackSession`
  - `buildMusicPlaybackSessionSnapshot(params): MusicPlaybackSession`
  - `getMusicPlaybackSession(): Promise<MusicPlaybackSession>`
  - `saveMusicPlaybackSession(session: MusicPlaybackSession): Promise<MusicPlaybackSession>`

- [ ] **Step 1: 写失败测试**

在 `src/features/music/tests/music-playback-session.test.ts` 新增：

```ts
it('sanitizes invalid playback session payloads back to empty state', async () => {
  localStorage.setItem(
    'moontv_music_playback_session',
    JSON.stringify({
      queue: [{ queueId: 'bad', track: { id: '', source: 'netease' } }],
      currentTrackId: 'missing',
      positionMs: -10,
      durationMs: 'oops',
    })
  );

  const { getMusicPlaybackSession } = await import(
    '../services/music-playback-session'
  );

  await expect(getMusicPlaybackSession()).resolves.toEqual({
    queue: [],
    currentTrackId: null,
    positionMs: 0,
    durationMs: 0,
    savedAt: 0,
  });
});

it('persists queue snapshots without stream urls', async () => {
  const {
    buildMusicPlaybackSessionSnapshot,
    saveMusicPlaybackSession,
    getMusicPlaybackSession,
  } = await import('../services/music-playback-session');

  const snapshot = buildMusicPlaybackSessionSnapshot({
    queue: [
      {
        queueId: 'q1',
        addedAt: 1,
        fromContext: 'featured',
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/a.jpg',
          durationMs: 215000,
          stream: '/api/music/stream?source=netease&id=9001',
          playable: true,
        },
      },
    ],
    currentTrackId: '9001',
    positionMs: 42000,
    durationMs: 215000,
    savedAt: 1,
  });

  await saveMusicPlaybackSession(snapshot);

  await expect(getMusicPlaybackSession()).resolves.toEqual({
    ...snapshot,
    queue: [
      expect.objectContaining({
        track: expect.objectContaining({
          id: '9001',
          stream: '',
        }),
      }),
    ],
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/music-playback-session.test.ts --runInBand`

Expected: FAIL，因为新的 playback-session contract 和 service 尚不存在。

- [ ] **Step 3: 写最小实现**

- `music-playback-session-records.ts`
  - 解析 `queue / currentTrackId / positionMs / durationMs / savedAt`
  - 非法 `currentTrackId` 或非法队列直接回退空快照
  - 使用 `buildPersistedTrackSnapshot` 清空 `stream`
- `music-playback-session.ts`
  - 本地 key 用 `moontv_music_playback_session`
  - 远端 path 用 `/music/profile/playback-session`
  - 继续沿用“本地先写、远端尽力同步”的模式
- route + `db` + `music-user-data-service`

  - 只提供 `GET / POST`
  - `POST` 做全量覆盖

- [ ] **Step 4: 补 route 失败测试**

在 `src/features/music/tests/music-profile-routes.test.ts` 新增：

```ts
it('reads and overwrites music playback sessions through the playback-session route', async () => {
  const { GET, POST } = await importMusicProfileRoute(
    '@/app/api/music/profile/playback-session/route'
  );

  const payload = {
    queue: [
      {
        queueId: 'q1',
        addedAt: 1,
        fromContext: 'featured',
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/a.jpg',
          durationMs: 215000,
          stream: '',
          playable: true,
        },
      },
    ],
    currentTrackId: '9001',
    positionMs: 42000,
    durationMs: 215000,
    savedAt: 123,
  };

  mockGetMusicPlaybackSession.mockResolvedValue(payload);

  const getResponse = await GET(
    new NextRequest('http://localhost/api/music/profile/playback-session')
  );
  expect(await getResponse.json()).toEqual(payload);

  await POST(
    new NextRequest('http://localhost/api/music/profile/playback-session', {
      method: 'POST',
      body: JSON.stringify({ session: payload }),
    })
  );

  expect(mockSaveMusicPlaybackSession).toHaveBeenCalledWith(
    expect.objectContaining({ username: 'desktop-owner' }),
    payload
  );
});
```

- [ ] **Step 5: 跑 route 测试确认失败**

Run: `pnpm jest src/features/music/tests/music-profile-routes.test.ts --runInBand`

Expected: FAIL，因为新的 route 还没接到 profile service。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/music-playback-session.test.ts src/features/music/tests/music-playback-session.desktop.test.ts src/features/music/tests/music-profile-routes.test.ts --runInBand`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/features/music/services/music-playback-session-records.ts src/features/music/services/music-playback-session.ts src/app/api/music/profile/playback-session/route.ts src/features/music/tests/music-playback-session.test.ts src/features/music/tests/music-playback-session.desktop.test.ts src/features/music/tests/music-profile-routes.test.ts src/lib/types.ts src/lib/db.ts src/lib/redis-base.db.ts src/lib/upstash.db.ts src/lib/core/profile/music-user-data-service.ts
git commit -m "feat(music): persist playback session snapshots"
```

### Task 2: 在 MusicPlayerRoot 恢复并持续写回播放现场

**Files:**

- Modify: `src/features/music/components/MusicPlayerRoot.tsx`
- Modify: `src/features/music/tests/music-player-root.test.tsx`

**Interfaces:**

- Consumes:
  - `getMusicPlaybackSession(): Promise<MusicPlaybackSession>`
  - `saveMusicPlaybackSession(session: MusicPlaybackSession): Promise<MusicPlaybackSession>`
  - `buildMusicPlaybackSessionSnapshot(params): MusicPlaybackSession`
- Produces:

  - 冷启动恢复活动队列
  - mini player 自动出现
  - stream hydrate 后 seek 到保存进度
  - 暂停 / `pagehide` 会刷新最新快照

- [ ] **Step 1: 写失败测试**

在 `src/features/music/tests/music-player-root.test.tsx` 新增：

```ts
it('restores a persisted playback session on first mount without auto-playing', async () => {
  localStorage.setItem(
    'moontv_music_playback_session',
    JSON.stringify({
      queue: [
        {
          queueId: 'q1',
          addedAt: 1,
          fromContext: 'featured',
          track: {
            id: '9001',
            source: 'netease',
            title: 'Playable Track',
            artists: ['Artist A'],
            album: 'Album A',
            coverUrl: 'https://cdn.music.test/album-a.jpg',
            durationMs: 215000,
            stream: '',
            playable: true,
          },
        },
      ],
      currentTrackId: '9001',
      positionMs: 42000,
      durationMs: 215000,
      savedAt: 123,
    })
  );

  const { container } = render(<MusicPlayerRoot />);
  const audio = container.querySelector('audio');

  await waitFor(() => {
    expect(usePlaybackStore.getState().currentTrackId).toBe('9001');
  });

  expect(usePlaybackStore.getState().playState).toBe('paused');
  expect(usePlaybackStore.getState().positionMs).toBe(42000);
  expect(audio?.currentTime).toBe(42);
});

it('flushes the latest playback session on pagehide', async () => {
  usePlaybackStore.getState().seedQueue([
    {
      queueId: 'q1',
      addedAt: 1,
      fromContext: 'featured',
      track: {
        id: '9001',
        source: 'netease',
        title: 'Playable Track',
        artists: ['Artist A'],
        album: 'Album A',
        coverUrl: 'https://cdn.music.test/album-a.jpg',
        durationMs: 215000,
        stream: '/api/music/stream?source=netease&id=9001&quality=standard',
        playable: true,
      },
    },
  ]);

  const { container } = render(<MusicPlayerRoot />);
  const audio = container.querySelector('audio');

  act(() => {
    if (audio) {
      audio.currentTime = 24;
    }
    window.dispatchEvent(new Event('pagehide'));
  });

  await waitFor(() => {
    expect(localStorage.getItem('moontv_music_playback_session')).toContain(
      '9001'
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/music-player-root.test.tsx --runInBand`

Expected: FAIL，因为 `MusicPlayerRoot` 还不会读写 playback-session。

- [ ] **Step 3: 写最小实现**

- 在 `MusicPlayerRoot.tsx`
  - 首次挂载时读取 session
  - 仅当当前没有活动队列时恢复
  - 恢复后强制 `playState = 'paused'`
  - `showMiniPlayer()`
  - 用 `pendingRestoreSeekRef` 等当前曲目 stream 就绪后再 `requestSeek`
  - 在队列/当前曲目变化、`pause`、`pagehide` 时写出快照
- 保持现有：

  - `saveMusicPlayRecord`
  - `saveMusicRecentTrack`
  - tray / keyboard / media session

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/music-player-root.test.tsx --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/music/components/MusicPlayerRoot.tsx src/features/music/tests/music-player-root.test.tsx
git commit -m "feat(music): restore desktop playback sessions"
```

### Task 3: 跑整体验证

**Files:**

- Test: `src/features/music/tests/music-player-root.test.tsx`
- Test: `src/features/music/tests/music-phase2-ui.test.tsx`
- Test: `src/features/music/tests`

- [ ] **Step 1: 跑定向测试**

Run: `pnpm jest src/features/music/tests/music-playback-session.test.ts src/features/music/tests/music-playback-session.desktop.test.ts src/features/music/tests/music-profile-routes.test.ts src/features/music/tests/music-player-root.test.tsx --runInBand`

Expected: PASS

- [ ] **Step 2: 跑音乐回归**

Run: `pnpm jest src/features/music/tests src/app/music/page.test.tsx --runInBand`

Expected: PASS，允许保留既有 `act(...)` warning 噪音，但不允许新增失败。

- [ ] **Step 3: 跑类型检查**

Run: `pnpm typecheck`

Expected: PASS
