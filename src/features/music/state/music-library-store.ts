'use client';

/* eslint-disable no-console */

import { create } from 'zustand';

import type {
  MusicCollectionSummaryEntity,
  MusicTrackEntity,
  QueueItemEntity,
} from '../domain/entities';
import {
  type SavedMusicCollectionRecord,
  buildMusicCollectionProfileKey,
  clearMusicCollections,
  deleteMusicCollection,
  getMusicSavedCollections,
  saveMusicCollection,
} from '../services/music-collection-profile';
import {
  type MusicFavoriteRecord,
  type MusicPlayRecord,
  type MusicRecentTrackRecord,
  buildMusicProfileKey,
  clearAllMusicFavorites,
  clearAllMusicPlayRecords,
  clearAllMusicRecentTracks,
  deleteMusicFavorite,
  getAllMusicFavorites,
  getAllMusicPlayRecords,
  getMusicRecentTracks,
  saveMusicFavorite,
} from '../services/music-profile';

interface MusicLibraryState {
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  savedCollections: SavedMusicCollectionRecord[];
  favoriteTracks: MusicFavoriteRecord[];
  recentTracks: MusicRecentTrackRecord[];
  resumeTracks: MusicPlayRecord[];
  savedCollectionKeys: string[];
  favoriteTrackKeys: string[];
  hydrateLibrary: () => Promise<void>;
  toggleSavedCollection: (
    summary: MusicCollectionSummaryEntity
  ) => Promise<void>;
  removeSavedCollection: (
    collection: Pick<MusicCollectionSummaryEntity, 'source' | 'id'>
  ) => Promise<void>;
  isCollectionSaved: (
    collection: Pick<MusicCollectionSummaryEntity, 'source' | 'id'>
  ) => boolean;
  clearSavedCollections: () => Promise<void>;
  toggleFavoriteTrack: (track: MusicTrackEntity) => Promise<void>;
  isTrackFavorited: (track: Pick<MusicTrackEntity, 'source' | 'id'>) => boolean;
  clearFavoriteTracks: () => Promise<void>;
  clearRecentTracks: () => Promise<void>;
  clearResumeTracks: () => Promise<void>;
  buildPlaybackQueue: (
    trackId: string,
    context: 'library' | 'recent'
  ) => QueueItemEntity[];
}

function resolveLibraryErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || '加载本地音乐资料失败';
  }

  return '加载本地音乐资料失败';
}

function createQueueItemEntity(
  track: MusicTrackEntity,
  index: number,
  fromContext: QueueItemEntity['fromContext']
): QueueItemEntity {
  return {
    queueId: `${track.source}-${fromContext}-${track.id}-${index}`,
    addedAt: index + 1,
    fromContext,
    track,
  };
}

function sortByPlayedAt(
  left: MusicRecentTrackRecord | MusicPlayRecord,
  right: MusicRecentTrackRecord | MusicPlayRecord
): number {
  return right.playedAt - left.playedAt;
}

function buildResumeTracks(
  records: Record<string, MusicPlayRecord>
): MusicPlayRecord[] {
  return Object.values(records)
    .filter(
      (record) =>
        !record.completed &&
        record.playTimeMs > 0 &&
        (record.durationMs === 0 || record.playTimeMs < record.durationMs)
    )
    .sort(sortByPlayedAt);
}

function buildRecentPlaybackTracks(
  recentTracks: MusicRecentTrackRecord[],
  resumeTracks: MusicPlayRecord[]
): MusicTrackEntity[] {
  const mergedTimeline = [
    ...resumeTracks.map((record) => ({
      track: record.track,
      playedAt: record.playedAt,
    })),
    ...recentTracks.map((record) => ({
      track: record.track,
      playedAt: record.playedAt,
    })),
  ].sort(sortByPlayedAt);

  const trackMap = new Map<string, MusicTrackEntity>();

  for (const record of mergedTimeline) {
    const key = buildMusicProfileKey(record.track.source, record.track.id);

    if (!trackMap.has(key)) {
      trackMap.set(key, record.track);
    }
  }

  return Array.from(trackMap.values());
}

export const useMusicLibraryStore = create<MusicLibraryState>((set, get) => ({
  hydrated: false,
  loading: false,
  error: null,
  savedCollections: [],
  favoriteTracks: [],
  recentTracks: [],
  resumeTracks: [],
  savedCollectionKeys: [],
  favoriteTrackKeys: [],
  hydrateLibrary: async () => {
    set({
      loading: true,
      error: null,
    });

    try {
      const [savedCollections, favorites, recentTracks, playRecords] =
        await Promise.all([
          getMusicSavedCollections(),
          getAllMusicFavorites(),
          getMusicRecentTracks(),
          getAllMusicPlayRecords(),
        ]);
      const favoriteTracks = Object.values(favorites).sort(
        (left, right) => right.savedAt - left.savedAt
      );
      const resumeTracks = buildResumeTracks(playRecords);

      set({
        hydrated: true,
        loading: false,
        error: null,
        savedCollections,
        favoriteTracks,
        recentTracks,
        resumeTracks,
        savedCollectionKeys: savedCollections.map((record) =>
          buildMusicCollectionProfileKey(
            record.summary.source,
            record.summary.id
          )
        ),
        favoriteTrackKeys: favoriteTracks.map((record) =>
          buildMusicProfileKey(record.track.source, record.track.id)
        ),
      });
    } catch (error) {
      console.error('加载本地音乐资料失败', error);
      set({
        hydrated: true,
        loading: false,
        error: resolveLibraryErrorMessage(error),
      });
    }
  },
  toggleSavedCollection: async (summary) => {
    const savedCollectionKey = buildMusicCollectionProfileKey(
      summary.source,
      summary.id
    );
    const isSaved = get().savedCollectionKeys.includes(savedCollectionKey);

    if (isSaved) {
      await deleteMusicCollection(summary.source, summary.id);
    } else {
      await saveMusicCollection(summary);
    }

    await get().hydrateLibrary();
  },
  isCollectionSaved: (collection) =>
    get().savedCollectionKeys.includes(
      buildMusicCollectionProfileKey(collection.source, collection.id)
    ),
  removeSavedCollection: async (collection) => {
    const collectionKey = buildMusicCollectionProfileKey(
      collection.source,
      collection.id
    );
    const previousSavedCollections = get().savedCollections;
    const previousSavedCollectionKeys = get().savedCollectionKeys;

    set({
      error: null,
      savedCollections: previousSavedCollections.filter((record) => {
        const recordKey = buildMusicCollectionProfileKey(
          record.summary.source,
          record.summary.id
        );

        return recordKey !== collectionKey;
      }),
      savedCollectionKeys: previousSavedCollectionKeys.filter(
        (recordKey) => recordKey !== collectionKey
      ),
    });

    try {
      await deleteMusicCollection(collection.source, collection.id);
      await get().hydrateLibrary();
    } catch (error) {
      console.error('删除已保存音乐合集失败', error);
      set({
        error: resolveLibraryErrorMessage(error),
        savedCollections: previousSavedCollections,
        savedCollectionKeys: previousSavedCollectionKeys,
      });
      throw error;
    }
  },
  clearSavedCollections: async () => {
    const previousSavedCollections = get().savedCollections;
    const previousSavedCollectionKeys = get().savedCollectionKeys;

    set({
      error: null,
      savedCollections: [],
      savedCollectionKeys: [],
    });

    try {
      await clearMusicCollections();
    } catch (error) {
      console.error('清空已保存音乐合集失败', error);
      set({
        error: resolveLibraryErrorMessage(error),
        savedCollections: previousSavedCollections,
        savedCollectionKeys: previousSavedCollectionKeys,
      });
      throw error;
    }
  },
  toggleFavoriteTrack: async (track) => {
    const favoriteTrackKey = buildMusicProfileKey(track.source, track.id);
    const isFavorited = get().favoriteTrackKeys.includes(favoriteTrackKey);

    if (isFavorited) {
      await deleteMusicFavorite(track.source, track.id);
    } else {
      await saveMusicFavorite(track);
    }

    await get().hydrateLibrary();
  },
  isTrackFavorited: (track) =>
    get().favoriteTrackKeys.includes(
      buildMusicProfileKey(track.source, track.id)
    ),
  clearFavoriteTracks: async () => {
    const previousFavoriteTracks = get().favoriteTracks;
    const previousFavoriteTrackKeys = get().favoriteTrackKeys;

    set({
      error: null,
      favoriteTracks: [],
      favoriteTrackKeys: [],
    });

    try {
      await clearAllMusicFavorites();
    } catch (error) {
      console.error('清空已保存歌曲失败', error);
      set({
        error: resolveLibraryErrorMessage(error),
        favoriteTracks: previousFavoriteTracks,
        favoriteTrackKeys: previousFavoriteTrackKeys,
      });
      throw error;
    }
  },
  clearRecentTracks: async () => {
    const previousRecentTracks = get().recentTracks;

    set({
      error: null,
      recentTracks: [],
    });

    try {
      await clearAllMusicRecentTracks();
    } catch (error) {
      console.error('清空最近播放失败', error);
      set({
        error: resolveLibraryErrorMessage(error),
        recentTracks: previousRecentTracks,
      });
      throw error;
    }
  },
  clearResumeTracks: async () => {
    const previousResumeTracks = get().resumeTracks;

    set({
      error: null,
      resumeTracks: [],
    });

    try {
      await clearAllMusicPlayRecords();
    } catch (error) {
      console.error('清空续播记录失败', error);
      set({
        error: resolveLibraryErrorMessage(error),
        resumeTracks: previousResumeTracks,
      });
      throw error;
    }
  },
  buildPlaybackQueue: (trackId, context) => {
    const state = get();
    const contextTracks =
      context === 'library'
        ? state.favoriteTracks.map((record) => record.track)
        : buildRecentPlaybackTracks(state.recentTracks, state.resumeTracks);

    if (!contextTracks.some((track) => track.id === trackId)) {
      return [];
    }

    return contextTracks.map((track, index) =>
      createQueueItemEntity(track, index, context)
    );
  },
}));
