import type {
  NeteaseAccountProfilePayload,
  NeteaseAlbumDetailPayload,
  NeteaseLyricResponse,
  NeteaseNewestAlbumPayload,
  NeteasePlaylistDetailPayload,
  NeteasePlaylistRecommendationPayload,
  NeteaseSearchAlbumPayload,
  NeteaseSearchArtistPayload,
  NeteaseSearchPlaylistPayload,
  NeteaseSongPayload,
  NeteaseToplistPayload,
  NeteaseUserPlaylistPayload,
} from './client';
import type {
  LyricDocumentEntity,
  LyricLineEntity,
  MusicAccountEntity,
  MusicAccountProfileEntity,
  MusicCollectionEntity,
  MusicCollectionSummaryEntity,
  MusicSearchResultEntity,
  MusicSourceEntity,
  MusicTrackEntity,
} from '../../../domain/entities';

const SUMMARY_ACCENT_COLORS = [
  '#ff5f6d',
  '#7b61ff',
  '#0ea5e9',
  '#0f766e',
  '#22c55e',
  '#f97316',
];

function normalizeOptionalText(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeRemoteUrl(
  value: string | null | undefined
): string | undefined {
  return normalizeOptionalText(value);
}

function resolveArtistNames(
  artists: Array<{ name?: string | null }> | null | undefined
): string[] {
  return (
    artists
      ?.map((artist) => normalizeOptionalText(artist.name))
      .filter((artist): artist is string => Boolean(artist)) || []
  );
}

function pickAccentColor(index: number): string {
  return SUMMARY_ACCENT_COLORS[index % SUMMARY_ACCENT_COLORS.length];
}

function isPlayable(song: NeteaseSongPayload): boolean {
  return typeof song.fee === 'number' ? song.fee === 0 : true;
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

function parseLrcLines(content: string | null | undefined): LyricLineEntity[] {
  const lines: LyricLineEntity[] = [];

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

      const timeMs = parseLrcTimestamp(cursor.slice(1, closingIndex));

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
        timeMs,
        text,
      });
    });
  }

  return lines.sort((left, right) => left.timeMs - right.timeMs);
}

export function createNeteaseSourceEntity(): MusicSourceEntity {
  return {
    key: 'netease',
    name: '网易云音乐',
    enabled: true,
    tabs: [
      'home',
      'rank',
      'hot',
      'playlist',
      'album',
      'artist',
      'daily',
      'fm',
      'search',
    ],
    description: 'Web 与桌面模式都已接入真实网易云公开数据。',
  };
}

export function toMusicTrackEntity(song: NeteaseSongPayload): MusicTrackEntity {
  const albumPayload = song.album || song.al;
  const artistsPayload = song.artists || song.ar;
  const albumTitle = normalizeOptionalText(albumPayload?.name);

  return {
    id:
      typeof song.id === 'number' && Number.isFinite(song.id)
        ? String(song.id)
        : '',
    source: 'netease',
    title: normalizeOptionalText(song.name) || '未知曲目',
    artists:
      artistsPayload
        ?.map((artist) => normalizeOptionalText(artist.name))
        .filter((artist): artist is string => Boolean(artist)) || [],
    album: albumTitle || '',
    coverUrl: normalizeRemoteUrl(albumPayload?.picUrl) || '',
    durationMs:
      typeof song.duration === 'number' && song.duration > 0
        ? song.duration
        : typeof song.dt === 'number' && song.dt > 0
        ? song.dt
        : 0,
    stream: '',
    playable: isPlayable(song),
  };
}

export function toToplistSummaryEntity(
  item: NeteaseToplistPayload,
  index: number
): MusicCollectionSummaryEntity {
  return {
    id: String(item.id || ''),
    source: 'netease',
    kind: 'rank',
    title: normalizeOptionalText(item.name) || '官方榜单',
    coverUrl: normalizeRemoteUrl(item.coverImgUrl),
    description: normalizeOptionalText(item.description),
    trackCount:
      typeof item.trackCount === 'number' && item.trackCount >= 0
        ? item.trackCount
        : undefined,
    accentColor: pickAccentColor(index),
  };
}

export function toRecommendedPlaylistSummaryEntity(
  item: NeteasePlaylistRecommendationPayload,
  index: number
): MusicCollectionSummaryEntity {
  return {
    id: String(item.id || ''),
    source: 'netease',
    kind: 'playlist',
    title: normalizeOptionalText(item.name) || '推荐歌单',
    coverUrl: normalizeRemoteUrl(item.picUrl),
    description: normalizeOptionalText(item.copywriter),
    trackCount:
      typeof item.trackCount === 'number' && item.trackCount >= 0
        ? item.trackCount
        : undefined,
    accentColor: pickAccentColor(index + 1),
  };
}

export function toNewestAlbumSummaryEntity(
  item: NeteaseNewestAlbumPayload,
  index: number
): MusicCollectionSummaryEntity {
  const artistNames = resolveArtistNames(
    item.artists?.length ? item.artists : item.artist ? [item.artist] : []
  );

  return {
    id: String(item.id || ''),
    source: 'netease',
    kind: 'album',
    title: normalizeOptionalText(item.name) || '精选专辑',
    coverUrl: normalizeRemoteUrl(item.picUrl),
    description: artistNames.join(' / ') || undefined,
    trackCount:
      typeof item.size === 'number' && item.size >= 0 ? item.size : undefined,
    accentColor: pickAccentColor(index + 3),
  };
}

export function toSearchPlaylistSummaryEntity(
  item: NeteaseSearchPlaylistPayload,
  index: number
): MusicCollectionSummaryEntity {
  return {
    id: String(item.id || ''),
    source: 'netease',
    kind: 'playlist',
    title: normalizeOptionalText(item.name) || '搜索歌单',
    coverUrl: normalizeRemoteUrl(item.coverImgUrl),
    description: normalizeOptionalText(item.description),
    trackCount:
      typeof item.trackCount === 'number' && item.trackCount >= 0
        ? item.trackCount
        : undefined,
    accentColor: pickAccentColor(index + 2),
  };
}

export function toSearchAlbumSummaryEntity(
  item: NeteaseSearchAlbumPayload,
  index: number
): MusicCollectionSummaryEntity {
  const artistNames = resolveArtistNames(
    item.artists?.length ? item.artists : item.artist ? [item.artist] : []
  );

  return {
    id: String(item.id || ''),
    source: 'netease',
    kind: 'album',
    title: normalizeOptionalText(item.name) || '搜索专辑',
    coverUrl: normalizeRemoteUrl(item.picUrl),
    description: artistNames.join(' / ') || undefined,
    trackCount:
      typeof item.size === 'number' && item.size >= 0 ? item.size : undefined,
    accentColor: pickAccentColor(index + 4),
  };
}

export function toSearchArtistSummaryEntity(
  item: NeteaseSearchArtistPayload,
  index: number
): MusicCollectionSummaryEntity {
  const albumCount =
    typeof item.albumSize === 'number' && item.albumSize >= 0
      ? item.albumSize
      : null;
  const trackCount =
    typeof item.musicSize === 'number' && item.musicSize >= 0
      ? item.musicSize
      : undefined;
  const descriptionParts = [
    albumCount !== null ? `${albumCount} albums` : null,
    trackCount !== undefined ? `${trackCount} tracks` : null,
  ].filter((part): part is string => Boolean(part));

  return {
    id: String(item.id || ''),
    source: 'netease',
    kind: 'artist-toplist',
    title: normalizeOptionalText(item.name) || '艺人热歌',
    coverUrl: normalizeRemoteUrl(item.picUrl),
    description: descriptionParts.join(' · ') || undefined,
    trackCount,
    accentColor: pickAccentColor(index + 5),
  };
}

export function toMusicCollectionEntity(
  playlist: NeteasePlaylistDetailPayload
): MusicCollectionEntity {
  return {
    summary: {
      id: String(playlist.id || ''),
      source: 'netease',
      kind: 'playlist',
      title: normalizeOptionalText(playlist.name) || '歌单详情',
      coverUrl: normalizeRemoteUrl(playlist.coverImgUrl),
      description: normalizeOptionalText(playlist.description),
      trackCount:
        typeof playlist.trackCount === 'number' && playlist.trackCount >= 0
          ? playlist.trackCount
          : undefined,
      accentColor: pickAccentColor(0),
    },
    curator: normalizeOptionalText(playlist.creator?.nickname),
    updatedAtLabel: normalizeOptionalText(playlist.updateFrequency),
    tracks: playlist.tracks?.map(toMusicTrackEntity) || [],
  };
}

export function toMusicAlbumCollectionEntity(params: {
  album: NeteaseAlbumDetailPayload;
  songs: NeteaseSongPayload[];
}): MusicCollectionEntity {
  const artistNames = resolveArtistNames(
    params.album.artists?.length
      ? params.album.artists
      : params.album.artist
      ? [params.album.artist]
      : []
  );

  return {
    summary: {
      id: String(params.album.id || ''),
      source: 'netease',
      kind: 'album',
      title: normalizeOptionalText(params.album.name) || '专辑详情',
      coverUrl: normalizeRemoteUrl(params.album.picUrl),
      description: normalizeOptionalText(params.album.description),
      trackCount:
        typeof params.album.size === 'number' && params.album.size >= 0
          ? params.album.size
          : undefined,
      accentColor: pickAccentColor(3),
    },
    curator: artistNames.join(' / ') || undefined,
    updatedAtLabel: normalizeOptionalText(params.album.company),
    tracks: params.songs.map(toMusicTrackEntity),
  };
}

export function toMusicArtistToplistCollectionEntity(params: {
  artistId: string;
  albums: NeteaseSearchAlbumPayload[];
  topSongs: NeteaseSongPayload[];
}): MusicCollectionEntity {
  const leadAlbum = params.albums[0];
  const artistNames = resolveArtistNames(
    leadAlbum?.artists?.length
      ? leadAlbum.artists
      : leadAlbum?.artist
      ? [leadAlbum.artist]
      : []
  );
  const artistTitle =
    artistNames[0] ||
    resolveArtistNames(
      params.topSongs[0]?.artists || params.topSongs[0]?.ar
    )[0] ||
    '艺人热歌';
  const relatedCollections = params.albums.map((album, index) =>
    toSearchAlbumSummaryEntity(album, index)
  );
  const summaryDescriptionParts = [
    relatedCollections.length > 0
      ? `${relatedCollections.length} hot albums`
      : null,
    params.topSongs.length > 0 ? `${params.topSongs.length} top songs` : null,
  ].filter((part): part is string => Boolean(part));

  return {
    summary: {
      id: params.artistId,
      source: 'netease',
      kind: 'artist-toplist',
      title: artistTitle,
      coverUrl:
        normalizeRemoteUrl(leadAlbum?.picUrl) ||
        normalizeRemoteUrl(params.topSongs[0]?.album?.picUrl) ||
        normalizeRemoteUrl(params.topSongs[0]?.al?.picUrl),
      description: summaryDescriptionParts.join(' · ') || undefined,
      trackCount: params.topSongs.length || undefined,
      accentColor: pickAccentColor(5),
    },
    curator: artistTitle,
    updatedAtLabel: '热门歌曲',
    tracks: params.topSongs.map(toMusicTrackEntity),
    relatedCollections,
  };
}

export function toMusicSearchResultEntity(params: {
  query: string;
  tracks: NeteaseSongPayload[];
  playlists: NeteaseSearchPlaylistPayload[];
  albums: NeteaseSearchAlbumPayload[];
  artists: NeteaseSearchArtistPayload[];
}): MusicSearchResultEntity {
  return {
    source: 'netease',
    query: params.query,
    tracks: params.tracks.map(toMusicTrackEntity),
    collections: [
      ...params.artists.map((item, index) =>
        toSearchArtistSummaryEntity(item, index)
      ),
      ...params.playlists.map((item, index) =>
        toSearchPlaylistSummaryEntity(item, index)
      ),
      ...params.albums.map((item, index) =>
        toSearchAlbumSummaryEntity(item, index)
      ),
    ],
  };
}

export function toMusicAccountProfileEntity(
  profile: NeteaseAccountProfilePayload
): MusicAccountProfileEntity {
  return {
    userId:
      typeof profile.userId === 'number' && Number.isFinite(profile.userId)
        ? String(profile.userId)
        : '',
    nickname: normalizeOptionalText(profile.nickname) || '网易云用户',
    avatarUrl: normalizeRemoteUrl(profile.avatarUrl),
    signature: normalizeOptionalText(profile.signature),
  };
}

export function toUserPlaylistSummaryEntity(
  item: NeteaseUserPlaylistPayload,
  index: number,
  options?: {
    accountUserId?: string | null;
  }
): MusicCollectionSummaryEntity {
  const creatorUserId =
    typeof item.creator?.userId === 'number' &&
    Number.isFinite(item.creator.userId)
      ? String(item.creator.userId)
      : undefined;
  const accountUserId = normalizeOptionalText(options?.accountUserId);

  return {
    id: String(item.id || ''),
    source: 'netease',
    kind: 'playlist',
    title: normalizeOptionalText(item.name) || '我的歌单',
    coverUrl: normalizeRemoteUrl(item.coverImgUrl),
    description:
      normalizeOptionalText(item.description) ||
      normalizeOptionalText(item.creator?.nickname),
    trackCount:
      typeof item.trackCount === 'number' && item.trackCount >= 0
        ? item.trackCount
        : undefined,
    accentColor: pickAccentColor(index + 1),
    accountPlaylistRole:
      accountUserId && creatorUserId
        ? creatorUserId === accountUserId
          ? 'owned'
          : 'subscribed'
        : undefined,
  };
}

export function createSignedOutMusicAccountEntity(): MusicAccountEntity {
  return {
    source: 'netease',
    authenticated: false,
    profile: null,
    playlists: [],
  };
}

export function toLyricDocumentEntity(
  trackId: string,
  lyric: NeteaseLyricResponse
): LyricDocumentEntity {
  return {
    trackId,
    source: 'netease',
    offsetMs: 0,
    lines: parseLrcLines(lyric.lrc?.lyric),
  };
}
