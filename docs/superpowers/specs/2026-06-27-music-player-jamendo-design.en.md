# LunaTV Music Player and Jamendo Degradation Design

**Goal**

Fix playlist-card playback behavior, hide the Jamendo suspended application failure from end users, and rebuild the current player into a NetEase-style bottom control bar plus a matching expanded player.

**Scope**

- Clicking the playlist card play icon directly fetches the playlist detail and starts full-playlist playback
- Clicking the playlist card body still opens the playlist detail view and keeps the existing browsing path
- When Jamendo returns a suspended application error, the source degrades automatically and no longer exposes the raw English upstream message in the page UI
- Rebuild the bottom mini player so its layout, control zoning, and visual hierarchy match the reference more closely
- Rebuild the expanded player so it shares the same visual language and control semantics (控件语义) as the bottom player
- Add automated coverage for direct playlist playback, Jamendo degradation, and player interaction

**Out of Scope**

- Do not rewrite `musicPlayerStore`
- Do not replace the existing `audio` playback chain inside `MusicPlayerRoot`
- Do not add new music sources or new play modes
- Do not build a Jamendo private recovery path or a manual admin recovery flow

**Current Findings**

- The play icon inside `MusicCollectionGrid` currently shares the same `onSelect` flow as the card body, so it can only open playlist detail and cannot start playback directly
- Jamendo visibility is currently decided only by whether `JAMENDO_CLIENT_ID` exists, and does not treat “configured but suspended upstream” as an unavailable state
- The current player is a custom dark floating shell, structurally closer to a large card than to the NetEase-style bottom control bar in the reference

**Core Approach**

1. Keep the current playback core and only replace the trigger flow and presentation layer
2. Handle Jamendo availability degradation (可用性降级) in the provider layer instead of guessing error strings in the page UI
3. Make the mini player and expanded player share one visual system and one interaction vocabulary, so they do not feel like two unrelated players

**Component Boundaries**

- `src/components/music/MusicCollectionGrid.tsx`
  - Split “open playlist detail” and “play playlist immediately” into two event paths
  - Keep `onSelect` on the card body
  - Move the play icon to a separate `onPlayCollection`
- `src/components/music/MusicPageClient.tsx`
  - Add an async “play by playlist summary” flow
  - Auto-switch to the first available source when the current source becomes unavailable
  - Stay responsible for page-level orchestration (页面级调度), not low-level playback state
- `src/lib/music/jamendo.ts`
  - Detect suspended application responses in one place
  - Return a stable business error instead of the raw upstream English error
- `src/lib/music/service.ts`
  - Aggregate source availability and Jamendo degradation results
- `src/components/music/MusicMiniPlayer.tsx`
  - Rebuild into the reference bottom horizontal control bar
- `src/components/music/MusicFullscreenPlayer.tsx`
  - Rebuild into an expanded player that shares the same visual language
- `src/components/music/MusicQueuePanel.tsx`
  - Keep queue behavior, but let styling follow the new player shell
- `src/components/music/MusicLyricsPanel.tsx`
  - Keep lyric scrolling behavior, but let styling follow the new player shell

**Direct Playlist Playback Flow**

- Playlist card body click:
  - update the URL
  - open playlist detail
- Playlist play icon click:
  - stop event bubbling so detail navigation is not triggered by mistake
  - call `fetchMusicCollection({ source, id })` to load the full playlist
  - filter tracks where `playable === true`
  - call `playQueue(playableTracks.map(buildQueueItemFromTrack), 0)`
  - if the playlist is empty or every track is unplayable, keep the current page state and show a non-blocking (非阻断) message

**Jamendo Degradation Strategy**

- Detect these upstream error signals in `src/lib/music/jamendo.ts`:
  - `Your application has been suspended`
  - `Suspended Application Error`
- Once matched:
  - throw one stable error such as “Jamendo official API is currently unavailable”
  - keep the HTTP status as `503`
- Source availability should no longer depend only on `JAMENDO_CLIENT_ID`:
  - `configured`: env var exists
  - `healthy`: the latest probe did not hit a suspended error
  - only `configured && healthy` should be exposed as enabled
- Add a light short-TTL circuit breaker (熔断) cache:
  - after the first suspended failure, treat Jamendo as disabled for a short period
  - avoid repeated page refreshes hitting the same upstream failure again and again
- Client fallback:
  - if the current URL is `source=jamendo`
  - and the sources API already returns Jamendo as disabled
  - auto-switch to the first enabled source
  - show a clear but non-blocking message instead of a full-page red upstream error block

**Player Reconstruction**

**Mini Player**

- Turn the outer shell into a large pill-shaped container
- Use a dark blue-green gradient background
- Left area:
  - cover art
  - track title
  - artist
  - current lyric line or subtitle
- Center area:
  - primary progress bar
  - current time / total duration
- Lower or lower-left area:
  - volume button
  - volume slider
  - volume value
- Right area:
  - previous
  - play / pause
  - next
  - stop
  - dismiss
- Keep a dedicated expand-player button at the top

**Expanded Player**

- Reuse the same background, corner radius, outline, and button semantics
- Left side becomes the primary visual area:
  - larger cover art
  - track metadata
  - progress bar
  - main transport controls
  - volume control
  - favorite and play-mode controls
- Right side becomes a secondary area:
  - lyrics
  - queue
- The `Lyrics / Queue` switch remains, but it should no longer render as a visually disconnected giant card

**Visual Constraints**

- White primary play button
- Thin outlined circular buttons for secondary controls
- Thin tracks plus white round thumbs for progress and volume sliders
- Keep title, artist, duration, and primary actions readable first
- On mobile, preserve the same visual language but allow the layout to fold into two or three rows instead of forcing the desktop structure

**Error Handling and Edge Cases**

- Playlist detail load failure:
  - keep the current queue unchanged
  - show a clear error message
- Playlist with no playable tracks:
  - do not start playback
  - do not navigate to detail
  - show “This playlist currently has no playable tracks”
- Jamendo unavailable:
  - the failed source should no longer be enterable
  - if the current page already points at Jamendo, auto-switch the source
- Empty queue:
  - keep the mini player hidden
  - do not force the expanded player open
- Missing lyrics or cover art:
  - keep the existing placeholder behavior
  - do not let the layout collapse

**Testing Plan**

- `src/components/music/MusicPageClient.test.tsx`
  - cover card-body click opening detail
  - cover play-icon click fetching playlist detail and starting full-playlist playback
  - cover auto-switching to an available source when Jamendo is disabled
- `src/app/api/music/routes.test.ts`
  - cover Jamendo suspended responses
  - cover the sources API returning disabled Jamendo
- `src/components/music/MusicPlayerRoot.test.tsx`
  - preserve current playback-chain stability
  - cover expand / collapse / stop / dismiss actions
- Add focused `MusicMiniPlayer` / `MusicFullscreenPlayer` interaction tests when needed:
  - play and pause
  - previous and next
  - queue track switching
  - lyrics / queue switching

**Acceptance Criteria**

- Clicking the playlist play icon starts playlist playback directly without opening the playlist detail page
- Clicking the playlist card body still opens the playlist detail page
- When Jamendo is suspended, the page no longer shows the raw English API failure
- After Jamendo fails, the source degrades automatically and falls back to another available platform
- The mini player structure, control zoning, and visual style are close to the reference
- The expanded player shares the same visual language as the mini player
- Automated tests cover the added critical paths and pass local verification
