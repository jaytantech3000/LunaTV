/* eslint-disable no-console */

import {
  createNeteaseStreamResponse,
  fetchAccountProfile,
  fetchAlbumDetail,
  fetchArtistAlbums,
  fetchArtistTopSongs,
  fetchDailyRecommendations,
  fetchLyric,
  fetchNewestAlbums,
  fetchPersonalFmTracks,
  fetchPlaylistDetail,
  fetchQrLoginCode,
  fetchQrLoginKey,
  fetchQrLoginStatus,
  fetchRecommendedPlaylists,
  fetchSearchAlbums,
  fetchSearchArtists,
  fetchSearchPlaylists,
  fetchSearchTracks,
  fetchSongDetail,
  fetchToplists,
  fetchUserPlaylists,
  NeteaseApiError,
  resolvePlaybackQuality,
  sendPersonalFmTrashFeedback,
} from './client';
import {
  createNeteaseSourceEntity,
  createSignedOutMusicAccountEntity,
  toLyricDocumentEntity,
  toMusicAccountProfileEntity,
  toMusicAlbumCollectionEntity,
  toMusicArtistToplistCollectionEntity,
  toMusicCollectionEntity,
  toMusicSearchResultEntity,
  toMusicTrackEntity,
  toNewestAlbumSummaryEntity,
  toRecommendedPlaylistSummaryEntity,
  toToplistSummaryEntity,
  toUserPlaylistSummaryEntity,
} from './mappers';
import { normalizeNeteaseSessionCookie } from '../../music-account-session';
import type {
  LiveMusicSourceKey,
  MusicAccountEntity,
  MusicAccountQrPollEntity,
  MusicAccountQrSessionEntity,
  MusicCollectionKind,
  MusicHomeView,
  MusicTrackEntity,
} from '../../../domain/entities';
import type { MusicProviderRepositorySet } from '../../../domain/repositories';

function assertNeteaseSource(source: LiveMusicSourceKey): void {
  if (source !== 'netease') {
    throw new NeteaseApiError('Unsupported music source', 400);
  }
}

function createFeaturedQueue(spotlight: MusicTrackEntity[]) {
  return spotlight.map((track, index) => ({
    queueId: `netease-featured-${track.id}`,
    track,
    addedAt: index + 1,
    fromContext: 'featured' as const,
  }));
}

function normalizePage(page?: number): number {
  return Number.isFinite(page) && page && page > 0 ? page : 1;
}

function toPlayableTracks(tracks: Parameters<typeof toMusicTrackEntity>[0][]) {
  return tracks.map(toMusicTrackEntity).filter((track) => track.playable);
}

function requireMusicSessionCookie(
  sessionCookie: string | null | undefined,
  fallbackMessage: string
): string {
  if (!sessionCookie?.trim()) {
    throw new NeteaseApiError(fallbackMessage, 401);
  }

  return sessionCookie;
}

async function getAccount(
  sessionCookie?: string | null
): Promise<MusicAccountEntity> {
  if (!sessionCookie?.trim()) {
    return createSignedOutMusicAccountEntity();
  }

  const profilePayload = await fetchAccountProfile(sessionCookie);

  if (!profilePayload?.userId) {
    return createSignedOutMusicAccountEntity();
  }

  const profile = toMusicAccountProfileEntity(profilePayload);
  const playlists = (await fetchUserPlaylists(profile.userId, sessionCookie))
    .map((item, index) => toUserPlaylistSummaryEntity(item, index))
    .filter((playlist) => Boolean(playlist.id));

  return {
    source: 'netease',
    authenticated: true,
    profile,
    playlists,
  };
}

async function createQrSession(): Promise<MusicAccountQrSessionEntity> {
  const { key } = await fetchQrLoginKey();

  return {
    ...(await fetchQrLoginCode(key)),
    status: 'waiting',
  };
}

async function pollQrSession(key: string): Promise<MusicAccountQrPollEntity> {
  const statusPayload = await fetchQrLoginStatus(key);

  if (statusPayload.code === 801) {
    return {
      key,
      status: 'waiting',
      message: '等待扫码',
    };
  }

  if (statusPayload.code === 802) {
    return {
      key,
      status: 'scanned',
      message: '已扫码，请在手机确认',
    };
  }

  if (statusPayload.code === 800) {
    return {
      key,
      status: 'expired',
      message: '二维码已失效，请重新生成',
    };
  }

  const sessionCookieHeader = normalizeNeteaseSessionCookie(
    statusPayload.cookie || ''
  );
  const account = await getAccount(sessionCookieHeader);

  if (!account.authenticated || !account.profile) {
    throw new NeteaseApiError('网易云二维码登录已失效', 401);
  }

  return {
    key,
    status: 'confirmed',
    account,
    message: '登录成功，正在同步',
    sessionCookieHeader,
  };
}

async function getHomeView(
  sessionCookie?: string | null
): Promise<MusicHomeView> {
  const [toplistsResult, playlistsResult, albumsResult, dailyResult, fmResult] =
    await Promise.allSettled([
      fetchToplists(),
      fetchRecommendedPlaylists(),
      fetchNewestAlbums(),
      sessionCookie?.trim()
        ? fetchDailyRecommendations(sessionCookie)
        : Promise.resolve([]),
      sessionCookie?.trim()
        ? fetchPersonalFmTracks(sessionCookie)
        : Promise.resolve([]),
    ]);
  const toplists =
    toplistsResult.status === 'fulfilled' ? toplistsResult.value : [];
  const playlists =
    playlistsResult.status === 'fulfilled' ? playlistsResult.value : [];
  const albums = albumsResult.status === 'fulfilled' ? albumsResult.value : [];
  const dailyTracks =
    dailyResult.status === 'fulfilled' ? dailyResult.value : [];
  const fmTracks = fmResult.status === 'fulfilled' ? fmResult.value : [];
  const dailyTrackEntities = toPlayableTracks(dailyTracks);
  const fmTrackEntities = toPlayableTracks(fmTracks);

  if (!toplists.length && toplistsResult.status === 'rejected') {
    throw toplistsResult.reason;
  }

  if (!playlists.length && playlistsResult.status === 'rejected') {
    throw playlistsResult.reason;
  }

  let spotlight: MusicTrackEntity[] = [];

  if (typeof toplists[0]?.id === 'number') {
    const spotlightPlaylist = await fetchPlaylistDetail(String(toplists[0].id));
    spotlight =
      spotlightPlaylist.tracks
        ?.map(toMusicTrackEntity)
        .filter((track) => track.playable)
        .slice(0, 8) || [];
  }

  const sections = [];

  if (spotlight.length) {
    sections.push({
      id: 'netease-hot',
      title: '热播直放',
      tab: 'hot' as const,
      kind: 'track-list' as const,
      description: '从当前榜单里抽出的可直接播放曲目。',
      tracks: spotlight.slice(0, 6),
    });
  }

  if (toplists.length) {
    sections.push({
      id: 'netease-rank',
      title: '官方榜单',
      tab: 'rank' as const,
      kind: 'collection-list' as const,
      description: '直接取自网易云公开榜单接口。',
      collections: toplists
        .slice(0, 6)
        .map((item, index) => toToplistSummaryEntity(item, index)),
    });
  }

  if (playlists.length) {
    sections.push({
      id: 'netease-playlist',
      title: '推荐歌单',
      tab: 'playlist' as const,
      kind: 'collection-list' as const,
      description: '来自网易云公开推荐歌单接口。',
      collections: playlists
        .slice(0, 6)
        .map((item, index) => toRecommendedPlaylistSummaryEntity(item, index)),
    });
  }

  if (dailyTrackEntities.length) {
    sections.push({
      id: 'netease-daily',
      title: '每日推荐',
      tab: 'daily' as const,
      kind: 'track-list' as const,
      description: '已连接网易云会话后同步的每日推荐曲目。',
      tracks: dailyTrackEntities.slice(0, 12),
    });
  }

  if (fmTrackEntities.length) {
    sections.push({
      id: 'netease-fm',
      title: '私人 FM',
      tab: 'fm' as const,
      kind: 'track-list' as const,
      description: '已连接网易云会话后同步的连续 FM 曲目。',
      tracks: fmTrackEntities.slice(0, 12),
    });
  }

  if (albums.length) {
    sections.push({
      id: 'netease-album',
      title: '精选专辑',
      tab: 'album' as const,
      kind: 'collection-list' as const,
      description: '来自网易云新碟上架接口。',
      collections: albums
        .slice(0, 6)
        .map((item, index) => toNewestAlbumSummaryEntity(item, index)),
    });
  }

  return {
    source: 'netease',
    spotlight,
    sections,
    featuredQueue: createFeaturedQueue(spotlight),
  };
}

export function createNeteaseRepository(): MusicProviderRepositorySet {
  return {
    sourceRepository: {
      async getSources() {
        return [createNeteaseSourceEntity()];
      },
    },
    discoveryRepository: {
      async getHomeView(source, options) {
        assertNeteaseSource(source);
        return getHomeView(options?.sessionCookie);
      },
      async search(source, query, page = 1) {
        assertNeteaseSource(source);

        if (!query.trim()) {
          return {
            source: 'netease',
            query: '',
            tracks: [],
            collections: [],
          };
        }

        const [tracks, playlists, albums, artists] = await Promise.all([
          fetchSearchTracks(query, normalizePage(page)),
          fetchSearchPlaylists(query, normalizePage(page)),
          fetchSearchAlbums(query, normalizePage(page)),
          fetchSearchArtists(query, normalizePage(page)),
        ]);

        return toMusicSearchResultEntity({
          query,
          tracks,
          playlists,
          albums,
          artists,
        });
      },
      async getPersonalFm(source, options) {
        assertNeteaseSource(source);
        const sessionCookie = requireMusicSessionCookie(
          options?.sessionCookie,
          '未连接网易云账号，无法获取私人 FM'
        );

        return toPlayableTracks(await fetchPersonalFmTracks(sessionCookie));
      },
      async trashPersonalFmTrack(source, trackId, options) {
        assertNeteaseSource(source);
        const sessionCookie = requireMusicSessionCookie(
          options?.sessionCookie,
          '未连接网易云账号，无法操作私人 FM'
        );

        try {
          await sendPersonalFmTrashFeedback(trackId, sessionCookie);
        } catch (error) {
          console.error('标记私人 FM 不喜欢失败，继续刷新队列', error);
        }

        return toPlayableTracks(await fetchPersonalFmTracks(sessionCookie));
      },
    },
    collectionRepository: {
      async getCollection(source, id, kind?: MusicCollectionKind) {
        assertNeteaseSource(source);
        if (kind === 'album') {
          return toMusicAlbumCollectionEntity(await fetchAlbumDetail(id));
        }

        if (kind === 'artist-toplist') {
          const [topSongs, albums] = await Promise.all([
            fetchArtistTopSongs(id),
            fetchArtistAlbums(id),
          ]);

          return toMusicArtistToplistCollectionEntity({
            artistId: id,
            albums,
            topSongs,
          });
        }

        return toMusicCollectionEntity(await fetchPlaylistDetail(id));
      },
    },
    trackRepository: {
      async getTrackPlayback(source, id, quality = 'standard') {
        assertNeteaseSource(source);

        const track = toMusicTrackEntity(await fetchSongDetail(id));

        if (!track.playable) {
          throw new NeteaseApiError(
            '当前曲目受版权或会员限制，暂不可播放',
            403
          );
        }

        const normalizedQuality = resolvePlaybackQuality(quality);

        return {
          track,
          quality: normalizedQuality,
          streamUrl: `/api/music/stream?source=netease&id=${track.id}&quality=${normalizedQuality}`,
        };
      },
    },
    lyricRepository: {
      async getLyrics(source, trackId) {
        assertNeteaseSource(source);
        return toLyricDocumentEntity(trackId, await fetchLyric(trackId));
      },
    },
    streamRepository: {
      buildStreamPath(source, trackId, quality = 'standard') {
        assertNeteaseSource(source);
        const normalizedQuality = resolvePlaybackQuality(quality);

        return `/api/music/stream?source=netease&id=${trackId}&quality=${normalizedQuality}`;
      },
      async createStreamResponse(request) {
        return createNeteaseStreamResponse(request);
      },
    },
    accountRepository: {
      async getAccount(source, sessionCookie) {
        assertNeteaseSource(source);
        return getAccount(sessionCookie);
      },
      async createQrSession(source) {
        assertNeteaseSource(source);
        return createQrSession();
      },
      async pollQrSession(source, key) {
        assertNeteaseSource(source);
        return pollQrSession(key);
      },
    },
  };
}
