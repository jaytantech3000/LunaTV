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

const DEFAULT_AUDIOUS_API_BASE_URL = 'https://api.audius.co';
const AUDIOUS_APP_NAME = 'LunaTV';
const AUDIOUS_SOURCE_KEY: MusicPlatformKey = 'audius';
const AUDIOUS_SOURCE_TABS: MusicSectionTab[] = [
  'home',
  'hot',
  'playlist',
  'search',
];
const HOME_TRACK_LIMIT = 8;
const HOME_PLAYLIST_LIMIT = 6;
const SEARCH_TRACK_LIMIT = 12;
const SEARCH_PLAYLIST_LIMIT = 6;

interface AudiusArtwork {
  '150x150'?: string;
  '480x480'?: string;
  '1000x1000'?: string;
}

interface AudiusUser {
  id?: string;
  handle?: string;
  name?: string;
}

interface AudiusTrackAccess {
  stream?: boolean;
}

interface AudiusTrackStream {
  url?: string;
}

interface AudiusTrack {
  access?: AudiusTrackAccess;
  artwork?: AudiusArtwork | null;
  duration?: number;
  genre?: string | null;
  id?: string;
  is_streamable?: boolean | null;
  stream?: AudiusTrackStream | null;
  title?: string;
  user?: AudiusUser | null;
}

interface AudiusPlaylist {
  artwork?: AudiusArtwork | null;
  description?: string | null;
  id?: string;
  playlist_name?: string;
  track_count?: number;
  tracks?: AudiusTrack[];
  user?: AudiusUser | null;
}

interface AudiusResponse<T> {
  data?: T;
}

function getAudiusApiBaseUrl(): string {
  return (
    normalizeOptionalText(process.env.AUDIOUS_API_BASE_URL) ||
    DEFAULT_AUDIOUS_API_BASE_URL
  ).replace(/\/+$/, '');
}

function buildAudiusUrl(
  pathname: string,
  searchParams?: Record<string, string>
): string {
  return buildUpstreamUrl(getAudiusApiBaseUrl(), pathname, {
    app_name: AUDIOUS_APP_NAME,
    ...searchParams,
  });
}

async function fetchAudiusJson<T>(
  pathname: string,
  searchParams: Record<string, string> | undefined,
  fallbackMessage: string
): Promise<T> {
  return fetchMusicJson<T>(
    buildAudiusUrl(pathname, searchParams),
    {
      headers: {
        Accept: 'application/json',
      },
    },
    fallbackMessage
  );
}

function toAudiusList<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
}

function requireAudiusItem<T>(
  value: T | T[] | undefined,
  fallbackMessage: string
): T {
  const item = Array.isArray(value) ? value[0] : value;
  if (!item) {
    throw new MusicApiError(fallbackMessage, 404);
  }

  return item;
}

function resolveAudiusArtworkUrl(
  artwork: AudiusArtwork | null | undefined
): string | undefined {
  return (
    normalizeRemoteUrl(artwork?.['1000x1000']) ||
    normalizeRemoteUrl(artwork?.['480x480']) ||
    normalizeRemoteUrl(artwork?.['150x150'])
  );
}

function resolveAudiusArtist(track: AudiusTrack): string {
  return (
    normalizeOptionalText(track.user?.name) ||
    normalizeOptionalText(track.user?.handle) ||
    '未知歌手'
  );
}

function resolveAudiusStreamUrl(track: AudiusTrack): string | undefined {
  const directStreamUrl = normalizeRemoteUrl(track.stream?.url);
  if (directStreamUrl) {
    return directStreamUrl;
  }

  const trackId = normalizeOptionalText(track.id);
  if (!trackId) {
    return undefined;
  }

  return buildAudiusUrl(`/v1/tracks/${encodeURIComponent(trackId)}/stream`);
}

function isAudiusTrackPlayable(track: AudiusTrack): boolean {
  if (track.access?.stream === false) {
    return false;
  }

  if (track.is_streamable === false) {
    return false;
  }

  return Boolean(resolveAudiusStreamUrl(track));
}

function toAudiusTrack(track: AudiusTrack): MusicTrack {
  const genre = normalizeOptionalText(track.genre);
  const artistName = resolveAudiusArtist(track);

  return {
    artists: [
      {
        id: normalizeOptionalText(track.user?.id),
        name: artistName,
      },
    ],
    cover: resolveAudiusArtworkUrl(track.artwork),
    durationMs:
      typeof track.duration === 'number' && track.duration > 0
        ? track.duration * 1000
        : undefined,
    id: normalizeOptionalText(track.id) || '',
    playable: isAudiusTrackPlayable(track),
    source: AUDIOUS_SOURCE_KEY,
    subtitle: genre,
    title: normalizeOptionalText(track.title) || '未知曲目',
  };
}

function toAudiusPlaylistSummary(
  playlist: AudiusPlaylist,
  index: number
): MusicCollectionSummary {
  return {
    accentColor: pickAccentColor(index),
    cover: resolveAudiusArtworkUrl(playlist.artwork),
    description:
      normalizeOptionalText(playlist.description) ||
      normalizeOptionalText(playlist.user?.name),
    id: normalizeOptionalText(playlist.id) || '',
    kind: 'playlist',
    source: AUDIOUS_SOURCE_KEY,
    title: normalizeOptionalText(playlist.playlist_name) || 'Audius 歌单',
    trackCount:
      typeof playlist.track_count === 'number' && playlist.track_count >= 0
        ? playlist.track_count
        : undefined,
  };
}

async function fetchTrendingTracks(): Promise<AudiusTrack[]> {
  const payload = await fetchAudiusJson<AudiusResponse<AudiusTrack[]>>(
    '/v1/tracks/trending',
    {
      limit: String(HOME_TRACK_LIMIT),
    },
    '获取 Audius 热门曲目失败'
  );

  return toAudiusList(payload.data);
}

async function fetchTrendingPlaylists(): Promise<AudiusPlaylist[]> {
  const payload = await fetchAudiusJson<AudiusResponse<AudiusPlaylist[]>>(
    '/v1/playlists/trending',
    {
      limit: String(HOME_PLAYLIST_LIMIT),
    },
    '获取 Audius 热门歌单失败'
  );

  return toAudiusList(payload.data);
}

async function fetchAudiusSearchTracks(
  query: string,
  page: number
): Promise<AudiusTrack[]> {
  const payload = await fetchAudiusJson<AudiusResponse<AudiusTrack[]>>(
    '/v1/tracks/search',
    {
      limit: String(SEARCH_TRACK_LIMIT),
      offset: String((page - 1) * SEARCH_TRACK_LIMIT),
      query,
    },
    '搜索 Audius 曲目失败'
  );

  return toAudiusList(payload.data);
}

async function fetchAudiusSearchPlaylists(
  query: string,
  page: number
): Promise<AudiusPlaylist[]> {
  const payload = await fetchAudiusJson<AudiusResponse<AudiusPlaylist[]>>(
    '/v1/playlists/search',
    {
      limit: String(SEARCH_PLAYLIST_LIMIT),
      offset: String((page - 1) * SEARCH_PLAYLIST_LIMIT),
      query,
    },
    '搜索 Audius 歌单失败'
  );

  return toAudiusList(payload.data);
}

async function fetchAudiusPlaylistDetail(
  playlistId: string
): Promise<AudiusPlaylist> {
  const payload = await fetchAudiusJson<AudiusResponse<AudiusPlaylist[]>>(
    `/v1/playlists/${encodeURIComponent(playlistId)}`,
    undefined,
    '获取 Audius 歌单详情失败'
  );

  return requireAudiusItem(payload.data, '合集不存在');
}

async function fetchAudiusTrackDetail(trackId: string): Promise<AudiusTrack> {
  const payload = await fetchAudiusJson<AudiusResponse<AudiusTrack>>(
    `/v1/tracks/${encodeURIComponent(trackId)}`,
    undefined,
    '获取 Audius 曲目信息失败'
  );

  return requireAudiusItem(payload.data, '曲目不存在');
}

export function getAudiusSource(): MusicSource {
  return {
    description: '官方公开 API，当前已接入热门单曲、热门歌单、搜索与播放。',
    enabled: true,
    key: AUDIOUS_SOURCE_KEY,
    name: 'Audius',
    provider: AUDIOUS_SOURCE_KEY,
    tabs: AUDIOUS_SOURCE_TABS,
  };
}

export async function getAudiusHomePayload(): Promise<MusicHomePayload> {
  const [tracksResult, playlistsResult] = await Promise.allSettled([
    fetchTrendingTracks(),
    fetchTrendingPlaylists(),
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
    .map(toAudiusTrack)
    .filter((track) => track.playable);
  const sections: MusicHomeSection[] = [];

  if (tracks.length) {
    sections.push({
      description: '来自 Audius Trending Tracks。',
      id: 'audius-hot',
      kind: 'track-list',
      tab: 'hot',
      title: '热门单曲',
      tracks: spotlight,
    });
  }

  if (playlists.length) {
    sections.push({
      collections: playlists
        .slice(0, HOME_PLAYLIST_LIMIT)
        .map((playlist, index) => toAudiusPlaylistSummary(playlist, index)),
      description: '来自 Audius Trending Playlists。',
      id: 'audius-playlist',
      kind: 'collection-list',
      tab: 'playlist',
      title: '热门歌单',
    });
  }

  return {
    sections,
    source: AUDIOUS_SOURCE_KEY,
    spotlight,
  };
}

export async function getAudiusSearchPayload(params: {
  page: string | null | undefined;
  query: string | null | undefined;
}): Promise<MusicSearchPayload> {
  const query = normalizeOptionalText(params.query) || '';
  if (!query) {
    return {
      collections: [],
      query,
      source: AUDIOUS_SOURCE_KEY,
      tracks: [],
    };
  }

  const page = normalizePage(params.page);
  const [tracks, playlists] = await Promise.all([
    fetchAudiusSearchTracks(query, page),
    fetchAudiusSearchPlaylists(query, page),
  ]);

  return {
    collections: playlists
      .slice(0, SEARCH_PLAYLIST_LIMIT)
      .map((playlist, index) => toAudiusPlaylistSummary(playlist, index)),
    query,
    source: AUDIOUS_SOURCE_KEY,
    tracks: tracks.slice(0, SEARCH_TRACK_LIMIT).map(toAudiusTrack),
  };
}

export async function getAudiusCollectionPayload(params: {
  id: string | null | undefined;
}): Promise<MusicCollection> {
  const playlistId = requireQueryValue(params.id, '缺少合集 id');
  const playlist = await fetchAudiusPlaylistDetail(playlistId);

  return {
    accentColor: pickAccentColor(0),
    cover: resolveAudiusArtworkUrl(playlist.artwork),
    curator: normalizeOptionalText(playlist.user?.name),
    description: normalizeOptionalText(playlist.description),
    id: normalizeOptionalText(playlist.id) || playlistId,
    kind: 'playlist',
    source: AUDIOUS_SOURCE_KEY,
    title: normalizeOptionalText(playlist.playlist_name) || 'Audius 歌单',
    trackCount:
      typeof playlist.track_count === 'number' && playlist.track_count >= 0
        ? playlist.track_count
        : playlist.tracks?.length,
    tracks: (playlist.tracks || []).map(toAudiusTrack),
  };
}

export async function getAudiusTrackPayload(params: {
  id: string | null | undefined;
  quality: string | null | undefined;
}): Promise<MusicTrackPayload> {
  const trackId = requireQueryValue(params.id, '缺少曲目 id');
  const quality = resolveQuality(params.quality);
  const trackDetail = await fetchAudiusTrackDetail(trackId);
  const streamUrl = resolveAudiusStreamUrl(trackDetail);
  const track = toAudiusTrack(trackDetail);

  if (!track.playable || !streamUrl) {
    throw new MusicApiError('当前曲目暂不可播放', 403);
  }

  return {
    quality,
    streamUrl,
    track,
  };
}

export async function getAudiusLyricPayload(params: {
  id: string | null | undefined;
}): Promise<MusicLyricPayload> {
  return {
    lines: [],
    source: AUDIOUS_SOURCE_KEY,
    trackId: requireQueryValue(params.id, '缺少曲目 id'),
  };
}
