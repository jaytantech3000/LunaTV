'use client';

/* eslint-disable no-console */

import { create } from 'zustand';

import { useLyricsStore } from './lyrics-store';
import { useMusicLibraryStore } from './music-library-store';
import { selectCurrentQueueItem, usePlaybackStore } from './playback-store';
import { usePlayerSurfaceStore } from './player-surface-store';
import type {
  LiveMusicSourceKey,
  MusicCollectionEntity,
  MusicCollectionKind,
  MusicHomeSectionEntity,
  MusicHomeView,
  MusicPlaybackQuality,
  MusicSearchResultEntity,
  MusicTrackEntity,
  QueueItemEntity,
} from '../domain/entities';
import {
  fetchMusicCollectionDetail,
  fetchMusicHomeView,
  fetchMusicLyricDocument,
  fetchMusicPersonalFmTracks,
  fetchMusicTrackPlayback,
  searchMusicCatalog,
  trashMusicPersonalFmTrack,
} from '../services/music-api-client';
import {
  readCachedMusicPreferences,
  saveMusicPreferencesPatch,
} from '../services/music-preferences';

const defaultMusicPreferences = readCachedMusicPreferences();

type MusicPlayContext =
  | 'featured'
  | 'search'
  | 'collection'
  | 'discovery'
  | 'library'
  | 'download'
  | 'recent';

export interface MusicDataState {
  source: LiveMusicSourceKey;
  homeView: MusicHomeView | null;
  searchResult: MusicSearchResultEntity | null;
  selectedCollection: MusicCollectionEntity | null;
  preferredPlaybackQuality: MusicPlaybackQuality;
  loading: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  setPreferredPlaybackQuality: (
    preferredPlaybackQuality: MusicPlaybackQuality
  ) => void;
  submitSearch: (query: string) => Promise<MusicSearchResultEntity | null>;
  openCollection: (id: string, kind?: MusicCollectionKind) => Promise<void>;
  clearSelectedCollection: () => void;
  playTrack: (id: string, context?: MusicPlayContext) => Promise<void>;
  advancePlayback: () => Promise<void>;
  trashCurrentPersonalFmTrack: () => Promise<void>;
}

function resolveStoreErrorMessage(
  error: unknown,
  fallbackMessage: string
): string {
  if (error instanceof Error) {
    return error.message || fallbackMessage;
  }

  return fallbackMessage;
}

function createQueueItemEntity(
  track: MusicTrackEntity,
  index: number,
  fromContext: QueueItemEntity['fromContext']
): QueueItemEntity {
  return {
    queueId: `${track.source}-${fromContext}-${track.id}-${index}`,
    track,
    addedAt: index + 1,
    fromContext,
  };
}

function resolveDiscoveryQueue(
  homeView: MusicHomeView | null,
  trackId: string
): QueueItemEntity[] {
  const discoverySection = homeView?.sections.find(
    (section) =>
      section.kind === 'track-list' &&
      section.tracks?.some((track) => track.id === trackId)
  );
  const queueContext =
    discoverySection?.tab === 'fm' ? ('fm' as const) : ('discovery' as const);

  return (
    discoverySection?.tracks?.map((track, index) =>
      createQueueItemEntity(track, index, queueContext)
    ) || []
  );
}

function createPersonalFmSection(
  tracks: MusicTrackEntity[]
): MusicHomeSectionEntity {
  return {
    id: 'netease-fm',
    title: '私人 FM',
    tab: 'fm',
    kind: 'track-list',
    description: '已连接网易云会话后同步的连续 FM 曲目。',
    tracks,
  };
}

function syncPersonalFmSection(
  homeView: MusicHomeView | null,
  tracks: MusicTrackEntity[]
): MusicHomeView | null {
  if (!homeView) {
    return homeView;
  }

  let replaced = false;
  const sections = homeView.sections.flatMap((section) => {
    if (section.tab !== 'fm') {
      return [section];
    }

    replaced = true;

    return tracks.length > 0 ? [createPersonalFmSection(tracks)] : [];
  });

  if (!replaced) {
    return tracks.length > 0
      ? {
          ...homeView,
          sections: [...homeView.sections, createPersonalFmSection(tracks)],
        }
      : homeView;
  }

  return {
    ...homeView,
    sections,
  };
}

function createPersonalFmQueue(tracks: MusicTrackEntity[]): QueueItemEntity[] {
  return tracks.map((track, index) =>
    createQueueItemEntity(track, index, 'fm')
  );
}

function resolvePlaybackQueue(
  state: Pick<
    MusicDataState,
    'homeView' | 'searchResult' | 'selectedCollection'
  >,
  trackId: string,
  context?: MusicPlayContext
): QueueItemEntity[] {
  if (
    context === 'library' ||
    context === 'recent' ||
    context === 'download'
  ) {
    const localQueue = useMusicLibraryStore
      .getState()
      .buildPlaybackQueue(trackId, context);

    if (localQueue.length > 0) {
      return localQueue;
    }
  }

  const collectionTracks = state.selectedCollection?.tracks || [];

  if (
    context === 'collection' &&
    collectionTracks.some((track) => track.id === trackId)
  ) {
    return collectionTracks.map((track, index) =>
      createQueueItemEntity(track, index, 'library')
    );
  }

  const searchTracks = state.searchResult?.tracks || [];

  if (
    context === 'search' &&
    searchTracks.some((track) => track.id === trackId)
  ) {
    return searchTracks.map((track, index) =>
      createQueueItemEntity(track, index, 'recent')
    );
  }

  const discoveryQueue = resolveDiscoveryQueue(state.homeView, trackId);

  if (context === 'discovery' && discoveryQueue.length > 0) {
    return discoveryQueue;
  }

  const featuredQueue = state.homeView?.featuredQueue || [];

  if (
    context === 'featured' &&
    featuredQueue.some((item) => item.track.id === trackId)
  ) {
    return featuredQueue;
  }

  if (collectionTracks.some((track) => track.id === trackId)) {
    return collectionTracks.map((track, index) =>
      createQueueItemEntity(track, index, 'library')
    );
  }

  if (searchTracks.some((track) => track.id === trackId)) {
    return searchTracks.map((track, index) =>
      createQueueItemEntity(track, index, 'recent')
    );
  }

  if (discoveryQueue.length > 0) {
    return discoveryQueue;
  }

  if (featuredQueue.some((item) => item.track.id === trackId)) {
    return featuredQueue;
  }

  return [];
}

export const useMusicDataStore = create<MusicDataState>((set, get) => ({
  source: 'netease',
  homeView: null,
  searchResult: null,
  selectedCollection: null,
  preferredPlaybackQuality: defaultMusicPreferences.preferredPlaybackQuality,
  loading: false,
  error: null,
  setPreferredPlaybackQuality: (preferredPlaybackQuality) =>
    set(() => {
      void saveMusicPreferencesPatch({
        preferredPlaybackQuality,
      });

      return {
        preferredPlaybackQuality,
      };
    }),
  advancePlayback: async () => {
    const playbackState = usePlaybackStore.getState();
    const currentQueueItem = selectCurrentQueueItem(playbackState);

    if (!currentQueueItem) {
      return;
    }

    if (currentQueueItem.fromContext !== 'fm') {
      playbackState.playNext();
      return;
    }

    const currentIndex = playbackState.queue.findIndex(
      (item) => item.track.id === currentQueueItem.track.id
    );

    if (currentIndex >= 0 && currentIndex < playbackState.queue.length - 1) {
      playbackState.playNext();
      return;
    }

    set({
      loading: true,
      error: null,
    });

    try {
      const tracks = await fetchMusicPersonalFmTracks({
        source: get().source,
      });
      const nextQueue = createPersonalFmQueue(tracks);

      if (!nextQueue.length) {
        throw new Error('私人 FM 暂无可播放曲目');
      }

      useLyricsStore.getState().setLyrics(null);
      usePlaybackStore.getState().seedQueue(nextQueue, nextQueue[0]?.track.id);
      usePlayerSurfaceStore.getState().showMiniPlayer();

      set((state) => ({
        homeView: syncPersonalFmSection(state.homeView, tracks),
        loading: false,
        error: null,
      }));
    } catch (error) {
      console.error('续播私人 FM 失败', error);
      usePlaybackStore
        .getState()
        .setError(resolveStoreErrorMessage(error, '续播私人 FM 失败'));
      set({
        error: resolveStoreErrorMessage(error, '续播私人 FM 失败'),
        loading: false,
      });
    }
  },
  bootstrap: async () => {
    set({
      loading: true,
      error: null,
    });

    try {
      const homeView = await fetchMusicHomeView(get().source);

      set({
        homeView,
        loading: false,
      });
    } catch (error) {
      console.error('加载音乐首页失败', error);
      set({
        error: resolveStoreErrorMessage(error, '加载音乐首页失败'),
        loading: false,
      });
    }
  },
  submitSearch: async (query) => {
    set({
      loading: true,
      error: null,
    });

    try {
      const searchResult = await searchMusicCatalog({
        source: get().source,
        query: query.trim(),
      });

      set({
        searchResult,
        loading: false,
      });

      return searchResult;
    } catch (error) {
      console.error('搜索音乐失败', error);
      set({
        error: resolveStoreErrorMessage(error, '搜索音乐失败'),
        loading: false,
      });

      return null;
    }
  },
  openCollection: async (id, kind) => {
    set({
      loading: true,
      error: null,
    });

    try {
      const selectedCollection = await fetchMusicCollectionDetail({
        source: get().source,
        id,
        kind,
      });

      set({
        selectedCollection: kind
          ? {
              ...selectedCollection,
              summary: {
                ...selectedCollection.summary,
                kind,
              },
            }
          : selectedCollection,
        loading: false,
      });
    } catch (error) {
      console.error('加载音乐合集失败', error);
      set({
        error: resolveStoreErrorMessage(error, '加载音乐合集失败'),
        loading: false,
      });
    }
  },
  clearSelectedCollection: () =>
    set({
      selectedCollection: null,
    }),
  trashCurrentPersonalFmTrack: async () => {
    const currentQueueItem = selectCurrentQueueItem(
      usePlaybackStore.getState()
    );

    if (!currentQueueItem || currentQueueItem.fromContext !== 'fm') {
      return;
    }

    set({
      loading: true,
      error: null,
    });

    try {
      const tracks = await trashMusicPersonalFmTrack({
        source: get().source,
        trackId: currentQueueItem.track.id,
      });
      const nextQueue = createPersonalFmQueue(tracks);

      if (!nextQueue.length) {
        throw new Error('私人 FM 暂无可播放曲目');
      }

      useLyricsStore.getState().setLyrics(null);
      usePlaybackStore.getState().seedQueue(nextQueue, nextQueue[0]?.track.id);
      usePlayerSurfaceStore.getState().showMiniPlayer();

      set((state) => ({
        homeView: syncPersonalFmSection(state.homeView, tracks),
        loading: false,
        error: null,
      }));
    } catch (error) {
      console.error('操作私人 FM 失败', error);
      usePlaybackStore
        .getState()
        .setError(resolveStoreErrorMessage(error, '操作私人 FM 失败'));
      set({
        error: resolveStoreErrorMessage(error, '操作私人 FM 失败'),
        loading: false,
      });
    }
  },
  playTrack: async (id, context) => {
    set({
      loading: true,
      error: null,
    });

    try {
      const [trackPlayback, lyrics] = await Promise.all([
        fetchMusicTrackPlayback({
          source: get().source,
          id,
          quality: get().preferredPlaybackQuality,
        }),
        fetchMusicLyricDocument({
          source: get().source,
          id,
        }),
      ]);
      const queue = resolvePlaybackQueue(get(), id, context);
      const hydratedQueue =
        queue.length > 0
          ? queue.map((item) =>
              item.track.id === trackPlayback.track.id
                ? {
                    ...item,
                    track: {
                      ...item.track,
                      ...trackPlayback.track,
                      stream: trackPlayback.streamUrl,
                    },
                  }
                : item
            )
          : [
              createQueueItemEntity(
                {
                  ...trackPlayback.track,
                  stream: trackPlayback.streamUrl,
                },
                0,
                'featured'
              ),
            ];

      usePlaybackStore
        .getState()
        .seedQueue(hydratedQueue, trackPlayback.track.id);
      useLyricsStore.getState().setLyrics(lyrics);
      usePlayerSurfaceStore.getState().showMiniPlayer();

      set({
        loading: false,
      });
    } catch (error) {
      console.error('播放曲目失败', error);
      usePlaybackStore
        .getState()
        .setError(resolveStoreErrorMessage(error, '播放曲目失败'));
      set({
        error: resolveStoreErrorMessage(error, '播放曲目失败'),
        loading: false,
      });
    }
  },
}));
