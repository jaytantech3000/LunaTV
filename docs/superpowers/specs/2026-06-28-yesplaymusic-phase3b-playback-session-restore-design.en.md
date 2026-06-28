# LunaTV Music Phase 3b Playback Session Restore Design

**Goal**

Add a desktop-first playback session restore flow to the rebuilt `/music` experience so app relaunch or fresh mount can recover the last active queue, current track, and playback position instead of showing only loose resume tracks.

**Where This Fits**

The full rebuild still has five subprojects:

1. App shell (应用壳层)
2. Playback core (播放核心)
3. Data domain (数据域)
4. Account capability (账号能力)
5. Desktop integration (桌面集成)

Phase 1 rebuilt the shell and playback foundation.  
Phase 2 shipped the live `Netease` vertical slice (纵向切片).  
Phase 3a shipped QR account login.  
This document covers **Phase 3b = playback session restore**, which closes a gap between playback core and desktop integration.

**Why Now**

The new music line already has:

1. Real queue, lyrics, and stream loading
2. Local `recent tracks` and `play records`
3. Desktop tray, shortcuts, and media session
4. Persisted music preferences

The obvious gap is still:

- the app can remember where one track stopped, but not which active queue the user was listening to

That makes the desktop player feel disposable (一次性的) after every relaunch.

**Scope**

- Add a dedicated playback-session snapshot model
- Persist:
  - current queue
  - `currentTrackId`
  - `positionMs`
  - `durationMs`
  - `savedAt`
- On restore:
  - rebuild the queue
  - show the mini player
  - restore current track and seek position
  - force `paused` on cold start
  - refetch stream and lyrics for the current track
- Reuse the existing profile-route plus local-cache storage pattern

**Out of Scope**

- restoring full-player open state
- restoring queue drawer or lyrics drawer state
- auto-playing sound on cold launch
- persisting `streamUrl`
- overloading `playRecords` with queue-session meaning
- cross-device conflict resolution

**Current Reusable Foundations**

1. [MusicPlayerRoot](/Users/jay/Code/LunaTV/src/features/music/components/MusicPlayerRoot.tsx)
   - already owns audio, lyric sync, tray sync, and play-record writes
2. [music-profile](/Users/jay/Code/LunaTV/src/features/music/services/music-profile.ts)
   - already uses a local-cache plus profile-API storage pattern
3. [playback store](/Users/jay/Code/LunaTV/src/features/music/state/playback-store.ts)
   - already exposes stable `queue / currentTrackId / positionMs / durationMs`

Conclusion:

- the missing piece is not playback state itself, but a durable playback-session snapshot

**Core Approach**

1. Add a new `music-playback-session` profile domain instead of reusing `playRecords`
2. Persist a normalized snapshot with:
   - `queue`
   - `currentTrackId`
   - `positionMs`
   - `durationMs`
   - `savedAt`
3. Reuse `MusicTrackEntity`, but blank out `stream` before persistence
4. Keep the same local-cache plus `/api/music/profile/playback-session` pattern
5. Restore from `MusicPlayerRoot`, because it owns audio load, seek timing, and stream hydration

**Why Not Reuse Play Records**

`playRecords` mean single-track resume state, not active queue state:

- `playRecords`
  - track-scoped
  - powers the continue-listening shelf
  - does not preserve queue order
- `playback session`
  - queue-scoped
  - powers desktop relaunch restore
  - must preserve active queue order and current track

Mixing them would blur the boundary between “clear continue listening” and “clear active playback session”.

**New Data Model**

```ts
interface MusicPlaybackSession {
  queue: QueueItemEntity[];
  currentTrackId: string | null;
  positionMs: number;
  durationMs: number;
  savedAt: number;
}
```

Constraints:

- every persisted `track.stream` must be blank
- `currentTrackId` must exist inside `queue`, or the whole snapshot is invalid
- `positionMs` and `durationMs` must be non-negative
- no active queue means save an empty snapshot, not a fake default track

**Save Strategy**

Persist only at three checkpoints:

1. queue or current-track changes
2. `audio.pause`
3. `pagehide` or desktop shutdown

Reasoning:

- do not write on every `timeupdate`
- persist structure when the active track changes
- persist the freshest position when the user pauses or exits

**Restore Strategy**

Restore only on first mount when there is no active queue yet:

1. read the snapshot
2. skip if empty
3. if valid:
   - hydrate playback store
   - force `playState = 'paused'`
   - show the mini player
   - wait for current-track stream hydration, then seek to `positionMs`
   - refetch lyrics

Key constraint:

- cold-start restore must not auto-play audio

**Storage Boundary**

Add:

- `GET /api/music/profile/playback-session`
- `POST /api/music/profile/playback-session`

Behavior:

- `GET`
  - returns the full snapshot
- `POST`
  - fully overwrites the snapshot
  - an empty snapshot means “clear the active playback session”

Why no `DELETE`:

- current needs only read and full-write
- an empty snapshot already expresses clearing
- fewer routes and fewer failure branches

**Error Handling**

- read failure:
  - log it
  - fall back to an empty snapshot
  - never block `/music`
- write failure:
  - keep the local cache
  - allow a later overwrite retry
- invalid snapshot:
  - discard the whole snapshot
  - do not half-restore
- stream reload failure after restore:
  - keep queue and current track
  - surface a recoverable error through the existing playback store

**Testing Requirements**

Data layer:

- invalid snapshots fall back to empty state
- persisted queue snapshots strip `stream`
- the profile route can read and write full snapshots

Player root:

- cold start restores queue, current track, and position
- restored playback is paused by default
- mini player becomes visible again
- pause and page-hide persist the latest snapshot
- an existing active queue must not be overwritten by late async restore

UI regression:

- current play, skip, lyrics, tray, and continue-listening flows must stay green

**Acceptance**

- desktop relaunch restores the last active queue in `/music`
- current track and position return to the point where the user left
- restore does not auto-play sound
- persisted snapshot contains no `streamUrl`
- `play records` stay single-track resume data only
