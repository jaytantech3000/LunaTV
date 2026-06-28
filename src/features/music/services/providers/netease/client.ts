import QRCode from 'qrcode';

import type { MusicPlaybackQuality } from '../../../domain/entities';

const DEFAULT_NETEASE_API_BASE_URL = 'https://music.163.com';
const DEFAULT_WEB_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const NETEASE_REFERER = 'https://music.163.com/';
const HOME_PLAYLIST_LIMIT = 6;
const HOME_ALBUM_LIMIT = 6;
const SEARCH_TRACK_LIMIT = 12;
const SEARCH_PLAYLIST_LIMIT = 6;
const SEARCH_ALBUM_LIMIT = 6;
const SEARCH_ARTIST_LIMIT = 6;
const FETCH_TIMEOUT_MS = 15_000;

export interface NeteaseArtistPayload {
  id?: number;
  name?: string;
}

export interface NeteaseAlbumPayload {
  id?: number;
  name?: string;
  picUrl?: string;
}

export interface NeteaseNewestAlbumPayload {
  id?: number;
  name?: string;
  picUrl?: string;
  size?: number;
  artist?: NeteaseArtistPayload;
  artists?: NeteaseArtistPayload[];
}

export interface NeteaseSongPayload {
  id?: number;
  name?: string;
  fee?: number;
  duration?: number;
  dt?: number;
  artists?: NeteaseArtistPayload[];
  ar?: NeteaseArtistPayload[];
  album?: NeteaseAlbumPayload;
  al?: NeteaseAlbumPayload;
}

export interface NeteaseToplistPayload {
  id?: number;
  name?: string;
  coverImgUrl?: string;
  description?: string;
  trackCount?: number;
  updateFrequency?: string;
}

export interface NeteaseToplistResponse {
  code?: number;
  list?: NeteaseToplistPayload[];
  msg?: string;
  message?: string;
}

export interface NeteasePlaylistRecommendationPayload {
  id?: number;
  name?: string;
  picUrl?: string;
  copywriter?: string;
  trackCount?: number;
}

export interface NeteasePersonalizedPlaylistResponse {
  code?: number;
  msg?: string;
  message?: string;
  result?: NeteasePlaylistRecommendationPayload[];
}

export interface NeteaseNewestAlbumResponse {
  code?: number;
  msg?: string;
  message?: string;
  albums?: NeteaseNewestAlbumPayload[];
}

export interface NeteaseSearchPlaylistPayload {
  id?: number;
  name?: string;
  coverImgUrl?: string;
  description?: string;
  trackCount?: number;
}

export interface NeteaseSearchAlbumPayload {
  id?: number;
  name?: string;
  picUrl?: string;
  size?: number;
  artist?: NeteaseArtistPayload;
  artists?: NeteaseArtistPayload[];
}

export interface NeteaseSearchArtistPayload {
  id?: number;
  name?: string;
  picUrl?: string;
  albumSize?: number;
  musicSize?: number;
}

export interface NeteaseSearchResponse {
  code?: number;
  msg?: string;
  message?: string;
  result?: {
    songs?: NeteaseSongPayload[];
    playlists?: NeteaseSearchPlaylistPayload[];
    albums?: NeteaseSearchAlbumPayload[];
    artists?: NeteaseSearchArtistPayload[];
  };
}

export interface NeteasePlaylistDetailPayload {
  id?: number;
  name?: string;
  coverImgUrl?: string;
  description?: string;
  trackCount?: number;
  updateFrequency?: string;
  creator?: {
    nickname?: string;
  };
  tracks?: NeteaseSongPayload[];
}

export interface NeteasePlaylistDetailResponse {
  code?: number;
  msg?: string;
  message?: string;
  result?: NeteasePlaylistDetailPayload;
}

export interface NeteaseAlbumDetailPayload {
  id?: number;
  name?: string;
  picUrl?: string;
  description?: string;
  size?: number;
  company?: string;
  artist?: NeteaseArtistPayload;
  artists?: NeteaseArtistPayload[];
}

export interface NeteaseAlbumDetailResponse {
  code?: number;
  msg?: string;
  message?: string;
  album?: NeteaseAlbumDetailPayload;
  songs?: NeteaseSongPayload[];
}

export interface NeteaseArtistAlbumsResponse {
  code?: number;
  msg?: string;
  message?: string;
  hotAlbums?: NeteaseSearchAlbumPayload[];
}

export interface NeteaseSongDetailResponse {
  code?: number;
  msg?: string;
  message?: string;
  songs?: NeteaseSongPayload[];
}

export interface NeteaseDailyRecommendationResponse {
  code?: number;
  msg?: string;
  message?: string;
  data?: {
    dailySongs?: NeteaseSongPayload[];
  };
}

export interface NeteasePersonalFmResponse {
  code?: number;
  msg?: string;
  message?: string;
  data?: NeteaseSongPayload[];
}

export interface NeteaseRecentTrackItemPayload {
  resourceId?: number | string;
  playTime?: number;
  playtime?: number;
  data?: NeteaseSongPayload | null;
  song?: NeteaseSongPayload | null;
}

export interface NeteaseRecentTrackResponse {
  code?: number;
  msg?: string;
  message?: string;
  data?:
    | {
        list?: NeteaseRecentTrackItemPayload[];
      }
    | NeteaseRecentTrackItemPayload[];
}

export interface NeteaseAccountProfilePayload {
  userId?: number;
  nickname?: string;
  avatarUrl?: string;
  signature?: string;
}

export interface NeteaseAccountResponse {
  code?: number;
  msg?: string;
  message?: string;
  account?: {
    id?: number;
  } | null;
  profile?: NeteaseAccountProfilePayload | null;
}

export interface NeteaseUserPlaylistPayload {
  id?: number;
  name?: string;
  specialType?: number;
  coverImgUrl?: string;
  description?: string;
  trackCount?: number;
  creator?: {
    userId?: number;
    nickname?: string;
  };
}

export interface NeteaseUserPlaylistResponse {
  code?: number;
  msg?: string;
  message?: string;
  more?: boolean;
  playlist?: NeteaseUserPlaylistPayload[];
}

export interface NeteaseQrLoginKeyResponse {
  code?: number;
  msg?: string;
  message?: string;
  data?: {
    unikey?: string;
  };
}

export interface NeteaseQrLoginStatusResponse {
  code?: 800 | 801 | 802 | 803;
  msg?: string;
  message?: string;
  cookie?: string;
}

export interface NeteaseLyricPayload {
  lyric?: string;
}

export interface NeteaseLyricResponse {
  code?: number;
  msg?: string;
  message?: string;
  lrc?: NeteaseLyricPayload;
  tlyric?: NeteaseLyricPayload;
}

export class NeteaseApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'NeteaseApiError';
    this.status = status;
  }
}

function normalizeOptionalText(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function createRequestHeaders(
  range?: string | null,
  cookieHeader?: string | null
): Record<string, string> {
  const headers: Record<string, string> = {
    Referer: NETEASE_REFERER,
    'User-Agent': DEFAULT_WEB_USER_AGENT,
  };
  const normalizedRange = normalizeOptionalText(range);
  const normalizedCookieHeader = normalizeOptionalText(cookieHeader);

  if (normalizedRange) {
    headers.Range = normalizedRange;
  }

  if (normalizedCookieHeader) {
    headers.Cookie = normalizedCookieHeader;
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

function resolveNeteaseErrorStatus(code: number | undefined): number {
  if (code === -110) {
    return 403;
  }

  return 502;
}

function resolveNeteaseErrorMessage(
  payload: { msg?: string; message?: string },
  fallbackMessage: string
): string {
  return (
    normalizeOptionalText(payload.message) ||
    normalizeOptionalText(payload.msg) ||
    fallbackMessage
  );
}

function assertNeteaseSuccess(
  payload: { code?: number; msg?: string; message?: string },
  fallbackMessage: string
): void {
  if (typeof payload.code !== 'number' || payload.code === 200) {
    return;
  }

  throw new NeteaseApiError(
    resolveNeteaseErrorMessage(payload, fallbackMessage),
    resolveNeteaseErrorStatus(payload.code)
  );
}

async function fetchNeteaseJson<T>(
  pathname: string,
  searchParams?: Record<string, string>,
  options?: {
    cookieHeader?: string | null;
    method?: 'GET' | 'POST';
  }
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(buildNeteaseUrl(pathname, searchParams), {
      cache: 'no-store',
      headers: createRequestHeaders(undefined, options?.cookieHeader),
      method: options?.method || 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new NeteaseApiError('音乐上游请求失败', 502);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof NeteaseApiError) {
      throw error;
    }

    throw new NeteaseApiError(
      error instanceof Error
        ? `音乐上游请求失败: ${error.message}`
        : '音乐上游请求失败',
      502
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export function resolvePlaybackQuality(
  quality: string | null | undefined
): MusicPlaybackQuality {
  return quality === 'high' ? 'high' : 'standard';
}

function requireNumericId(
  value: string | null | undefined,
  label: string
): number {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new NeteaseApiError(`缺少${label} id`, 400);
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new NeteaseApiError(`无效的${label} id`, 400);
  }

  return parsed;
}

export async function fetchToplists(): Promise<NeteaseToplistPayload[]> {
  const payload = await fetchNeteaseJson<NeteaseToplistResponse>(
    '/api/toplist'
  );

  assertNeteaseSuccess(payload, '获取榜单失败');
  return payload.list || [];
}

export async function fetchRecommendedPlaylists(): Promise<
  NeteasePlaylistRecommendationPayload[]
> {
  const payload = await fetchNeteaseJson<NeteasePersonalizedPlaylistResponse>(
    '/api/personalized/playlist',
    {
      limit: String(HOME_PLAYLIST_LIMIT),
    }
  );

  assertNeteaseSuccess(payload, '获取推荐歌单失败');
  return payload.result || [];
}

export async function fetchNewestAlbums(): Promise<
  NeteaseNewestAlbumPayload[]
> {
  const payload = await fetchNeteaseJson<NeteaseNewestAlbumResponse>(
    '/api/discovery/newAlbum',
    {
      area: 'ALL',
      limit: String(HOME_ALBUM_LIMIT),
      offset: '0',
      total: 'true',
    }
  );

  assertNeteaseSuccess(payload, '获取新碟失败');
  return payload.albums || [];
}

export async function fetchPlaylistDetail(
  playlistId: string,
  options?: {
    cookieHeader?: string | null;
  }
): Promise<NeteasePlaylistDetailPayload> {
  const payload = await fetchNeteaseJson<NeteasePlaylistDetailResponse>(
    '/api/playlist/detail',
    {
      id: String(requireNumericId(playlistId, '合集')),
    },
    {
      cookieHeader: options?.cookieHeader,
    }
  );

  assertNeteaseSuccess(payload, '获取歌单详情失败');

  if (!payload.result) {
    throw new NeteaseApiError('合集不存在', 404);
  }

  return payload.result;
}

export async function fetchAlbumDetail(albumId: string): Promise<{
  album: NeteaseAlbumDetailPayload;
  songs: NeteaseSongPayload[];
}> {
  const payload = await fetchNeteaseJson<NeteaseAlbumDetailResponse>(
    `/api/v1/album/${requireNumericId(albumId, '专辑')}`
  );

  assertNeteaseSuccess(payload, '获取专辑详情失败');

  if (!payload.album) {
    throw new NeteaseApiError('专辑不存在', 404);
  }

  return {
    album: payload.album,
    songs: payload.songs || [],
  };
}

export async function fetchSongDetail(
  trackId: string
): Promise<NeteaseSongPayload> {
  const numericTrackId = requireNumericId(trackId, '曲目');
  const payload = await fetchNeteaseJson<NeteaseSongDetailResponse>(
    '/api/song/detail',
    {
      ids: `[${numericTrackId}]`,
    }
  );

  assertNeteaseSuccess(payload, '获取曲目信息失败');

  const song = payload.songs?.[0];
  if (!song) {
    throw new NeteaseApiError('曲目不存在', 404);
  }

  return song;
}

export async function fetchAccountProfile(
  sessionCookie: string
): Promise<NeteaseAccountProfilePayload | null> {
  const payload = await fetchNeteaseJson<NeteaseAccountResponse>(
    '/api/w/nuser/account/get',
    undefined,
    {
      cookieHeader: sessionCookie,
    }
  );

  assertNeteaseSuccess(payload, '获取网易云账号失败');
  return payload.profile || null;
}

export async function fetchQrLoginKey(): Promise<{ key: string }> {
  const payload = await fetchNeteaseJson<NeteaseQrLoginKeyResponse>(
    '/api/login/qr/key',
    {
      timestamp: String(Date.now()),
    }
  );

  assertNeteaseSuccess(payload, '创建网易云二维码失败');

  const key = normalizeOptionalText(payload.data?.unikey);

  if (!key) {
    throw new NeteaseApiError('网易云二维码 key 缺失', 502);
  }

  return {
    key,
  };
}

export async function fetchQrLoginCode(key: string): Promise<{
  key: string;
  qrUrl: string;
  qrImageDataUrl: string;
}> {
  const normalizedKey = normalizeOptionalText(key);

  if (!normalizedKey) {
    throw new NeteaseApiError('网易云二维码 key 缺失', 400);
  }

  const qrUrl = `https://music.163.com/login?codekey=${encodeURIComponent(
    normalizedKey
  )}`;
  const qrImageDataUrl = await QRCode.toDataURL(qrUrl, {
    width: 192,
    margin: 0,
    color: {
      dark: '#335eea',
      light: '#00000000',
    },
  });

  return {
    key: normalizedKey,
    qrUrl,
    qrImageDataUrl,
  };
}

export async function fetchQrLoginStatus(
  key: string
): Promise<NeteaseQrLoginStatusResponse> {
  const normalizedKey = normalizeOptionalText(key);

  if (!normalizedKey) {
    throw new NeteaseApiError('网易云二维码 key 缺失', 400);
  }

  const payload = await fetchNeteaseJson<NeteaseQrLoginStatusResponse>(
    '/api/login/qr/check',
    {
      key: normalizedKey,
      timestamp: String(Date.now()),
    }
  );

  if (
    payload.code !== 800 &&
    payload.code !== 801 &&
    payload.code !== 802 &&
    payload.code !== 803
  ) {
    throw new NeteaseApiError('获取网易云二维码状态失败', 502);
  }

  return payload;
}

export async function fetchUserPlaylists(
  userId: string,
  sessionCookie: string
): Promise<NeteaseUserPlaylistPayload[]> {
  const payload = await fetchNeteaseJson<NeteaseUserPlaylistResponse>(
    '/api/user/playlist',
    {
      uid: String(requireNumericId(userId, '用户')),
      limit: '30',
      offset: '0',
    },
    {
      cookieHeader: sessionCookie,
    }
  );

  assertNeteaseSuccess(payload, '获取我的歌单失败');
  return payload.playlist || [];
}

export async function fetchDailyRecommendations(
  sessionCookie: string
): Promise<NeteaseSongPayload[]> {
  const payload = await fetchNeteaseJson<NeteaseDailyRecommendationResponse>(
    '/api/v3/discovery/recommend/songs',
    undefined,
    {
      cookieHeader: sessionCookie,
    }
  );

  assertNeteaseSuccess(payload, '获取每日推荐失败');
  return payload.data?.dailySongs || [];
}

export async function fetchPersonalFmTracks(
  sessionCookie: string
): Promise<NeteaseSongPayload[]> {
  const payload = await fetchNeteaseJson<NeteasePersonalFmResponse>(
    '/api/v1/radio/get',
    undefined,
    {
      cookieHeader: sessionCookie,
    }
  );

  assertNeteaseSuccess(payload, '获取私人 FM 失败');
  return payload.data || [];
}

export async function sendPersonalFmTrashFeedback(
  trackId: string,
  sessionCookie: string
): Promise<void> {
  const payload = await fetchNeteaseJson<{
    code?: number;
    msg?: string;
    message?: string;
  }>(
    '/api/radio/trash/add',
    {
      alg: 'RT',
      songId: String(requireNumericId(trackId, '曲目')),
      time: '25',
    },
    {
      cookieHeader: sessionCookie,
      method: 'POST',
    }
  );

  assertNeteaseSuccess(payload, '标记私人 FM 不喜欢失败');
}

export async function sendTrackLikeMutation(
  trackId: string,
  liked: boolean,
  sessionCookie: string
): Promise<void> {
  const payload = await fetchNeteaseJson<{
    code?: number;
    msg?: string;
    message?: string;
  }>(
    '/api/like',
    {
      id: String(requireNumericId(trackId, '曲目')),
      like: liked ? 'true' : 'false',
      time: '25',
    },
    {
      cookieHeader: sessionCookie,
      method: 'POST',
    }
  );

  assertNeteaseSuccess(payload, liked ? '收藏歌曲失败' : '取消收藏歌曲失败');
}

export async function sendPlaylistSubscriptionMutation(
  playlistId: string,
  subscribed: boolean,
  sessionCookie: string
): Promise<void> {
  const payload = await fetchNeteaseJson<{
    code?: number;
    msg?: string;
    message?: string;
  }>(
    subscribed ? '/api/playlist/subscribe' : '/api/playlist/unsubscribe',
    {
      id: String(requireNumericId(playlistId, '歌单')),
    },
    {
      cookieHeader: sessionCookie,
      method: 'POST',
    }
  );

  assertNeteaseSuccess(payload, subscribed ? '收藏歌单失败' : '取消收藏歌单失败');
}

export async function fetchRecentTracks(
  sessionCookie: string
): Promise<NeteaseRecentTrackItemPayload[]> {
  const payload = await fetchNeteaseJson<NeteaseRecentTrackResponse>(
    '/api/record/recent/song',
    undefined,
    {
      cookieHeader: sessionCookie,
    }
  );

  assertNeteaseSuccess(payload, '获取最近播放失败');

  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  return payload.data?.list || [];
}

export async function sendTrackScrobble(
  trackId: string,
  sessionCookie: string
): Promise<void> {
  const normalizedTrackId = String(requireNumericId(trackId, '曲目'));
  const payload = await fetchNeteaseJson<{
    code?: number;
    msg?: string;
    message?: string;
  }>(
    '/api/scrobble',
    {
      id: normalizedTrackId,
      sourceid: normalizedTrackId,
      time: '0',
    },
    {
      cookieHeader: sessionCookie,
      method: 'POST',
    }
  );

  assertNeteaseSuccess(payload, '上报最近播放失败');
}

export async function fetchSearchTracks(
  query: string,
  page: number
): Promise<NeteaseSongPayload[]> {
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

  assertNeteaseSuccess(payload, '搜索曲目失败');
  return payload.result?.songs || [];
}

export async function fetchSearchPlaylists(
  query: string,
  page: number
): Promise<NeteaseSearchPlaylistPayload[]> {
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

  assertNeteaseSuccess(payload, '搜索歌单失败');
  return payload.result?.playlists || [];
}

export async function fetchSearchAlbums(
  query: string,
  page: number
): Promise<NeteaseSearchAlbumPayload[]> {
  const offset = (page - 1) * SEARCH_ALBUM_LIMIT;
  const payload = await fetchNeteaseJson<NeteaseSearchResponse>(
    '/api/search/get/web',
    {
      csrf_token: '',
      limit: String(SEARCH_ALBUM_LIMIT),
      offset: String(offset),
      s: query,
      type: '10',
    }
  );

  assertNeteaseSuccess(payload, '搜索专辑失败');
  return payload.result?.albums || [];
}

export async function fetchSearchArtists(
  query: string,
  page: number
): Promise<NeteaseSearchArtistPayload[]> {
  const offset = (page - 1) * SEARCH_ARTIST_LIMIT;
  const payload = await fetchNeteaseJson<NeteaseSearchResponse>(
    '/api/search/get/web',
    {
      csrf_token: '',
      limit: String(SEARCH_ARTIST_LIMIT),
      offset: String(offset),
      s: query,
      type: '100',
    }
  );

  assertNeteaseSuccess(payload, '搜索艺人失败');
  return payload.result?.artists || [];
}

export async function fetchArtistTopSongs(
  artistId: string
): Promise<NeteaseSongPayload[]> {
  const payload = await fetchNeteaseJson<NeteaseSongDetailResponse>(
    '/api/artist/top/song',
    {
      id: String(requireNumericId(artistId, '艺人')),
    }
  );

  assertNeteaseSuccess(payload, '获取艺人热歌失败');
  return payload.songs || [];
}

export async function fetchArtistAlbums(
  artistId: string,
  page = 1
): Promise<NeteaseSearchAlbumPayload[]> {
  const offset = (page - 1) * SEARCH_ALBUM_LIMIT;
  const payload = await fetchNeteaseJson<NeteaseArtistAlbumsResponse>(
    `/api/artist/albums/${requireNumericId(artistId, '艺人')}`,
    {
      limit: String(SEARCH_ALBUM_LIMIT),
      offset: String(offset),
      total: 'true',
    }
  );

  assertNeteaseSuccess(payload, '获取艺人专辑失败');
  return payload.hotAlbums || [];
}

export async function fetchLyric(
  trackId: string
): Promise<NeteaseLyricResponse> {
  const payload = await fetchNeteaseJson<NeteaseLyricResponse>(
    '/api/song/lyric',
    {
      id: String(requireNumericId(trackId, '曲目')),
      lv: '-1',
      tv: '-1',
    }
  );

  assertNeteaseSuccess(payload, '获取歌词失败');
  return payload;
}

function withStreamCorsHeaders(headers: Headers): void {
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

export async function createNeteaseStreamResponse(
  request: Request
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const trackId = requireNumericId(requestUrl.searchParams.get('id'), '曲目');
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
    throw new NeteaseApiError(
      error instanceof Error
        ? `音频地址解析失败: ${error.message}`
        : '音频地址解析失败',
      502
    );
  } finally {
    clearTimeout(redirectTimeoutId);
  }

  const redirectLocation = normalizeOptionalText(
    redirectResponse.headers.get('location')
  );
  const upstreamUrl =
    redirectResponse.status >= 300 &&
    redirectResponse.status < 400 &&
    redirectLocation
      ? resolveAudioRedirectLocation(redirectResponse, redirectLocation)
      : redirectResponse.url;

  if (!normalizeOptionalText(upstreamUrl)) {
    throw new NeteaseApiError('音频地址解析失败', 502);
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
    throw new NeteaseApiError(
      error instanceof Error
        ? `音频流获取失败: ${error.message}`
        : '音频流获取失败',
      502
    );
  } finally {
    clearTimeout(streamTimeoutId);
  }

  if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
    throw new NeteaseApiError('音频流获取失败', 502);
  }

  const headers = new Headers();
  withStreamCorsHeaders(headers);
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
