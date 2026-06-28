# LunaTV Music System Phase 4b Liked Songs Sync Design

**Goal**

Close the gap (断层) where the rebuilt `/music` stack can sign into a `Netease` account but still treats `Saved tracks` as a local-only device library. When the user is signed in, the `Save / Saved` flow should read and mutate the account's cloud liked songs; when signed out, the existing local favorites path remains the fallback (兜底).

**Position Inside The Full Rebuild**

The full rebuild still moves through five sub-projects:

1. Shell layer
2. Playback core
3. Data domain
4. Account capabilities
5. Desktop integration

Phase 1 shipped the shell and player skeleton.
Phase 2 shipped the live `Netease` vertical slice.
Phase 3a shipped QR account login.
Phase 3b shipped playback session restore.
Phase 4a shipped desktop downloads and local-first playback.
This document covers **Phase 4b = liked songs sync**, the next closure (闭环) between account capability and library semantics (资料库语义).

**Why Now**

The rebuilt music stack already has:

1. live home, search, collections, lyrics, daily recommendations, and personal FM
2. QR login, personal playlists, library surfaces, and local resume state
3. playback session restore, desktop download, and local-first playback

But the account story still breaks in an obvious place:

- after login, the user can see personal playlists but cannot recover “liked songs” from the real account
- `Saved tracks` is still device-local
- the account summary explicitly says saved tracks stay on this device

That makes login feel like a browse pass, not a restored music identity (音乐身份).

**In Scope**

- When a `Netease` account is authenticated:
  - `favoriteTracks` in the library should come from the account's liked songs
  - the full-player `Save / Saved` action should become remote `Like / Liked`
  - library, account card, top-bar, and settings copy/counts become account-aware (账号感知)
- When signed out:
  - keep the existing local favorites flow
- Preserve local favorites data, but do not auto-upload it
- Refresh front-end state immediately after like/unlike succeeds

**Out Of Scope**

- No one-click migration (迁移) from local favorites to `Netease`
- No batch like / unlike
- No playlist create, edit, or delete
- No comments, MV, or social features
- No multi-source liked-song abstraction beyond `Netease` in this slice

**Current-State Conclusion**

Four reusable foundations already exist:

1. [MusicAccountCard](/Users/jay/Code/LunaTV/src/features/music/components/MusicAccountCard.tsx)
   - already owns QR login, account state, and personal-playlist entry points
2. [music-library-store](/Users/jay/Code/LunaTV/src/features/music/state/music-library-store.ts)
   - already centralizes `favoriteTracks / recentTracks / resumeTracks`
3. [MusicFullPlayer](/Users/jay/Code/LunaTV/src/features/music/components/MusicFullPlayer.tsx)
   - already has the single-track `Save / Saved` action surface
4. [Netease repository](/Users/jay/Code/LunaTV/src/features/music/services/providers/netease/repository.ts)
   - already has real session-backed account, personal-playlist, daily, and FM flows

Conclusion:

- the missing piece is not account chrome (壳层); it is the real source-of-truth (真实来源) and mutation path for liked songs

**Core Approach**

1. Add a liked-song contract at the provider layer:
   - `getLikedTracks`
   - `setTrackLiked`
2. Add a dedicated Next route:
   - `/api/music/account/likes`
3. Add a front-end `music-liked-tracks` service layer
   - do not mix remote liked songs into `music-profile.ts`
4. Keep the public `music-library-store` favorite interface stable, but make its internals account-aware:
   - signed in: remote liked songs
   - signed out: local favorites
5. Reuse the current player and library UI skeleton, and only change copy, data source, and action semantics (动作语义)

**Why Not Reuse Local Favorites Directly**

Current [music-profile.ts](/Users/jay/Code/LunaTV/src/features/music/services/music-profile.ts) favorites are device-profile data:

- browser local or desktop local profile
- optional profile sync storage
- intended as device library state

`Netease` liked songs are different:

- third-party remote account state
- session-gated
- directly mutate the user's real account data

Mixing them inside one storage helper would blur:

- the source of truth (真实来源)
- the sign-out fallback path
- future coexistence (并存) of local saves and remote likes

So the first cut should introduce a separate service layer, then let the library store choose which branch is active.

**Provider Boundary**

Add to [repositories.ts](/Users/jay/Code/LunaTV/src/features/music/domain/repositories.ts) under `MusicAccountRepository`:

```ts
getLikedTracks(
  source: LiveMusicSourceKey,
  options?: { sessionCookie?: string | null }
): Promise<MusicTrackEntity[]>;

setTrackLiked(
  source: LiveMusicSourceKey,
  trackId: string,
  liked: boolean,
  options?: { sessionCookie?: string | null }
): Promise<MusicTrackEntity[]>;
```

Recommended `Netease` implementation:

1. read the current account profile and user playlists
2. find the “liked songs” playlist
   - prefer `specialType === 5`
   - use name matching only as a fallback
3. fetch playlist detail and map it into `MusicTrackEntity[]`
4. call the remote like/unlike endpoint
5. after mutation succeeds, return the refreshed liked-song list instead of only `ok`

Why:

- the client does not need a second fetch
- the current store can avoid optimistic updates (乐观更新)
- rollback (回滚) stays simpler

**Route Boundary**

Add:

```text
/api/music/account/likes?source=netease
```

Behavior:

- `GET`
  - return the current account's liked-song list
- `POST`
  - body: `{ trackId: string }`
  - means “like this track”
- `DELETE`
  - body: `{ trackId: string }`
  - means “unlike this track”

Constraints:

- every response is `no-store`
- missing or invalid music account session returns `401`
- the route must not read or write local `music-profile favorites`

**Store Boundary**

[music-library-store](/Users/jay/Code/LunaTV/src/features/music/state/music-library-store.ts) should keep its public UI-facing API mostly unchanged:

- `favoriteTracks`
- `favoriteTrackKeys`
- `toggleFavoriteTrack`
- `isTrackFavorited`

But internally it becomes account-aware:

1. `hydrateLibrary()`
   - still loads local `savedCollections / recentTracks / resumeTracks`
   - then chooses the favorite source based on `musicAccount.authenticated`
2. `toggleFavoriteTrack(track)`
   - authenticated -> remote like/unlike
   - signed out -> local favorites
3. On account transitions:
   - after login succeeds, rehydrate and switch to remote liked songs
   - after disconnect, rehydrate and switch back to local favorites
4. On remote failure:
   - keep the previous liked-track list
   - expose an error message
   - do not clear current entries

**UI Semantics**

Only update the existing five surfaces in the first cut:

1. [MusicFullPlayer](/Users/jay/Code/LunaTV/src/features/music/components/MusicFullPlayer.tsx)
   - authenticated:
     - `Save track to library` -> `Like track`
     - `Saved` -> `Liked`
   - signed out keeps the current local wording
2. [MusicLibraryView](/Users/jay/Code/LunaTV/src/features/music/components/MusicLibraryView.tsx)
   - authenticated: `Saved tracks` -> `Liked songs`
3. [MusicAccountCard](/Users/jay/Code/LunaTV/src/features/music/components/MusicAccountCard.tsx)
   - stat block `Saved` -> `Liked`
   - detail copy must stop claiming that authenticated liked songs only live on this device
4. [MusicTopBar](/Users/jay/Code/LunaTV/src/features/music/components/MusicTopBar.tsx)
   - summary copy becomes account-aware
5. [MusicSettingsView](/Users/jay/Code/LunaTV/src/features/music/components/MusicSettingsView.tsx)
   - metric card shows `Liked songs` when authenticated

**Local-Favorites Preservation Strategy**

Do not delete, migrate, or overwrite local `favorites` in the first cut:

- signed-out users still use them
- signed-in users see remote liked songs instead
- sign-out restores the local favorite view

That avoids:

- accidental uploads
- remote account pollution (污染)
- existing desktop data suddenly disappearing

**Error Handling**

- Remote liked-song read without an active session:
  - return `401`
  - front-end falls back to local favorites
- Remote like/unlike failure:
  - keep the current liked-track list
  - surface a readable error
- Liked playlist cannot be found:
  - return an empty list, not a “corrupt account” fatal error
- `Netease` business errors:
  - pass through a readable message; do not swallow

**Testing Requirements**

Provider / route:

- can read the current account liked-song list
- successful like returns the refreshed list
- successful unlike returns the refreshed list
- missing session returns `401`

Store:

- authenticated `hydrateLibrary()` reads remote liked songs
- signed-out `hydrateLibrary()` keeps local favorites
- `toggleFavoriteTrack()` switches remote/local branches by account state
- remote failure preserves previous state

UI:

- authenticated full player shows `Like / Liked`
- library shows `Liked songs`
- disconnect restores `Saved tracks / Save / Saved`

**Acceptance Criteria**

- When the user is signed into `Netease`, library liked tracks come from remote account state rather than local favorites
- When signed in, the player like button mutates real `Netease` liked-song state
- After like or unlike succeeds, library and player button state refresh together
- When signed out, the existing local favorite flow does not regress
- Local favorites are not auto-uploaded, deleted, or overwritten
