import {
  type MusicCollection,
  type MusicCollectionSummary,
  type MusicHomePayload,
  type MusicHomeSection,
  type MusicLyricLine,
  type MusicLyricPayload,
  type MusicPlatformKey,
  type MusicPlaybackQuality,
  type MusicSearchPayload,
  type MusicSectionTab,
  type MusicSource,
  type MusicTrack,
  type MusicTrackPayload,
} from './types';

const DEFAULT_NETEASE_API_BASE_URL = 'https://music.163.com';
const DEFAULT_WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const NETEASE_REFERER = 'https://music.163.com/';
const NETEASE_SOURCE_KEY: MusicPlatformKey = 'netease';
const NETEASE_SOURCE_NAME = '网易云音乐';
const MUSIC_SOURCE_TABS: MusicSectionTab[] = [
  'home',
  'rank',
  'hot',
  'playlist',
  'search',
];
const DISABLED_MUSIC_SOURCE_TABS: MusicSectionTab[] = ['home', 'search'];
const HOME_TOPLIST_LIMIT = 6;
const HOME_PLAYLIST_LIMIT = 6;
const SEARCH_TRACK_LIMIT = 12;
const SEARCH_PLAYLIST_LIMIT = 6;
const FETCH_TIMEOUT_MS = 15_000;
const SUMMARY_ACCENT_COLORS = [
  '#ff5f6d',
  '#7b61ff',
  '#0ea5e9',
  '#0f766e',
  '#22c55e',
  '#f97316',
];

interface NeteaseArtist {
  id?: number;
  name?: string;
}

interface NeteaseAlbum {
  id?: number;
  name?: string;
  picUrl?: string;
}

interface NeteaseSong {
  id?: number;
  name?: string;
  duration?: number;
  artists?: NeteaseArtist[];
  album?: NeteaseAlbum;
}

interface NeteaseToplist {
  id?: number;
  name?: string;
  coverImgUrl?: string;
  description?: string;
  trackCount?: number;
  updateFrequency?: string;
}

interface NeteaseToplistResponse {
  list?: NeteaseToplist[];
}

interface NeteasePlaylistRecommendation {
  id?: number;
  name?: string;
  picUrl?: string;
  copywriter?: string;
  trackCount?: number;
}

interface NeteasePersonalizedPlaylistResponse {
  result?: NeteasePlaylistRecommendation[];
}

interface NeteaseSearchPlaylist {
  id?: number;
  name?: string;
  coverImgUrl?: string;
  description?: string;
  trackCount?: number;
}

interface NeteaseSearchResult {
  songs?: NeteaseSong[];
  playlists?: NeteaseSearchPlaylist[];
}

interface NeteaseSearchResponse {
  result?: NeteaseSearchResult;
}

interface NeteasePlaylistCreator {
  nickname?: string;
}

interface NeteasePlaylistDetail {
  id?: number;
  name?: string;
  coverImgUrl?: string;
  description?: string;
  trackCount?: number;
  updateFrequency?: string;
  creator?: NeteasePlaylistCreator;
  tracks?: NeteaseSong[];
}

interface NeteasePlaylistDetailResponse {
  result?: NeteasePlaylistDetail;
}

interface NeteaseSongDetailResponse {
  songs?: NeteaseSong[];
}

interface NeteaseLyricBlock {
  lyric?: string;
}

interface NeteaseLyricResponse {
  lrc?: NeteaseLyricBlock;
  tlyric?: NeteaseLyricBlock;
}

export class MusicApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MusicApiError';
    this.status = status;
  }
}

function createNoStoreHeaders(headersInit?: HeadersInit): Headers {
  const headers = new Headers(headersInit);
  headers.set('Cache-Control', 'no-store');
  return headers;
}

export function createMusicJsonResponse(
  body: unknown,
  init?: ResponseInit
): Response {
  const headers = createNoStoreHeaders(init?.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function createMusicErrorResponse(
  error: unknown,
  fallbackMessage: string
): Response {
  if (error instanceof MusicApiError) {
    if (error.status >= 500) {
      // eslint-disable-next-line no-console
      console.error(fallbackMessage, error);
    }

    return createMusicJsonResponse(
      {
        error: error.message,
      },
      {
        status: error.status,
      }
    );
  }

  // eslint-disable-next-line no-console
  console.error(fallbackMessage, error);
  return createMusicJsonResponse(
    {
      error: fallbackMessage,
    },
    {
      status: 500,
    }
  );
}

function normalizeOptionalText(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeRemoteUrl(
  url: string | null | undefined
): string | undefined {
  const normalized = normalizeOptionalText(url);
  if (!normalized) {
    return undefined;
  }

  return normalized;
}

function createRequestHeaders(range?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Referer: NETEASE_REFERER,
    'User-Agent': DEFAULT_WEB_UA,
  };

  const normalizedRange = normalizeOptionalText(range);
  if (normalizedRange) {
    headers.Range = normalizedRange;
  }

  return headers;
}

function getNeteaseApiBaseUrl(): string {
  return (
    normalizeOptionalText(process.env.NETEASE_API_BASE_URL) ||
    DEFAULT_NETEASE_API_BASE_URL
  ).replace(/\/+$/, '');
}

function buildNeteaseUrl(
  pathname: string,
  searchParams?: Record<string, string>
): string {
  const url = new URL(`${getNeteaseApiBaseUrl()}${pathname}`);
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  return url.toString();
}

async function fetchNeteaseJson<T>(
  pathname: string,
  searchParams?: Record<string, string>
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(buildNeteaseUrl(pathname, searchParams), {
      cache: 'no-store',
      headers: createRequestHeaders(),
      signal: controller.signal,
    });
  } catch (error) {
    throw new MusicApiError(
      error instanceof Error
        ? `音乐上游请求失败: ${error.message}`
        : '音乐上游请求失败',
      502
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new MusicApiError('音乐上游请求失败', 502);
  }

  return (await response.json()) as T;
}

function resolveSource(source: string | null | undefined): MusicPlatformKey {
  const normalizedSource = normalizeOptionalText(source) || NETEASE_SOURCE_KEY;

  if (normalizedSource !== NETEASE_SOURCE_KEY) {
    throw new MusicApiError('Unsupported music source', 400);
  }

  return NETEASE_SOURCE_KEY;
}

function resolveQuality(
  quality: string | null | undefined
): MusicPlaybackQuality {
  return quality === 'high' ? 'high' : 'standard';
}

function requireQueryValue(
  value: string | null | undefined,
  errorMessage: string
): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new MusicApiError(errorMessage, 400);
  }

  return normalized;
}

function requireNumericId(
  value: string | null | undefined,
  label: string
): number {
  const normalized = requireQueryValue(value, `缺少${label} id`);
  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new MusicApiError(`无效的${label} id`, 400);
  }

  return parsed;
}

function pickAccentColor(index: number): string {
  return SUMMARY_ACCENT_COLORS[index % SUMMARY_ACCENT_COLORS.length];
}

function toMusicTrack(song: NeteaseSong): MusicTrack {
  const albumTitle = normalizeOptionalText(song.album?.name);
  const cover = normalizeRemoteUrl(song.album?.picUrl);

  return {
    album: albumTitle
      ? {
          cover,
          id: song.album?.id ? String(song.album.id) : undefined,
          title: albumTitle,
        }
      : undefined,
    artists:
      song.artists
        ?.map((artist) => {
          const name = normalizeOptionalText(artist.name);
          if (!name) {
            return null;
          }

          return {
            id: artist.id ? String(artist.id) : undefined,
            name,
          };
        })
        .filter((artist): artist is NonNullable<typeof artist> =>
          Boolean(artist)
        ) || [],
    cover,
    durationMs:
      typeof song.duration === 'number' && song.duration > 0
        ? song.duration
        : undefined,
    id:
      typeof song.id === 'number' && Number.isFinite(song.id)
        ? String(song.id)
        : '',
    playable: true,
    source: NETEASE_SOURCE_KEY,
    subtitle: albumTitle,
    title: normalizeOptionalText(song.name) || '未知曲目',
  };
}

function toToplistSummary(
  item: NeteaseToplist,
  index: number
): MusicCollectionSummary {
  return {
    accentColor: pickAccentColor(index),
    cover: normalizeRemoteUrl(item.coverImgUrl),
    description: normalizeOptionalText(item.description),
    id: String(item.id || ''),
    kind: 'rank',
    source: NETEASE_SOURCE_KEY,
    title: normalizeOptionalText(item.name) || '官方榜单',
    trackCount:
      typeof item.trackCount === 'number' && item.trackCount >= 0
        ? item.trackCount
        : undefined,
  };
}

function toPlaylistSummary(
  item: NeteasePlaylistRecommendation,
  index: number
): MusicCollectionSummary {
  return {
    accentColor: pickAccentColor(index + 1),
    cover: normalizeRemoteUrl(item.picUrl),
    description: normalizeOptionalText(item.copywriter),
    id: String(item.id || ''),
    kind: 'playlist',
    source: NETEASE_SOURCE_KEY,
    title: normalizeOptionalText(item.name) || '推荐歌单',
    trackCount:
      typeof item.trackCount === 'number' && item.trackCount >= 0
        ? item.trackCount
        : undefined,
  };
}

function toSearchPlaylistSummary(
  item: NeteaseSearchPlaylist,
  index: number
): MusicCollectionSummary {
  return {
    accentColor: pickAccentColor(index + 2),
    cover: normalizeRemoteUrl(item.coverImgUrl),
    description: normalizeOptionalText(item.description),
    id: String(item.id || ''),
    kind: 'playlist',
    source: NETEASE_SOURCE_KEY,
    title: normalizeOptionalText(item.name) || '搜索歌单',
    trackCount:
      typeof item.trackCount === 'number' && item.trackCount >= 0
        ? item.trackCount
        : undefined,
  };
}

function normalizePage(page: string | null | undefined): number {
  const parsed = Number.parseInt(page || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

async function fetchToplists(): Promise<NeteaseToplist[]> {
  const payload = await fetchNeteaseJson<NeteaseToplistResponse>(
    '/api/toplist'
  );
  return payload.list || [];
}

async function fetchRecommendedPlaylists(): Promise<
  NeteasePlaylistRecommendation[]
> {
  const payload = await fetchNeteaseJson<NeteasePersonalizedPlaylistResponse>(
    '/api/personalized/playlist',
    {
      limit: String(HOME_PLAYLIST_LIMIT),
    }
  );

  return payload.result || [];
}

async function fetchSearchTracks(
  query: string,
  page: number
): Promise<NeteaseSong[]> {
  const offset = (page - 1) * SEARCH_TRACK_LIMIT;
  const payload = await fetchNeteaseJson<NeteaseSearchResponse>(
    '/api/search/get/web',
    {
      csrf_token: '',
      limit: String(SEARCH_TRACK_LIMIT),
      offset: String(offset),
      s: query,
      type: '1',
    }
  );

  return payload.result?.songs || [];
}

async function fetchSearchPlaylists(
  query: string,
  page: number
): Promise<NeteaseSearchPlaylist[]> {
  const offset = (page - 1) * SEARCH_PLAYLIST_LIMIT;
  const payload = await fetchNeteaseJson<NeteaseSearchResponse>(
    '/api/search/get/web',
    {
      csrf_token: '',
      limit: String(SEARCH_PLAYLIST_LIMIT),
      offset: String(offset),
      s: query,
      type: '1000',
    }
  );

  return payload.result?.playlists || [];
}

async function fetchPlaylistDetail(
  playlistId: number
): Promise<NeteasePlaylistDetail> {
  const payload = await fetchNeteaseJson<NeteasePlaylistDetailResponse>(
    '/api/playlist/detail',
    {
      id: String(playlistId),
    }
  );

  if (!payload.result) {
    throw new MusicApiError('合集不存在', 404);
  }

  return payload.result;
}

async function fetchSongDetail(trackId: number): Promise<NeteaseSong> {
  const payload = await fetchNeteaseJson<NeteaseSongDetailResponse>(
    '/api/song/detail',
    {
      ids: `[${trackId}]`,
    }
  );

  const song = payload.songs?.[0];
  if (!song) {
    throw new MusicApiError('曲目不存在', 404);
  }

  return song;
}

async function fetchLyric(trackId: number): Promise<NeteaseLyricResponse> {
  return fetchNeteaseJson<NeteaseLyricResponse>('/api/song/lyric', {
    id: String(trackId),
    lv: '-1',
    tv: '-1',
  });
}

export function getMusicSourcesPayload(): { sources: MusicSource[] } {
  return {
    sources: [
      {
        description: 'Web 与桌面模式都已接入真实网易云公开数据。',
        enabled: true,
        key: NETEASE_SOURCE_KEY,
        name: NETEASE_SOURCE_NAME,
        provider: NETEASE_SOURCE_KEY,
        tabs: MUSIC_SOURCE_TABS,
      },
      {
        description: '接入中，暂未开放。',
        enabled: false,
        key: 'qq',
        name: 'QQ 音乐',
        provider: 'qq',
        tabs: DISABLED_MUSIC_SOURCE_TABS,
      },
      {
        description: '接入中，暂未开放。',
        enabled: false,
        key: 'kugou',
        name: '酷狗音乐',
        provider: 'kugou',
        tabs: DISABLED_MUSIC_SOURCE_TABS,
      },
    ],
  };
}

export async function getMusicHomePayload(params: {
  source: string | null | undefined;
}): Promise<MusicHomePayload> {
  resolveSource(params.source);

  const toplists = await fetchToplists();
  const playlists = await fetchRecommendedPlaylists();
  const spotlight =
    typeof toplists[0]?.id === 'number'
      ? (await fetchPlaylistDetail(toplists[0].id)).tracks
          ?.slice(0, 8)
          .map(toMusicTrack) || []
      : [];
  const hotDescription = toplists[0]
    ? `来自 ${normalizeOptionalText(toplists[0].name) || '官方榜单'} · ${
        normalizeOptionalText(toplists[0].updateFrequency) || '实时更新'
      }`
    : '来自网易云公开榜单。';

  const sections: MusicHomeSection[] = [
    {
      collections: toplists
        .slice(0, HOME_TOPLIST_LIMIT)
        .map((item, index) => toToplistSummary(item, index)),
      description: '直接取自网易云公开榜单接口。',
      id: 'netease-rank',
      kind: 'collection-list',
      tab: 'rank',
      title: '官方榜单',
    },
    {
      description: hotDescription,
      id: 'netease-hot',
      kind: 'track-list',
      tab: 'hot',
      title: '热门单曲',
      tracks: spotlight,
    },
    {
      collections: playlists
        .slice(0, HOME_PLAYLIST_LIMIT)
        .map((item, index) => toPlaylistSummary(item, index)),
      description: '来自网易云公开推荐歌单接口。',
      id: 'netease-playlist',
      kind: 'collection-list',
      tab: 'playlist',
      title: '推荐歌单',
    },
  ];

  return {
    source: NETEASE_SOURCE_KEY,
    spotlight,
    sections,
  };
}

export async function getMusicSearchPayload(params: {
  page: string | null | undefined;
  query: string | null | undefined;
  source: string | null | undefined;
}): Promise<MusicSearchPayload> {
  resolveSource(params.source);

  const query = normalizeOptionalText(params.query) || '';
  if (!query) {
    return {
      collections: [],
      query,
      source: NETEASE_SOURCE_KEY,
      tracks: [],
    };
  }

  const page = normalizePage(params.page);
  const [tracks, collections] = await Promise.all([
    fetchSearchTracks(query, page),
    fetchSearchPlaylists(query, page),
  ]);

  return {
    collections: collections
      .slice(0, SEARCH_PLAYLIST_LIMIT)
      .map((item, index) => toSearchPlaylistSummary(item, index)),
    query,
    source: NETEASE_SOURCE_KEY,
    tracks: tracks.slice(0, SEARCH_TRACK_LIMIT).map(toMusicTrack),
  };
}

export async function getMusicCollectionPayload(params: {
  id: string | null | undefined;
  source: string | null | undefined;
}): Promise<MusicCollection> {
  resolveSource(params.source);

  const playlistId = requireNumericId(params.id, '合集');
  const playlist = await fetchPlaylistDetail(playlistId);

  return {
    accentColor: pickAccentColor(0),
    cover: normalizeRemoteUrl(playlist.coverImgUrl),
    curator: normalizeOptionalText(playlist.creator?.nickname),
    description: normalizeOptionalText(playlist.description),
    id: String(playlist.id || playlistId),
    kind: 'playlist',
    source: NETEASE_SOURCE_KEY,
    title: normalizeOptionalText(playlist.name) || '歌单详情',
    trackCount:
      typeof playlist.trackCount === 'number' && playlist.trackCount >= 0
        ? playlist.trackCount
        : undefined,
    tracks: playlist.tracks?.map(toMusicTrack) || [],
    updatedAtLabel: normalizeOptionalText(playlist.updateFrequency),
  };
}

export async function getMusicTrackPayload(params: {
  id: string | null | undefined;
  quality: string | null | undefined;
  source: string | null | undefined;
}): Promise<MusicTrackPayload> {
  resolveSource(params.source);

  const trackId = requireNumericId(params.id, '曲目');
  const quality = resolveQuality(params.quality);
  const song = await fetchSongDetail(trackId);

  return {
    quality,
    streamUrl: `/media/audio/stream?source=${NETEASE_SOURCE_KEY}&id=${trackId}&quality=${quality}`,
    track: toMusicTrack(song),
  };
}

function parseLrcTimestamp(timestamp: string): number | null {
  const [minutePart, secondPart] = timestamp.split(':');
  if (!minutePart || !secondPart) {
    return null;
  }

  const minutes = Number.parseInt(minutePart, 10);
  if (!Number.isFinite(minutes)) {
    return null;
  }

  const [secondsRaw, fractionRaw = '0'] = secondPart.split('.');
  const seconds = Number.parseInt(secondsRaw, 10);
  if (!Number.isFinite(seconds)) {
    return null;
  }

  const normalizedFraction = fractionRaw.padEnd(3, '0').slice(0, 3);
  const milliseconds = Number.parseInt(normalizedFraction, 10);
  if (!Number.isFinite(milliseconds)) {
    return null;
  }

  return minutes * 60_000 + seconds * 1_000 + milliseconds;
}

function parseLrcLines(content: string | null | undefined): MusicLyricLine[] {
  const lines: MusicLyricLine[] = [];

  for (const rawLine of (content || '').split('\n')) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) {
      continue;
    }

    let cursor = trimmedLine;
    const timestamps: number[] = [];

    while (cursor.startsWith('[')) {
      const closingIndex = cursor.indexOf(']');
      if (closingIndex === -1) {
        break;
      }

      const timestamp = cursor.slice(1, closingIndex);
      const timeMs = parseLrcTimestamp(timestamp);
      if (timeMs === null) {
        break;
      }

      timestamps.push(timeMs);
      cursor = cursor.slice(closingIndex + 1);
    }

    const text = cursor.trim();
    if (!timestamps.length || !text) {
      continue;
    }

    timestamps.forEach((timeMs) => {
      lines.push({
        text,
        timeMs,
      });
    });
  }

  return lines.sort((left, right) => left.timeMs - right.timeMs);
}

export async function getMusicLyricPayload(params: {
  id: string | null | undefined;
  source: string | null | undefined;
}): Promise<MusicLyricPayload> {
  resolveSource(params.source);

  const trackId = requireNumericId(params.id, '曲目');
  const lyric = await fetchLyric(trackId);
  const translationMap = new Map<number, string>();

  parseLrcLines(lyric.tlyric?.lyric).forEach((line) => {
    translationMap.set(line.timeMs, line.text);
  });

  const lines = parseLrcLines(lyric.lrc?.lyric).map((line) => ({
    ...line,
    translation: translationMap.get(line.timeMs),
  }));

  return {
    lines,
    source: NETEASE_SOURCE_KEY,
    trackId: String(trackId),
  };
}

function withCorsHeaders(headers: Headers): void {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Range, Origin, Accept'
  );
  headers.set(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type'
  );
}

function copyHeader(
  from: Headers,
  to: Headers,
  sourceKey: string,
  targetKey = sourceKey
): void {
  const value = from.get(sourceKey);
  if (value) {
    to.set(targetKey, value);
  }
}

function shouldForwardContentLength(headers: Headers): boolean {
  return !headers.has('content-encoding');
}

function resolveAudioRedirectLocation(
  redirectResponse: Response,
  location: string
): string {
  try {
    return new URL(location).toString();
  } catch {
    const baseUrl =
      normalizeOptionalText(redirectResponse.url) || getNeteaseApiBaseUrl();
    return new URL(location, `${baseUrl}/`).toString();
  }
}

export async function getMusicAudioStreamResponse(
  request: Request
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const searchParams = requestUrl.searchParams;

  resolveSource(searchParams.get('source'));
  const trackId = requireNumericId(searchParams.get('id'), '曲目');
  const range = request.headers.get('range');

  const redirectController = new AbortController();
  const redirectTimeoutId = setTimeout(
    () => redirectController.abort(),
    FETCH_TIMEOUT_MS
  );
  let redirectResponse: Response;
  try {
    redirectResponse = await fetch(
      buildNeteaseUrl('/song/media/outer/url', {
        id: `${trackId}.mp3`,
      }),
      {
        cache: 'no-store',
        headers: createRequestHeaders(),
        redirect: 'manual',
        signal: redirectController.signal,
      }
    );
  } catch (error) {
    throw new MusicApiError(
      error instanceof Error
        ? `音频地址解析失败: ${error.message}`
        : '音频地址解析失败',
      502
    );
  } finally {
    clearTimeout(redirectTimeoutId);
  }

  const redirectLocation = redirectResponse.headers.get('location');
  const normalizedRedirectLocation = normalizeOptionalText(redirectLocation);
  const upstreamUrl =
    redirectResponse.status >= 300 &&
    redirectResponse.status < 400 &&
    normalizedRedirectLocation
      ? resolveAudioRedirectLocation(
          redirectResponse,
          normalizedRedirectLocation
        )
      : redirectResponse.url;

  if (!normalizeOptionalText(upstreamUrl)) {
    throw new MusicApiError('音频地址解析失败', 502);
  }

  const streamController = new AbortController();
  const streamTimeoutId = setTimeout(
    () => streamController.abort(),
    FETCH_TIMEOUT_MS
  );
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      cache: 'no-store',
      headers: createRequestHeaders(range),
      signal: streamController.signal,
    });
  } catch (error) {
    throw new MusicApiError(
      error instanceof Error
        ? `音频流获取失败: ${error.message}`
        : '音频流获取失败',
      502
    );
  } finally {
    clearTimeout(streamTimeoutId);
  }

  if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
    throw new MusicApiError('音频流获取失败', 502);
  }

  const headers = new Headers();
  withCorsHeaders(headers);
  headers.set('Cache-Control', 'no-store');
  copyHeader(upstreamResponse.headers, headers, 'content-type', 'Content-Type');
  if (shouldForwardContentLength(upstreamResponse.headers)) {
    copyHeader(
      upstreamResponse.headers,
      headers,
      'content-length',
      'Content-Length'
    );
  }
  copyHeader(
    upstreamResponse.headers,
    headers,
    'content-range',
    'Content-Range'
  );
  copyHeader(
    upstreamResponse.headers,
    headers,
    'accept-ranges',
    'Accept-Ranges'
  );

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'audio/mpeg');
  }
  if (!headers.has('Accept-Ranges')) {
    headers.set('Accept-Ranges', 'bytes');
  }

  return new Response(upstreamResponse.body, {
    headers,
    status: upstreamResponse.status,
  });
}
