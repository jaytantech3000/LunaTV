import { MusicApiError } from './netease';
import {
  buildUpstreamUrl,
  fetchMusicJson,
  normalizeOptionalText,
  normalizePage,
  normalizeRemoteUrl,
  pickAccentColor,
  requireQueryValue,
  resolveQuality,
} from './provider-utils';
import type {
  MusicCollection,
  MusicCollectionSummary,
  MusicHomePayload,
  MusicHomeSection,
  MusicLyricPayload,
  MusicPlatformKey,
  MusicSearchPayload,
  MusicSectionTab,
  MusicSource,
  MusicTrack,
  MusicTrackPayload,
} from './types';

const DEFAULT_JAMENDO_API_BASE_URL = 'https://api.jamendo.com/v3.0';
const JAMENDO_UNAVAILABLE_MESSAGE = 'Jamendo 官方接口当前不可用';
const JAMENDO_SUSPENDED_TTL_MS = 5 * 60 * 1000;
const JAMENDO_SOURCE_KEY: MusicPlatformKey = 'jamendo';
const JAMENDO_SOURCE_TABS: MusicSectionTab[] = [
  'home',
  'hot',
  'playlist',
  'search',
];
const HOME_TRACK_LIMIT = 8;
const HOME_PLAYLIST_LIMIT = 6;
const SEARCH_TRACK_LIMIT = 12;
const SEARCH_PLAYLIST_LIMIT = 6;
let jamendoSuspendedUntil = 0;

interface JamendoHeaders {
  error_message?: string;
  status?: string;
}

interface JamendoResponse<T> {
  headers?: JamendoHeaders;
  results?: T[];
}

interface JamendoTrack {
  album_id?: number | string;
  album_name?: string | null;
  audio?: string | null;
  audiodownload?: string | null;
  artist_id?: number | string;
  artist_name?: string | null;
  duration?: number;
  id?: number | string;
  image?: string | null;
  name?: string | null;
}

interface JamendoPlaylist {
  creationdate?: string | null;
  id?: number | string;
  image?: string | null;
  name?: string | null;
  track_count?: number;
  tracks?: JamendoTrack[];
  user_name?: string | null;
}

function getJamendoApiBaseUrl(): string {
  return (
    normalizeOptionalText(process.env.JAMENDO_API_BASE_URL) ||
    DEFAULT_JAMENDO_API_BASE_URL
  ).replace(/\/+$/, '');
}

function markJamendoTemporarilyUnavailable() {
  jamendoSuspendedUntil = Date.now() + JAMENDO_SUSPENDED_TTL_MS;
}

function isJamendoTemporarilyUnavailable(): boolean {
  return jamendoSuspendedUntil > Date.now();
}

function isJamendoSuspendedMessage(message: string | undefined): boolean {
  return /suspended application|application has been suspended/i.test(
    message || ''
  );
}

export function isJamendoConfigured(): boolean {
  return Boolean(normalizeOptionalText(process.env.JAMENDO_CLIENT_ID));
}

function requireJamendoClientId(): string {
  const clientId = normalizeOptionalText(process.env.JAMENDO_CLIENT_ID);
  if (!clientId) {
    throw new MusicApiError('Jamendo 未配置 JAMENDO_CLIENT_ID，暂不可用', 503);
  }

  return clientId;
}

function buildJamendoUrl(
  pathname: string,
  searchParams?: Record<string, string>
): string {
  return buildUpstreamUrl(getJamendoApiBaseUrl(), pathname, {
    client_id: requireJamendoClientId(),
    format: 'json',
    ...searchParams,
  });
}

function assertJamendoSuccess<T>(
  payload: JamendoResponse<T>,
  fallbackMessage: string
): T[] {
  if (
    payload.headers?.status &&
    payload.headers.status.toLowerCase() !== 'success'
  ) {
    const errorMessage =
      normalizeOptionalText(payload.headers.error_message) || fallbackMessage;

    if (isJamendoSuspendedMessage(errorMessage)) {
      markJamendoTemporarilyUnavailable();
      throw new MusicApiError(JAMENDO_UNAVAILABLE_MESSAGE, 503);
    }

    throw new MusicApiError(errorMessage, 502);
  }

  return payload.results || [];
}

async function fetchJamendoJson<T>(
  pathname: string,
  searchParams: Record<string, string> | undefined,
  fallbackMessage: string
): Promise<T[]> {
  const payload = await fetchMusicJson<JamendoResponse<T>>(
    buildJamendoUrl(pathname, searchParams),
    {
      headers: {
        Accept: 'application/json',
      },
    },
    fallbackMessage
  );

  return assertJamendoSuccess(payload, fallbackMessage);
}

function toStringId(
  value: number | string | null | undefined
): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return normalizeOptionalText(typeof value === 'string' ? value : undefined);
}

function resolveJamendoAudioUrl(track: JamendoTrack): string | undefined {
  return (
    normalizeRemoteUrl(track.audio) || normalizeRemoteUrl(track.audiodownload)
  );
}

function toJamendoTrack(track: JamendoTrack): MusicTrack {
  const albumTitle = normalizeOptionalText(track.album_name);
  const cover = normalizeRemoteUrl(track.image);

  return {
    album: albumTitle
      ? {
          cover,
          id: toStringId(track.album_id),
          title: albumTitle,
        }
      : undefined,
    artists: [
      {
        id: toStringId(track.artist_id),
        name: normalizeOptionalText(track.artist_name) || '未知歌手',
      },
    ],
    cover,
    durationMs:
      typeof track.duration === 'number' && track.duration > 0
        ? track.duration * 1000
        : undefined,
    id: toStringId(track.id) || '',
    playable: Boolean(resolveJamendoAudioUrl(track)),
    source: JAMENDO_SOURCE_KEY,
    subtitle: albumTitle,
    title: normalizeOptionalText(track.name) || '未知曲目',
  };
}

function toJamendoPlaylistSummary(
  playlist: JamendoPlaylist,
  index: number
): MusicCollectionSummary {
  return {
    accentColor: pickAccentColor(index),
    cover: normalizeRemoteUrl(playlist.image),
    description:
      normalizeOptionalText(playlist.user_name) ||
      normalizeOptionalText(playlist.creationdate),
    id: toStringId(playlist.id) || '',
    kind: 'playlist',
    source: JAMENDO_SOURCE_KEY,
    title: normalizeOptionalText(playlist.name) || 'Jamendo 歌单',
    trackCount:
      typeof playlist.track_count === 'number' && playlist.track_count >= 0
        ? playlist.track_count
        : undefined,
  };
}

async function fetchJamendoHomeTracks(): Promise<JamendoTrack[]> {
  return fetchJamendoJson<JamendoTrack>(
    '/tracks/',
    {
      audioformat: 'mp32',
      featured: '1',
      limit: String(HOME_TRACK_LIMIT),
      order: 'popularity_total',
    },
    '获取 Jamendo 热门曲目失败'
  );
}

async function fetchJamendoPlaylists(): Promise<JamendoPlaylist[]> {
  return fetchJamendoJson<JamendoPlaylist>(
    '/playlists/',
    {
      limit: String(HOME_PLAYLIST_LIMIT),
      order: 'popularity_total',
    },
    '获取 Jamendo 热门歌单失败'
  );
}

async function fetchJamendoSearchTracks(
  query: string,
  page: number
): Promise<JamendoTrack[]> {
  return fetchJamendoJson<JamendoTrack>(
    '/tracks/',
    {
      audioformat: 'mp32',
      limit: String(SEARCH_TRACK_LIMIT),
      offset: String((page - 1) * SEARCH_TRACK_LIMIT),
      order: 'popularity_total',
      search: query,
    },
    '搜索 Jamendo 曲目失败'
  );
}

async function fetchJamendoSearchPlaylists(
  query: string,
  page: number
): Promise<JamendoPlaylist[]> {
  return fetchJamendoJson<JamendoPlaylist>(
    '/playlists/',
    {
      limit: String(SEARCH_PLAYLIST_LIMIT),
      namesearch: query,
      offset: String((page - 1) * SEARCH_PLAYLIST_LIMIT),
      order: 'popularity_total',
    },
    '搜索 Jamendo 歌单失败'
  );
}

async function fetchJamendoPlaylistDetail(
  playlistId: string
): Promise<JamendoPlaylist> {
  const [playlist] = await fetchJamendoJson<JamendoPlaylist>(
    '/playlists/tracks/',
    {
      audioformat: 'mp32',
      id: playlistId,
    },
    '获取 Jamendo 歌单详情失败'
  );

  if (!playlist) {
    throw new MusicApiError('合集不存在', 404);
  }

  return playlist;
}

async function fetchJamendoTrackDetail(trackId: string): Promise<JamendoTrack> {
  const [track] = await fetchJamendoJson<JamendoTrack>(
    '/tracks/',
    {
      audioformat: 'mp32',
      id: trackId,
    },
    '获取 Jamendo 曲目信息失败'
  );

  if (!track) {
    throw new MusicApiError('曲目不存在', 404);
  }

  return track;
}

export function getJamendoSource(): MusicSource {
  const temporarilyUnavailable = isJamendoTemporarilyUnavailable();
  const enabled = isJamendoConfigured() && !temporarilyUnavailable;

  return {
    description: enabled
      ? '官方公开 API，当前已接入公开曲库、歌单搜索与播放。'
      : temporarilyUnavailable
      ? `${JAMENDO_UNAVAILABLE_MESSAGE}，入口已临时关闭。`
      : '需要配置 JAMENDO_CLIENT_ID 后开放。',
    enabled,
    key: JAMENDO_SOURCE_KEY,
    name: 'Jamendo',
    provider: JAMENDO_SOURCE_KEY,
    tabs: JAMENDO_SOURCE_TABS,
  };
}

export async function getJamendoHomePayload(): Promise<MusicHomePayload> {
  const [tracksResult, playlistsResult] = await Promise.allSettled([
    fetchJamendoHomeTracks(),
    fetchJamendoPlaylists(),
  ]);
  const tracks = tracksResult.status === 'fulfilled' ? tracksResult.value : [];
  const playlists =
    playlistsResult.status === 'fulfilled' ? playlistsResult.value : [];

  if (!tracks.length && !playlists.length) {
    if (tracksResult.status === 'rejected') {
      throw tracksResult.reason;
    }

    if (playlistsResult.status === 'rejected') {
      throw playlistsResult.reason;
    }
  }

  const spotlight = tracks
    .slice(0, HOME_TRACK_LIMIT)
    .map(toJamendoTrack)
    .filter((track) => track.playable);
  const sections: MusicHomeSection[] = [];

  if (tracks.length) {
    sections.push({
      description: '来自 Jamendo 公开曲库。',
      id: 'jamendo-hot',
      kind: 'track-list',
      tab: 'hot',
      title: '精选单曲',
      tracks: spotlight,
    });
  }

  if (playlists.length) {
    sections.push({
      collections: playlists
        .slice(0, HOME_PLAYLIST_LIMIT)
        .map((playlist, index) => toJamendoPlaylistSummary(playlist, index)),
      description: '来自 Jamendo 公开歌单。',
      id: 'jamendo-playlist',
      kind: 'collection-list',
      tab: 'playlist',
      title: '精选歌单',
    });
  }

  return {
    sections,
    source: JAMENDO_SOURCE_KEY,
    spotlight,
  };
}

export async function getJamendoSearchPayload(params: {
  page: string | null | undefined;
  query: string | null | undefined;
}): Promise<MusicSearchPayload> {
  const query = normalizeOptionalText(params.query) || '';
  if (!query) {
    return {
      collections: [],
      query,
      source: JAMENDO_SOURCE_KEY,
      tracks: [],
    };
  }

  const page = normalizePage(params.page);
  const [tracks, playlists] = await Promise.all([
    fetchJamendoSearchTracks(query, page),
    fetchJamendoSearchPlaylists(query, page),
  ]);

  return {
    collections: playlists
      .slice(0, SEARCH_PLAYLIST_LIMIT)
      .map((playlist, index) => toJamendoPlaylistSummary(playlist, index)),
    query,
    source: JAMENDO_SOURCE_KEY,
    tracks: tracks.slice(0, SEARCH_TRACK_LIMIT).map(toJamendoTrack),
  };
}

export async function getJamendoCollectionPayload(params: {
  id: string | null | undefined;
}): Promise<MusicCollection> {
  const playlistId = requireQueryValue(params.id, '缺少合集 id');
  const playlist = await fetchJamendoPlaylistDetail(playlistId);

  return {
    accentColor: pickAccentColor(0),
    cover: normalizeRemoteUrl(playlist.image),
    curator: normalizeOptionalText(playlist.user_name),
    description: normalizeOptionalText(playlist.creationdate),
    id: toStringId(playlist.id) || playlistId,
    kind: 'playlist',
    source: JAMENDO_SOURCE_KEY,
    title: normalizeOptionalText(playlist.name) || 'Jamendo 歌单',
    trackCount:
      typeof playlist.track_count === 'number' && playlist.track_count >= 0
        ? playlist.track_count
        : playlist.tracks?.length,
    tracks: (playlist.tracks || []).map(toJamendoTrack),
  };
}

export async function getJamendoTrackPayload(params: {
  id: string | null | undefined;
  quality: string | null | undefined;
}): Promise<MusicTrackPayload> {
  const trackId = requireQueryValue(params.id, '缺少曲目 id');
  const quality = resolveQuality(params.quality);
  const trackDetail = await fetchJamendoTrackDetail(trackId);
  const streamUrl = resolveJamendoAudioUrl(trackDetail);
  const track = toJamendoTrack(trackDetail);

  if (!track.playable || !streamUrl) {
    throw new MusicApiError('当前曲目暂不可播放', 403);
  }

  return {
    quality,
    streamUrl,
    track,
  };
}

export async function getJamendoLyricPayload(params: {
  id: string | null | undefined;
}): Promise<MusicLyricPayload> {
  return {
    lines: [],
    source: JAMENDO_SOURCE_KEY,
    trackId: requireQueryValue(params.id, '缺少曲目 id'),
  };
}
