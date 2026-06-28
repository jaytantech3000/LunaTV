# LunaTV Music System Rebuild Phase 2 Netease Vertical Slice Design

**Goal**

Build the first real-data vertical slice (纵向切片) on top of the completed Phase 1 shell and playback core, using `Netease` as the first live provider. The official `/music` route must stop relying on `fixture-repository` as the primary runtime path and instead load real home data, real search results, real playlist details, real lyrics, and real audio streams.

**Position In The Full Rewrite**

The full rebuild still consists of five sub-projects:

1. application shell (应用壳层)
2. playback core (播放核心)
3. data domain (数据域)
4. account capabilities (账号能力)
5. desktop integration (桌面集成)

Phase 1 already delivered the minimum working loop for items 1 and 2.  
This design covers **Phase 2 = the first vertical slice of item 3**: use a single live provider first, prove the new architecture, then expand later.

**Why Single-Provider First**

The recommended approach is a `Netease`-only vertical slice rather than rebuilding multiple providers at once:

1. `src/features/music/` already proves that the new shell and new player surfaces work, but the real data domain is still missing.
2. The old `desktop` branch contains the most complete and best-tested music implementation for `Netease`.
3. A single-provider slice proves the new `repository + adapter + route + UI` chain before repeating the migration work for `Audius` and `Jamendo`.
4. The hardest parts (最难路径) already have evidence in the old implementation: search pagination (分页), playlist detail (歌单详情), lyric parsing (歌词解析), and stream proxying (音频流代理).

**In Scope**

- Build a new `Netease` provider layer under `src/features/music/services/providers/netease/`
- Expand the new canonical (统一/规范化) domain models so they can represent live home sections, live search results, playlist detail, lyrics, and playback URLs
- Rebuild `/api/music/*` inside the new architecture
- Rebuild the audio stream proxy under the new music namespace
- Replace fixture-driven UI flows with live-data flows for:
  - `MusicTopBar` search
  - `MusicHero` spotlight / play entry
  - `MusicShell` home sections, search results, and collection detail
  - `MusicMiniPlayer` / `MusicFullPlayer` real track loading and lyric sync
- Keep desktop mode first-class (桌面优先) instead of weakening the design for browser-only convenience

**Out Of Scope**

- No parallel rebuild of `Audius`, `Jamendo`, `QQ`, or `Kugou` in this phase
- No login, favorites, history, daily recommendations, FM, or settings yet
- No tray, download, cache management, or full desktop-system features yet
- No reintroduction of old `src/lib/music/*`, old `music-client`, or old `musicPlayerStore`
- No direct copy-back of the old `netease.ts` into the deleted legacy paths

**Current-State Conclusion**

The `codex/music` branch has already removed:

- old `src/components/music/*`
- old `src/lib/music/*`
- old `src/app/api/music/*`
- old `src/app/media/audio/stream/*`
- old `src/stores/musicPlayerStore*`

It has already added:

- the new `src/features/music/` shell
- the new playback stores
- the new player services
- the new player surfaces
- a working fixture-based smoke path

But three gaps remain:

1. `/music` still uses `fixture-repository` for its main runtime path
2. the player proves structure, not the live `track -> stream -> lyric` chain
3. the old architecture has been removed, but the new live data domain has not replaced it yet

**Evidence From The Old Implementation**

The old `desktop` branch still proves three important facts:

1. the old `Netease` home flow already worked through:
   - `/api/toplist`
   - `/api/personalized/playlist`
   - `/api/playlist/detail`
2. the old search flow already worked through:
   - `/api/search/get/web` for tracks (`type=1`)
   - `/api/search/get/web` for playlists (`type=1000`)
3. audio streaming still needs a server proxy:
   - request `/song/media/outer/url`
   - follow the `302`
   - proxy `range`, `content-range`, `accept-ranges`, and related headers

Conclusion: the new architecture still needs a `streamRepository`, and the new stream route must remain server-proxied rather than exposing final upstream URLs directly to the player.

**Core Design**

1. Keep `src/features/music/` as the only implementation namespace.
2. Build a new provider stack under `services/providers/netease/`:
   - `client`
   - `mappers`
   - `repository`
3. Split the real data domain into focused repositories:
   - `MusicSourceRepository`
   - `MusicDiscoveryRepository`
   - `MusicCollectionRepository`
   - `MusicTrackRepository`
   - `MusicLyricRepository`
   - `MusicStreamRepository`
4. Restore `/api/music/*` as the new public read surface, and move stream proxying into `/api/music/stream`.
5. Do not let frontend components fetch upstream Netease payloads directly; all live data must cross the new repository / API boundaries.
6. Keep `fixture-repository` only as a test or offline fallback, not as the default runtime path.

**Canonical Domain Model**

Phase 2 extends the Phase 1 entities with live-data-focused records:

- `MusicSourceEntity`
- `MusicCollectionSummaryEntity`
- `MusicCollectionEntity`
- `MusicHomeSectionEntity`
- `MusicSearchResultEntity`
- `MusicTrackPlaybackEntity`

The existing rule remains unchanged: provider-specific raw fields must not leak into stores or UI components.

**Repository Boundaries**

The new contracts should be responsibility-based instead of one oversized repository:

- `MusicSourceRepository`
  - `getSources(): Promise<MusicSourceEntity[]>`
- `MusicDiscoveryRepository`
  - `getHomeView(source: MusicSourceKey): Promise<MusicHomeView>`
  - `search(source: MusicSourceKey, query: string, page?: number): Promise<MusicSearchResultEntity>`
- `MusicCollectionRepository`
  - `getCollection(source: MusicSourceKey, id: string): Promise<MusicCollectionEntity>`
- `MusicTrackRepository`
  - `getTrackPlayback(source: MusicSourceKey, id: string, quality?: MusicPlaybackQuality): Promise<MusicTrackPlaybackEntity>`
- `MusicLyricRepository`
  - `getLyrics(source: MusicSourceKey, trackId: string): Promise<LyricDocumentEntity>`
- `MusicStreamRepository`
  - `buildStreamPath(source: MusicSourceKey, trackId: string, quality?: MusicPlaybackQuality): string`
  - `createStreamResponse(request: Request): Promise<Response>`

**API Shape**

Phase 2 restores the live read surface under `/api/music/*`:

- `GET /api/music/sources`
- `GET /api/music/home?source=netease`
- `GET /api/music/search?source=netease&q=<query>&page=<page>`
- `GET /api/music/collection?source=netease&id=<playlistId>`
- `GET /api/music/track?source=netease&id=<trackId>&quality=standard|high`
- `GET /api/music/lyric?source=netease&id=<trackId>`
- `GET /api/music/stream?source=netease&id=<trackId>&quality=standard|high`

Constraints:

- the new routes may only call `src/features/music/services/providers/netease/*`
- they must not re-import deleted `src/lib/music/*`
- the shared error shape remains `{ error: string }`
- the stream route must preserve range-aware (区间请求感知) behavior

**Client Data Flow**

Add one new client-side assembly layer so HTTP details do not spread across components:

- `music-api-client`
  - talks only to `/api/music/*`
- `music-data-store`
  - owns current source, home payload, search state, selected collection, loading state, and error state
- `MusicShell`
  - bootstraps `sources + home`
- `MusicTopBar`
  - submits search
- `MusicHero`
  - plays from real spotlight or real section data instead of fixture assumptions
- `MusicCollectionView`
  - renders live playlist detail and track rows

**Player Wiring Changes**

Playback must move from “queue exists, so play it” to “fetch the real playback payload first”:

1. click a live track from home / search / collection
2. call `trackRepository.getTrackPlayback(...)`
3. write canonical track data and `streamUrl` into `playbackStore`
4. call `lyricRepository.getLyrics(...)`
5. let `audio-engine` load and play

`MusicMiniPlayer`, `MusicFullPlayer`, and `MusicPlayerRoot` must all shift from fixture assumptions to live playback payloads.

**Error Handling**

- Empty search result: return empty arrays and render a `No results` state
- Paid / restricted track: route returns `403`, UI shows recoverable feedback without wiping the queue
- Missing lyrics: return empty `lines`, render an empty-state lyric panel
- Upstream timeout: route returns `502`, `music-data-store.error` stores user-facing copy
- Desktop target: middleware already bypasses web auth in desktop mode, so Phase 2 must not invent a second desktop-only auth path

**Testing Strategy**

Phase 2 should add four test layers:

1. provider / mapper tests
2. route tests
3. store / UI integration tests
4. smoke coverage for `/music` with live Netease-backed flows

**Acceptance Criteria**

- the official `/music` route no longer relies on `fixture-repository` as the primary runtime path
- `/api/music/*` exists again, but its implementation lives fully under `src/features/music/`
- live Netease home, search, playlist, lyric, and stream flows work through the new architecture
- the new player loads real track, stream, and lyric data
- the new implementation does not pull back old `src/lib/music/*`, `music-client`, or `musicPlayerStore`
- automated coverage exists for provider, route, store, UI, and smoke paths

**Later Phases**

- **Phase 3**
  - multi-provider expansion
  - account capabilities
- **Phase 4**
  - desktop-native controls, tray, cache, download, and offline media work

**Milestones**

1. extend the new canonical music domain
2. build the new Netease provider stack
3. rebuild `/api/music/*` and `/api/music/stream`
4. replace fixture-driven `/music` discovery with live data
5. replace fixture-driven playback wiring with live track / lyric / stream data
6. verify the Phase 2 smoke path
