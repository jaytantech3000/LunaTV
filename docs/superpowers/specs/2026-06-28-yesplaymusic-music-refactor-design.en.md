# LunaTV YesPlayMusic Music Refactor Design

**Goal**

Refactor the LunaTV music module around the page structure, player semantics, and core interactions of YesPlayMusic, while keeping the existing audio playback engine intact, so we ship a complete player system that can actually play, seek, queue, show lyrics, favorite tracks, and browse across sources.

**Scope**

- Rework the music-page information architecture (信息架构) and visual hierarchy to better match the YesPlayMusic browsing flow
- Rebuild the bottom player into a YesPlayMusic-style three-zone control bar
- Rebuild the expanded player so it fully supports cover art, lyrics, queue, volume, favorites, and playback modes
- Adjust the player state model so repeat mode and shuffle mode are independent
- Keep the existing multi-source adapter layer, `audio` element playback chain, and `MusicPlayerRoot` assembly point
- Keep source degradation (降级) logic for Jamendo and similar providers

**Out of Scope**

- Do not copy YesPlayMusic source code directly
- Do not add NetEase login, personal FM, MV, or other capabilities that need backend dependencies we do not currently have
- Do not rewrite the `MusicApi` provider abstraction
- Do not swap in a new player library

**Current-State Assessment**

- The current player can already play music, but the bottom-bar control organization is far from YesPlayMusic
- The current `playMode` merges repeat and shuffle into one enum, which makes a faithful YesPlayMusic-style control model awkward
- The current music page still behaves like a “Hero + Spotlight + lists” marketing layout, not a player-product primary navigation flow
- Lyrics and queue already exist, but they do not form one unified expanded-player interaction model

**Target Architecture**

1. `musicPlayerStore`

   - Split playback control state into:
     - `repeatMode: 'off' | 'all' | 'one'`
     - `shuffleEnabled: boolean`
   - Keep:
     - `queue`
     - `currentIndex`
     - `presentation`
     - `volume`
     - `muted`
     - `currentTimeSec`
     - `lyrics`
     - `streamUrl`
   - Queue transition rules stay inside the store so the UI does not guess what “next” means

2. `MusicPlayerRoot`

   - Remains the single playback assembly layer
   - Responsible for:
     - fetching stream URLs and lyrics
     - managing the `audio` lifecycle
     - persisting favorites, recents, and play records
     - controlling whether expanded mode opens on “lyrics” or “queue”

3. `MusicMiniPlayer`

   - Becomes a fixed YesPlayMusic-style bottom bar
   - Three zones:
     - left: cover, title, artist, favorite
     - center: previous / play-pause / next
     - right: queue, repeat, shuffle, volume, lyrics expand, dismiss
   - Progress bar becomes a dedicated thin track across the top

4. `MusicFullscreenPlayer`

   - Becomes the main player stage instead of a large control card
   - Left area:
     - cover
     - track metadata
     - volume and favorite controls
     - progress bar
     - primary transport controls
   - Right area:
     - lyrics view
     - queue view
   - A page-local tab switches between lyrics and queue

5. `MusicPageClient`
   - Remove the marketing-style hero copy and turn it into a player-product layout
   - Keep source switching, but reorganize the page as:
     - top source navigation
     - section navigation
     - current-section content
     - detail-state collection header plus track table
   - Search, library, and collection detail continue to share the same queue-based playback entry points

**Key Interactions**

- Clicking the bottom-bar “lyrics” button:
  - expands the player
  - opens the lyrics view by default
- Clicking the bottom-bar “queue” button:
  - expands the player
  - opens the queue view by default
- Clicking the repeat button cycles:
  - `off -> all -> one -> off`
- Clicking the shuffle button toggles `shuffleEnabled` independently
- When a track ends:
  - replay the current track if `repeatMode=one`
  - move to a random next track if `shuffleEnabled=true`
  - stop playback if `repeatMode=off` and the queue is already at the end
  - otherwise move by list order

**Error Handling**

- Stream failure:
  - keep the current queue
  - show a clear error message
  - do not clear player UI
- Lyrics failure:
  - only the lyrics area falls back to an empty state
  - audio playback continues
- Source unavailable:
  - keep using server-side provider degradation
  - the frontend only consumes the final `enabled` result

**Testing Strategy**

- `musicPlayerStore`
  - cover next-track rules for repeat mode and shuffle mode
- `MusicMiniPlayer`
  - cover queue button, lyrics button, repeat button, shuffle button, and volume updates
- `MusicFullscreenPlayer`
  - cover lyrics/queue switching and primary transport controls
- `MusicPlayerRoot`
  - cover expanded-entry behavior, end-of-track transition rules, and favorite actions
- `MusicPageClient`
  - cover section browsing, collection playback, detail switching, and the main search/library flows

**Acceptance Criteria**

- The bottom player is structurally and behaviorally close to YesPlayMusic
- The expanded player reliably shows both lyrics and queue
- The player supports previous, next, pause, resume, seek, volume, favorite, repeat, and shuffle
- The music page can start playback reliably from source home, collection detail, search result, and library entry points
- Automated tests pass
- `pnpm build` and the beta build pass
