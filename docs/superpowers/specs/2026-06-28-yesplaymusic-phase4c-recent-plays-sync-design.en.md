# LunaTV Music Phase 4c Recent Plays Sync Design

**Goal**

Close the gap (断层) where the rebuilt `/music` stack can sign into a `Netease` account and already sync liked songs, but still treats `Recently played` as device-local only. When the user is signed in, `recentTracks` should read from and refresh against the account's remote recent-play history; when signed out, the existing local recent-play path remains the fallback (兜底). `resumeTracks` stays local-only.

**Where This Fits In The Full Objective**

The full rebuild still moves through five sub-projects:

1. application shell
2. playback core
3. data domain
4. account capability (账号能力)
5. desktop integration

Phase 1 shipped the shell and player skeleton.
Phase 2 shipped the first live `Netease` vertical slice.
Phase 3a shipped QR account login.
Phase 3b shipped playback-session restore.
Phase 4a shipped desktop downloads and local-first playback.
Phase 4b shipped liked-songs sync.
This document covers **Phase 4c = recent plays sync**, the next closure (闭环) between account identity and library semantics (资料库语义).

**Why Now**

The rebuilt music stack already has:

1. live home, search, collection, lyric, daily recommendation, and personal FM flows
2. QR login, personal playlists, and liked-songs sync
3. playback-session restore, desktop downloads, and local-first playback

But the library still has a visible identity gap:

- `Liked songs` already follows the account
- `Recently played` is still entirely device-local
- the signed-in user recovers “what I like,” but not yet “what I was just listening to”

That leaves the account identity only half restored.

**Scope**

- When authenticated:
  - `music-library-store.recentTracks` reads from remote recent plays
  - starting playback reports the track as recently played and refreshes the remote-backed list
  - account-summary and settings copy become recent-play aware
- When signed out:
  - keep the current local `recentTracks` flow
- Keep `resumeTracks` local-only
- Do not delete, migrate, or overwrite existing local recent-play data

**Out Of Scope**

- remote resume-position sync
- weekly/monthly listening stats or analytics (统计)
- destructive “clear Netease recent plays” account actions
- automatic migration of local history into remote history
- multi-source recent-play abstraction beyond `Netease`

**Current Foundations**

Five reusable pieces already exist:

1. `MusicPlayerRoot`
   - already records local recent plays when a track starts
2. `music-library-store`
   - already owns `favoriteTracks / recentTracks / resumeTracks`
3. `music-profile.ts`
   - already persists local recent / resume data stably
4. `MusicAccountCard` and `MusicSettingsView`
   - already support account-aware copy and metrics
5. the Phase 4b liked-tracks chain
   - already proved the provider -> route -> service -> store -> UI account-aware pattern

Conclusion:

- the missing piece is not recent-play UI chrome (壳层); it is the true remote source-of-truth and writeback path for account recent plays

**Why Not Reuse Local recentTracks Directly**

The current `music-profile.ts` `recentTracks` semantics are:

- local history under the current browser / desktop profile
- driven by local playback behavior
- safe for the user to clear freely

Remote `Netease` recent plays are different:

- they belong to a third-party account
- they require an active session
- they should not be destroyed by a local “clear recent plays” action

Keeping both inside the same read/write helpers would blur the source-of-truth, dirty the `recentTracks` vs `resumeTracks` boundary again, and make signed-out fallback harder. Like Phase 4b, the first cut should introduce a dedicated service layer and let the library store decide which path is active.

**Core Solution**

1. Add a recent-plays contract at the provider layer:
   - `getRecentTracks`
   - `reportTrackPlayed`
2. Add `/api/music/account/recent-tracks`
   - a single route for reading and reporting recent plays
3. Add a dedicated front-end `music-recent-tracks` service
4. Keep the external `recentTracks` interface stable in `music-library-store`, but switch its internal source by account state
5. Stop letting `MusicPlayerRoot` write local recent-play data directly; route it through the library store so the store can choose remote vs local behavior

**Provider Boundary**

Add to `MusicAccountRepository`:

```ts
getRecentTracks(
  source: LiveMusicSourceKey,
  options?: { sessionCookie?: string | null }
): Promise<MusicTrackEntity[]>;

reportTrackPlayed(
  source: LiveMusicSourceKey,
  trackId: string,
  options?: { sessionCookie?: string | null }
): Promise<MusicTrackEntity[]>;
```

Recommended `Netease` behavior:

1. read the current account recent-play list
2. map the upstream payload into `MusicTrackEntity[]`
3. when a track starts, report the play to the upstream recent-play path
4. after the report succeeds, return the refreshed recent-play list instead of only `ok`

Why:

- the front end does not need a follow-up fetch
- `MusicPlayerRoot` does not need provider-specific knowledge
- the store can keep using the “full refreshed list” pattern proven in Phase 4b

**Route Boundary**

Add:

```text
/api/music/account/recent-tracks?source=netease
```

Behavior:

- `GET`
  - return the current account recent-play list
- `POST`
  - body: `{ trackId: string }`
  - report the track as recently played

Constraints:

- every response must be `no-store`
- return `401` when no valid music-account session exists
- the route must not read or write local `music-profile recentTracks`

**Store And Player Boundary**

`music-library-store` keeps exposing:

- `recentTracks`
- `clearRecentTracks`
- `buildPlaybackQueue`

But internally changes to:

1. `hydrateLibrary()`
   - still reads local `savedCollections / favoriteTracks / resumeTracks`
   - then chooses the recent-play source by `musicAccount.authenticated`
2. add `reportRecentTrack(track)`
   - authenticated: remote `reportTrackPlayed`
   - signed out: existing local `saveMusicRecentTrack`
3. on account switches:
   - after login, rehydrate and switch to remote recent plays
   - after logout, rehydrate and switch back to local recent plays
4. `resumeTracks`
   - stays local-only
   - is never overwritten by recent-play sync

`MusicPlayerRoot` should keep the existing “record recent play when a track starts” timing, but hand the actual write to `useMusicLibraryStore().reportRecentTrack(...)`.

**Timestamp And Ordering Strategy**

Reuse the existing shape:

```ts
interface MusicRecentTrackRecord {
  track: MusicTrackEntity;
  playedAt: number;
}
```

If the upstream recent-play payload includes a trustworthy timestamp, preserve it. If the upstream reliably exposes order but not a stable absolute time, the first cut may synthesize `playedAt` from response order so long as:

- library ordering stays stable
- top-bar / account-card counts stay correct
- the current UI does not need true per-second history precision

**UI Semantics**

Only touch four existing surfaces in the first cut:

1. `MusicAccountCard`
   - signed-in detail copy becomes “Liked songs and recent plays sync with Netease...”
2. `MusicSettingsView`
   - `Recent plays` keeps its count, but loses the local clear action while authenticated
3. `MusicTopBar`
   - settings / library summary still shows the recent count, but the source becomes account-aware
4. `MusicLibraryView`
   - keep the `Recently played` heading
   - change the data source only; no new page

**Local Data Retention Strategy**

The first cut keeps local `recentTracks` data untouched:

- signed-out users can still use it
- signed-in users temporarily view remote recent plays instead
- after logout the library falls back to local recent plays again

This avoids remote account pollution (污染), empty-looking libraries on logout, and re-mixing `resumeTracks` with `recentTracks`.

**Error Handling**

- Remote recent-play read without an active session:
  - return `401`
  - the store falls back to local recent plays
- Remote recent-play read failure:
  - keep the current `recentTracks`
  - expose a readable error
- Remote report failure:
  - keep the current `recentTracks`
  - do not block actual playback
  - allow future plays to retry naturally
- Empty remote list:
  - treat it as a valid empty history, not corruption

**Testing Requirements**

Provider / route:

- can read the current account recent-play list
- reporting a play returns the refreshed list
- missing session returns `401`

Service / store:

- authenticated `hydrateLibrary()` reads remote recent tracks
- signed-out `hydrateLibrary()` keeps reading local recent tracks
- `reportRecentTrack()` switches between remote and local branches by account state
- remote failures keep the previous state
- `resumeTracks` remain unaffected

Player / UI:

- when authenticated, track-start reporting goes to the remote recent-play path
- after logout, recent-play behavior falls back to local semantics
- authenticated settings no longer imply that the app can locally clear account history

**Acceptance**

Phase 4c is complete only when all of the following are true:

1. authenticated library `recentTracks` come from remote `Netease` recent plays
2. authenticated playback of a new track refreshes the remote-backed recent-play list
3. signed-out mode still uses local recent plays
4. `resumeTracks` remain local-only and are not overwritten
5. settings do not mislead the user into thinking the app can clear remote `Netease` history
6. targeted tests, full music regression, and `pnpm typecheck` all pass
