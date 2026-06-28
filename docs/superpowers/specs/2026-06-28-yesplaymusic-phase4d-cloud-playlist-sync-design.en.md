# LunaTV Music Phase 4d Cloud Playlist Sync Design

**Goal**

Close the gap where a signed-in music account (音乐账号) already exposes `My playlists`, but the `Save to library` action on playlist pages still behaves like a purely local pin. When a `Netease` account is connected, `playlist` collection saves should become remote subscribe / unsubscribe actions, and both `My playlists` and the library playlist surface should refresh from the account source of truth（真实来源）.

**Position In The Full Rebuild**

The full rebuild still moves through five sub-projects:

1. app shell
2. playback core
3. data domain
4. account capability
5. desktop integration

Phase 1 shipped the shell and player skeleton.
Phase 2 shipped the live `Netease` vertical slice.
Phase 3a shipped QR account login.
Phase 3b shipped playback-session restore.
Phase 4a shipped desktop download / local-first playback.
Phase 4b shipped liked-songs sync.
Phase 4c shipped recent-plays sync.
This document covers **Phase 4d = cloud playlist sync**, the next closure (闭环) between account capability and library semantics（语义）.

**Why Now**

The rebuilt music system already has:

1. live home, search, collections, lyrics, daily recommendations, and personal FM
2. QR login, personal playlists, liked-songs sync, and recent-plays sync
3. playback-session restore, desktop downloads, and local-first playback

But one visible account gap remains:

- `My playlists` already comes from the remote account
- the playlist page still writes `Save to library` into local `savedCollections`
- the library still mixes remote playlists with local pinned collections

That means signed-in behavior still feels like “pin locally” instead of “add this playlist into my music library,” which is not close enough to the YesPlayMusic mental model.

**Scope**

- When a `Netease` account is connected:
  - saving a `playlist` collection becomes remote subscribe / unsubscribe
  - the sidebar `My playlists` list refreshes immediately after the mutation
  - the library gets an account-aware `My playlists` section
  - local `savedCollections` keeps only non-`playlist` entries in signed-in views
- When no music account is connected:
  - playlists keep the current local `Save to library` fallback
- `rank`, `album`, and `artist-toplist` collections keep local pin semantics
- If the current playlist is owned by the signed-in account:
  - the UI shows a read-only state instead of a destructive unsubscribe path

**Out Of Scope**

- no playlist create / rename / delete
- no track add / remove / reorder inside playlists
- no playlist cover, description, tags, or privacy editing
- no batch subscribe / unsubscribe
- no multi-source playlist-library abstraction in this cut

**Current-State Conclusion**

The repo already has five strong foundations:

1. [music-account-store](/Users/jay/Code/LunaTV/src/features/music/state/music-account-store.ts)
   - already owns account state and `playlists`
2. [MusicCollectionView](/Users/jay/Code/LunaTV/src/features/music/components/MusicCollectionView.tsx)
   - already has the collection-level save action slot
3. [music-library-store](/Users/jay/Code/LunaTV/src/features/music/state/music-library-store.ts)
   - already centralizes `savedCollections / favoriteTracks / recentTracks / resumeTracks`
4. [MusicSidebar](/Users/jay/Code/LunaTV/src/features/music/components/MusicSidebar.tsx)
   - already renders `My playlists`
5. [Netease repository](/Users/jay/Code/LunaTV/src/features/music/services/providers/netease/repository.ts)
   - already has authenticated account, liked-track, recent-play, and personal-playlist session flows

The missing part is not playlist display. It is the real read/write path for “this playlist belongs in my cloud music library.”

**Why Not Keep Reusing Local savedCollections**

Local `savedCollections` means:

- a local browser / desktop profile pin
- no third-party account required
- a good fit for browsing-oriented collections like ranks, albums, and artist desks

Remote `Netease` playlist subscribe means:

- third-party account state
- login required
- a direct mutation of the user’s real cloud library

Keeping both inside the same local collection bucket would keep the source of truth blurry, duplicate `Saved collections` with `My playlists`, and make sign-out fallback harder to reason about.

Like Phase 4b and Phase 4c, the first cut should add a dedicated remote service path and let stores decide whether the action is local or account-backed.

**Core Solution**

1. add minimal playlist-role metadata onto account playlist summaries
2. add a playlist-subscribe mutation contract in the provider layer
3. add a dedicated Next route for playlist subscribe / unsubscribe
4. add a frontend `music-account-playlists` service
5. let `music-account-store` refresh account playlists after the mutation
6. let `music-library-store.toggleSavedCollection()` delegate signed-in playlist saves to the account path
7. let the library render a dedicated `My playlists` section instead of mixing cloud playlists with local pins

**Domain Boundary**

Extend [entities.ts](/Users/jay/Code/LunaTV/src/features/music/domain/entities.ts) with:

```ts
accountPlaylistRole?: 'owned' | 'subscribed';
```

Rules:

- meaningful only when `kind === 'playlist'`
- `owned`
  - playlist created by the current account
- `subscribed`
  - playlist collected from another user
- everything else remains `undefined`

This keeps one unified summary model while still letting the UI distinguish “my own playlist” from “a playlist I collected.”

**Provider Boundary**

Add this contract to [repositories.ts](/Users/jay/Code/LunaTV/src/features/music/domain/repositories.ts):

```ts
setPlaylistSubscribed(
  source: LiveMusicSourceKey,
  playlistId: string,
  subscribed: boolean,
  options?: { sessionCookie?: string | null }
): Promise<MusicCollectionSummaryEntity[]>;
```

Recommended `Netease` behavior:

1. validate the account session
2. call the remote subscribe / unsubscribe endpoint
3. refresh the full account-playlist list
4. return refreshed `MusicCollectionSummaryEntity[]`

Role mapping:

- `creator.userId === account.profile.userId`
  - map to `owned`
- otherwise
  - map to `subscribed`

This keeps the “full refreshed list” pattern proven in Phase 4b / 4c and avoids optimistic UI complexity.

**Route Boundary**

Add:

```text
/api/music/account/playlists/subscriptions?source=netease
```

Behavior:

- `POST`
  - body: `{ playlistId: string }`
  - subscribe / collect the playlist
- `DELETE`
  - body: `{ playlistId: string }`
  - unsubscribe / uncollect the playlist

Constraints:

- all responses are `no-store`
- missing or invalid music-account session returns `401`
- responses return the refreshed account-playlist list
- the route never reads or writes local `savedCollections`

This slice does not add a new playlist-list GET route, because the existing account route already handles initial playlist hydration.

**Store Boundary**

[music-account-store](/Users/jay/Code/LunaTV/src/features/music/state/music-account-store.ts) should add:

- `togglePlaylistSubscription(playlistId, subscribed)`

Behavior:

1. call the frontend playlist-subscription service
2. replace only `account.playlists` on success
3. keep the previous playlist list on failure
4. avoid touching liked / recent / resume state

[music-library-store](/Users/jay/Code/LunaTV/src/features/music/state/music-library-store.ts) should change as follows:

1. `hydrateLibrary()`
   - still reads local `savedCollections`
   - but filters out `playlist` entries from signed-in views
2. `toggleSavedCollection(summary)`
   - when signed in and `summary.kind === 'playlist'`, delegate to the account-playlist mutation
   - otherwise keep the current local save path
3. `clearSavedCollections()`
   - still clears only local pins
   - never mutates remote `My playlists`

**UI Semantics**

The first cut should adjust only five places:

1. [MusicCollectionView](/Users/jay/Code/LunaTV/src/features/music/components/MusicCollectionView.tsx)
   - signed in + playlist:
     - not in account library: `Collect playlist`
     - collected playlist: `Collected`
     - owned playlist: `In your playlists`
   - signed out or non-playlist:
     - keep `Save to library`
2. [MusicLibraryView](/Users/jay/Code/LunaTV/src/features/music/components/MusicLibraryView.tsx)
   - add a `My playlists` section when signed in
   - let `Saved collections` describe local pinned ranks / albums / artist desks
3. [MusicSidebar](/Users/jay/Code/LunaTV/src/features/music/components/MusicSidebar.tsx)
   - keep `My playlists`, but make it refresh immediately after collect / uncollect
4. [MusicTopBar](/Users/jay/Code/LunaTV/src/features/music/components/MusicTopBar.tsx)
   - make the library summary account-aware, optionally including playlist counts
5. [MusicSettingsView](/Users/jay/Code/LunaTV/src/features/music/components/MusicSettingsView.tsx)
   - no new page and no destructive “clear remote playlists” action

**Local Playlist Pin Retention**

Do not delete existing local playlist pins in this cut:

- signed-out users can keep using them
- signed-in views hide them instead of uploading or deleting them
- signing out shows them again

That avoids polluting the real cloud account with local noise and avoids sudden data loss on sign-out.

**Error Handling**

- signed-out remote playlist mutation request:
  - return `401`
  - preserve current UI state
- failed remote subscribe / unsubscribe:
  - preserve current `account.playlists`
  - preserve current `savedCollections`
  - expose an actionable error message
- owned playlist:
  - never expose a destructive unsubscribe path in this slice
- empty remote playlist list:
  - treat as a valid empty state

**Testing Requirements**

Provider / route:

- subscribe returns refreshed account playlists
- unsubscribe returns refreshed account playlists
- account playlist summaries expose `owned / subscribed`
- route returns `401` without a valid session

Store:

- signed-in `toggleSavedCollection(playlist)` uses the remote branch
- signed-in `savedCollections` filters local playlist entries
- signed-out `toggleSavedCollection(playlist)` keeps the local branch
- `clearSavedCollections()` never changes remote account playlists

UI:

- signed-in playlist pages show `Collect playlist / Collected / In your playlists`
- collect / uncollect refreshes sidebar playlist counts immediately
- signed-in library shows a `My playlists` section
- signing out restores local playlist-save semantics

**Acceptance Criteria**

Phase 4d is complete only when all of the following are true:

1. saving a `playlist` while signed in really mutates the remote `Netease` library
2. `My playlists` refreshes immediately after collect / uncollect
3. signed-in library views no longer mix remote playlists with local `Saved collections`
4. `rank / album / artist-toplist` collections still keep local pin semantics
5. signed-out playlist saves still have a local fallback
6. owned playlists do not expose a dangerous unsubscribe path
7. route / store / UI regressions all pass
