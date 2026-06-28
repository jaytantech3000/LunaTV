# LunaTV Music Phase 4a Desktop Download / Offline Cache Design

**Goal**

Add a desktop-first manual download (手动下载) plus local-first playback (本地优先播放) loop to the rebuilt `/music` flow: users can download a single track or a whole collection into an app-managed directory (应用托管目录), keep the records across relaunches, and prefer the local file during playback.

**Position In The Full Rebuild**

The full rebuild still moves through five sub-projects:

1. App shell
2. Playback core
3. Data domain
4. Account capability
5. Desktop integration

Phase 1 finished the shell and playback skeleton.
Phase 2 finished the live `Netease` vertical slice (纵切).
Phase 3a finished QR account login.
Phase 3b finished playback session restore.
This design covers **Phase 4a = desktop download / offline cache MVP**, the next desktop loop between playback core and desktop integration.

**Why Now**

The rebuilt music system already has:

1. Live home, search, collection, lyrics, FM, and daily tracks
2. Local library, favorites, and continue-listening records
3. Desktop preferences persistence, tray, shortcuts, and session restore

But it still misses one obvious desktop capability:

- users cannot keep playing tracks they explicitly chose to keep when they are offline

Without that, the desktop app still feels like an online web shell (网页壳), not a resident desktop player.

**In Scope**

- Manual single-track download
- Collection-level `Download all`
- All files stored under an app-managed directory
- Local persistence for download records, status, progress, and file paths
- Local file preferred during playback
- Remote `streamUrl` fallback (回退) when the local file is unavailable
- Explicit unsupported copy in non-desktop environments

**Out Of Scope**

- User-selected download directory
- Automatic recent-play cache
- Resume / resumable download (断点续传)
- Quota, eviction, or storage-cleanup policy
- Offline lyrics storage
- Cross-device sync for download records
- A global offline-mode switch

**Current-State Conclusion**

There are already four reusable foundations:

1. [MusicPlayerRoot](/Users/jay/Code/LunaTV/src/features/music/components/MusicPlayerRoot.tsx)
   - already owns audio, stream hydration (流地址补齐), lyrics, and desktop hooks
2. [MusicCollectionView](/Users/jay/Code/LunaTV/src/features/music/components/MusicCollectionView.tsx)
   - already exposes collection-level action entry points
3. [MusicFullPlayer](/Users/jay/Code/LunaTV/src/features/music/components/MusicFullPlayer.tsx)
   - already exposes single-track action entry points
4. [tauri-client](/Users/jay/Code/LunaTV/src/lib/desktop/tauri-client.ts) + [src-tauri/lib.rs](/Users/jay/Code/LunaTV/src-tauri/src/lib.rs)
   - already provide mature IPC, app-data directory resolution, and file-write patterns

Conclusion:

- the missing part is not UI scaffolding, but the loop between download records, local files, and playback priority

**Core Approach**

1. Add a dedicated `music-download` domain instead of mixing with `playRecords`, `preferences`, or `playbackSession`
2. Let Tauri own:
   - app-data directory resolution
   - audio-file download
   - `music-downloads.json` persistence
   - local file path resolution
3. Add a frontend download store to:
   - hydrate existing download records
   - track UI state for batch downloads
   - expose whether a track is already downloaded
4. Add local-first playback resolution:
   - check local download records first
   - if present, play a Tauri `asset` URL
   - otherwise keep using the current remote `track` API for `streamUrl`
5. Keep batch download simple:
   - frontend triggers single-track downloads one by one
   - each track persists its own status

**Why Not Reuse The Existing Video Download System**

The existing `src/lib/download/*` stack is for `m3u8` / segment / resource-index video offline flows:

- its data model is built around `manifest / segment / key / map`
- its runtime is built around browser cache and a local download runtime
- its target object is an episode / resource index, not a single audio file

The music MVP only needs:

- one remote audio URL
- one local file
- one compact record

Reusing the video system now would pull in premature complexity and violate KISS / YAGNI.

**New Data Model**

Recommended addition:

```ts
interface MusicDownloadRecord {
  downloadId: string;
  track: MusicTrackEntity;
  quality: MusicPlaybackQuality;
  status: 'idle' | 'downloading' | 'downloaded' | 'failed';
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number;
  localFilePath: string | null;
  errorMessage: string | null;
  downloadedAt: number | null;
  updatedAt: number;
}
```

Explicit constraints:

- `downloadId = ${source}:${trackId}:${quality}`
- never persist `track.stream`
- `localFilePath` is trusted only in `downloaded` state
- startup normalizes stale `downloading` records into `failed`
- missing local files downgrade the record to `failed`

**Directory Layout**

Recommended layout:

```text
<app-data-dir>/
  music/
    downloads/
      records.json
      audio/
        netease-9001-high-7f2a8f9c.audio
```

Why:

- it stays inside the app data boundary
- it leaves room for later cleanup features
- it avoids path-picker, permission, and cross-platform complexity in the MVP

**Frontend Boundary**

Add service-level capabilities:

- `hydrateMusicDownloads()`
- `downloadMusicTrack()`
- `downloadMusicCollectionTracks()`
- `removeMusicDownload()`
- `resolveDownloadedMusicTrackPlaybackUrl()`

The new store should only manage:

- the download-record map
- hydration state
- current batch-download busy state

Real file I/O should stay out of the frontend.

**Tauri IPC Boundary**

Recommended commands:

- `list_music_downloads`
- `download_music_track`
- `delete_music_download`
- `resolve_music_download_playback`

Behavior:

- `list_music_downloads`
  - returns all current download records
- `download_music_track`
  - accepts a track snapshot, quality, and remote download URL
  - writes record updates while downloading
  - returns the final record on success
- `delete_music_download`
  - removes the file and the record
- `resolve_music_download_playback`
  - checks whether the target file exists
  - returns the file path when present
  - repairs the record and returns empty when missing

**Player Integration**

`MusicPlayerRoot` should switch to this order:

1. read the current track
2. try resolving a local downloaded file first
3. if found:
   - convert it into a Tauri `asset` URL
   - write it back into `track.stream`
   - keep the current audio / seek / session flow
4. if not found:
   - keep using `fetchMusicTrackPlayback`
5. lyrics still come from the existing API and are not cached offline

Key constraint:

- local-first only changes the audio stream source, not lyric or metadata ownership
- failure to resolve a local file must never block online playback

**UI Entry Points**

The first cut only adds three surfaces:

1. `MusicCollectionView`
   - add `Download all`
   - add `Download` / `Downloaded` per row
2. `MusicFullPlayer`
   - add `Download` / `Delete download` for the current track
3. `MusicLibraryView`
   - add an `Offline downloads` section with directly playable downloaded tracks

The settings view may show download count only; it does not manage directories yet.

**Error Handling**

- download request fails:
  - persist `failed`
  - keep an error message
  - do not block the page
- local file delete fails:
  - keep the record and expose the error
- local file resolution fails:
  - fall back to remote stream
  - repair the local record status
- non-desktop environment triggers download:
  - return a desktop-only message immediately

**Testing Requirements**

Frontend service / store:

- record sanitization clears `stream`
- browser-preview environments reject desktop download
- batch download persists records one track at a time

Tauri:

- creates the app-managed directory
- writes both the audio file and `records.json`
- downgrades to `failed` when the file is missing
- delete removes both file and record

Player:

- downloaded tracks prefer the local file
- missing local files fall back to remote `streamUrl`

UI:

- collection, full-player, and library surfaces expose download actions
- downloaded-state copy stays stable

**Acceptance Criteria**

- the desktop app can download a single track and still recognize it after relaunch
- collection pages can trigger batch download
- downloaded tracks prefer local files during playback
- missing local files still allow online playback
- all download files live under the app-managed directory
- the first cut does not introduce custom directories, auto-cache, or resumable downloads
