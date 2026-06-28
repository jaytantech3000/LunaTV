# YesPlayMusic Phase 3b Playback Session Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop-first playback session snapshot to the rebuilt `/music` flow so app relaunch restores the active queue, current track, and position while returning in a safe `paused` state.

**Architecture:** Add a dedicated `music-playback-session` profile domain instead of overloading `playRecords`. Reuse the existing local-cache plus profile-route pattern, and keep restore logic inside `MusicPlayerRoot`, which already owns audio, stream hydration, and seek timing.

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Zustand, Jest, Testing Library

## Global Constraints

- Stay inside the current `React + Next.js + Tauri` rewrite and do not reconnect the deleted legacy music system.
- Default to ASCII, do not introduce `any`, and follow the existing profile / route / store patterns.
- Write the failing test first, then the minimal implementation, then run targeted tests and music regression.
- Restored playback must default to `paused`; cold start must not auto-play audio.
- Persisted snapshots must not include `streamUrl`.

---

### Task 1: Add playback-session contract, storage service, and profile route

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

- [ ] **Step 1: Write the failing test**

Add to `src/features/music/tests/music-playback-session.test.ts`:

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

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm jest src/features/music/tests/music-playback-session.test.ts --runInBand`

Expected: FAIL because the new playback-session contract and service do not exist yet.

- [ ] **Step 3: Write minimal implementation**

- `music-playback-session-records.ts`
  - parse `queue / currentTrackId / positionMs / durationMs / savedAt`
  - invalidate the whole snapshot when `currentTrackId` is missing from `queue`
  - strip `stream` via `buildPersistedTrackSnapshot`
- `music-playback-session.ts`
  - local key: `moontv_music_playback_session`
  - remote path: `/music/profile/playback-session`
  - keep the same local-first, remote-best-effort write pattern
- route + `db` + `music-user-data-service`

  - support `GET / POST` only
  - `POST` fully overwrites the snapshot

- [ ] **Step 4: Add the failing route test**

Add to `src/features/music/tests/music-profile-routes.test.ts`:

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

- [ ] **Step 5: Run the route test to verify it fails**

Run: `pnpm jest src/features/music/tests/music-profile-routes.test.ts --runInBand`

Expected: FAIL because the new route is not wired into the profile service yet.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm jest src/features/music/tests/music-playback-session.test.ts src/features/music/tests/music-playback-session.desktop.test.ts src/features/music/tests/music-profile-routes.test.ts --runInBand`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/features/music/services/music-playback-session-records.ts src/features/music/services/music-playback-session.ts src/app/api/music/profile/playback-session/route.ts src/features/music/tests/music-playback-session.test.ts src/features/music/tests/music-playback-session.desktop.test.ts src/features/music/tests/music-profile-routes.test.ts src/lib/types.ts src/lib/db.ts src/lib/redis-base.db.ts src/lib/upstash.db.ts src/lib/core/profile/music-user-data-service.ts
git commit -m "feat(music): persist playback session snapshots"
```

### Task 2: Restore and keep flushing playback sessions from MusicPlayerRoot

**Files:**

- Modify: `src/features/music/components/MusicPlayerRoot.tsx`
- Modify: `src/features/music/tests/music-player-root.test.tsx`

**Interfaces:**

- Consumes:
  - `getMusicPlaybackSession(): Promise<MusicPlaybackSession>`
  - `saveMusicPlaybackSession(session: MusicPlaybackSession): Promise<MusicPlaybackSession>`
  - `buildMusicPlaybackSessionSnapshot(params): MusicPlaybackSession`
- Produces:

  - cold-start queue restore
  - mini-player visibility restore
  - post-hydration seek restore
  - latest snapshot flush on pause and `pagehide`

- [ ] **Step 1: Write the failing test**

Add to `src/features/music/tests/music-player-root.test.tsx`:

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

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm jest src/features/music/tests/music-player-root.test.tsx --runInBand`

Expected: FAIL because `MusicPlayerRoot` does not read or write playback sessions yet.

- [ ] **Step 3: Write minimal implementation**

- In `MusicPlayerRoot.tsx`
  - load the playback session once on mount
  - restore only when no active queue already exists
  - force `playState = 'paused'`
  - call `showMiniPlayer()`
  - hold `pendingRestoreSeekRef` until the current track stream is ready, then `requestSeek`
  - flush snapshots on queue/current-track changes, `pause`, and `pagehide`
- Keep current:

  - `saveMusicPlayRecord`
  - `saveMusicRecentTrack`
  - tray / keyboard / media session wiring

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm jest src/features/music/tests/music-player-root.test.tsx --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/music/components/MusicPlayerRoot.tsx src/features/music/tests/music-player-root.test.tsx
git commit -m "feat(music): restore desktop playback sessions"
```

### Task 3: Run full verification

**Files:**

- Test: `src/features/music/tests/music-player-root.test.tsx`
- Test: `src/features/music/tests/music-phase2-ui.test.tsx`
- Test: `src/features/music/tests`

- [ ] **Step 1: Run targeted tests**

Run: `pnpm jest src/features/music/tests/music-playback-session.test.ts src/features/music/tests/music-playback-session.desktop.test.ts src/features/music/tests/music-profile-routes.test.ts src/features/music/tests/music-player-root.test.tsx --runInBand`

Expected: PASS

- [ ] **Step 2: Run music regression**

Run: `pnpm jest src/features/music/tests src/app/music/page.test.tsx --runInBand`

Expected: PASS. Existing `act(...)` warning noise is acceptable, but no new failures are allowed.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS
