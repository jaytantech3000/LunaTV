'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  type MusicLyricPayload,
  type MusicPlayMode,
  type MusicRepeatMode,
  type PlayerQueueItem,
} from '@/lib/music/types';

export type MusicPlayerPresentation = 'hidden' | 'mini' | 'expanded';
type MusicPlaybackAdvanceTrigger = 'manual' | 'ended';
type PersistedMusicPlayerSnapshot = Partial<MusicPlayerPersistedState> & {
  playMode?: MusicPlayMode;
};

interface MusicPlayerPersistedState {
  queue: PlayerQueueItem[];
  currentIndex: number;
  repeatMode: MusicRepeatMode;
  shuffleEnabled: boolean;
  volume: number;
  muted: boolean;
  currentTimeSec: number;
  recentTracks: PlayerQueueItem[];
}

interface MusicPlayerState extends MusicPlayerPersistedState {
  hasHydrated: boolean;
  isPlaying: boolean;
  presentation: MusicPlayerPresentation;
  durationSec: number;
  streamUrl: string | null;
  lyrics: MusicLyricPayload | null;
  isTrackLoading: boolean;
  trackError: string | null;
  shuffleHistory: number[];
  setHasHydrated: (hasHydrated: boolean) => void;
  playQueue: (queue: PlayerQueueItem[], startIndex?: number) => void;
  selectQueueIndex: (index: number, shouldAutoplay?: boolean) => void;
  enqueueTracks: (tracks: PlayerQueueItem[]) => void;
  togglePlay: () => void;
  setIsPlaying: (isPlaying: boolean) => void;
  playNext: (trigger?: MusicPlaybackAdvanceTrigger) => void;
  playPrevious: () => void;
  cycleRepeatMode: () => void;
  toggleShuffle: () => void;
  expandPlayer: () => void;
  collapsePlayer: () => void;
  dismissPlayer: () => void;
  stopPlayback: () => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setCurrentTimeSec: (currentTimeSec: number) => void;
  setDurationSec: (durationSec: number) => void;
  setStreamUrl: (streamUrl: string | null) => void;
  setLyrics: (lyrics: MusicLyricPayload | null) => void;
  setTrackLoading: (isTrackLoading: boolean) => void;
  setTrackError: (trackError: string | null) => void;
  syncRecentTrack: (track: PlayerQueueItem) => void;
  resetTransientPlaybackState: () => void;
}

const MUSIC_PLAYER_STORE_KEY = 'lunatv-music-player-v1';
const MAX_RECENT_TRACKS = 16;
const MAX_SHUFFLE_HISTORY = 64;

function normalizeQueue(queue?: PlayerQueueItem[]): PlayerQueueItem[] {
  if (!Array.isArray(queue)) {
    return [];
  }

  return queue.filter((item): item is PlayerQueueItem =>
    Boolean(
      item &&
        typeof item.trackId === 'string' &&
        typeof item.source === 'string' &&
        typeof item.title === 'string'
    )
  );
}

function normalizeRecentTracks(tracks?: PlayerQueueItem[]): PlayerQueueItem[] {
  const normalizedQueue = normalizeQueue(tracks);
  const seen = new Set<string>();

  return normalizedQueue.filter((track) => {
    const key = `${track.source}:${track.trackId}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function clampIndex(index: number, queue: PlayerQueueItem[]): number {
  if (queue.length === 0) {
    return -1;
  }

  return Math.min(Math.max(index, 0), queue.length - 1);
}

function normalizeVolume(volume: number) {
  if (!Number.isFinite(volume)) {
    return 0.85;
  }

  return Math.min(Math.max(volume, 0), 1);
}

function normalizeRepeatMode(
  repeatMode: MusicRepeatMode | undefined,
  legacyPlayMode: MusicPlayMode | undefined
): MusicRepeatMode {
  if (repeatMode === 'off' || repeatMode === 'all' || repeatMode === 'one') {
    return repeatMode;
  }

  if (legacyPlayMode === 'single-loop') {
    return 'one';
  }

  return 'all';
}

function normalizeShuffleEnabled(
  shuffleEnabled: boolean | undefined,
  legacyPlayMode: MusicPlayMode | undefined
) {
  if (typeof shuffleEnabled === 'boolean') {
    return shuffleEnabled;
  }

  return legacyPlayMode === 'shuffle';
}

function hasQueueTrack(queue: PlayerQueueItem[], currentIndex: number) {
  return clampIndex(currentIndex, queue) >= 0;
}

function resolveCollapsedPresentation(
  queue: PlayerQueueItem[],
  currentIndex: number
): MusicPlayerPresentation {
  return hasQueueTrack(queue, currentIndex) ? 'mini' : 'hidden';
}

function buildPersistedState(
  state: PersistedMusicPlayerSnapshot
): MusicPlayerPersistedState {
  const queue = normalizeQueue(state.queue);

  return {
    queue,
    currentIndex: clampIndex(state.currentIndex ?? 0, queue),
    repeatMode: normalizeRepeatMode(state.repeatMode, state.playMode),
    shuffleEnabled: normalizeShuffleEnabled(
      state.shuffleEnabled,
      state.playMode
    ),
    volume: normalizeVolume(state.volume ?? 0.85),
    muted: Boolean(state.muted),
    currentTimeSec:
      typeof state.currentTimeSec === 'number' && state.currentTimeSec >= 0
        ? state.currentTimeSec
        : 0,
    recentTracks: normalizeRecentTracks(state.recentTracks).slice(
      0,
      MAX_RECENT_TRACKS
    ),
  };
}

export function getCurrentQueueTrack(
  state: Pick<MusicPlayerState, 'queue' | 'currentIndex'>
) {
  if (state.currentIndex < 0 || state.currentIndex >= state.queue.length) {
    return null;
  }

  return state.queue[state.currentIndex] || null;
}

export const useMusicPlayerStore = create<MusicPlayerState>()(
  persist(
    (set) => ({
      hasHydrated: false,
      queue: [],
      currentIndex: -1,
      repeatMode: 'all',
      shuffleEnabled: false,
      volume: 0.85,
      muted: false,
      currentTimeSec: 0,
      recentTracks: [],
      isPlaying: false,
      presentation: 'hidden',
      durationSec: 0,
      streamUrl: null,
      lyrics: null,
      isTrackLoading: false,
      trackError: null,
      shuffleHistory: [],
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      playQueue: (queue, startIndex = 0) =>
        set(() => {
          const normalizedQueue = normalizeQueue(queue);
          const currentIndex = clampIndex(startIndex, normalizedQueue);
          const hasTrack = normalizedQueue.length > 0;

          return {
            queue: normalizedQueue,
            currentIndex,
            currentTimeSec: 0,
            durationSec: 0,
            streamUrl: null,
            lyrics: null,
            trackError: null,
            isTrackLoading: hasTrack,
            isPlaying: hasTrack,
            shuffleHistory: [],
            presentation: resolveCollapsedPresentation(
              normalizedQueue,
              currentIndex
            ),
          };
        }),
      selectQueueIndex: (index, shouldAutoplay = true) =>
        set((state) => ({
          currentIndex: clampIndex(index, state.queue),
          currentTimeSec: 0,
          durationSec: 0,
          streamUrl: null,
          lyrics: null,
          trackError: null,
          isTrackLoading: state.queue.length > 0,
          isPlaying: state.queue.length > 0 ? shouldAutoplay : false,
          shuffleHistory: [],
          presentation:
            state.queue.length === 0
              ? 'hidden'
              : state.presentation === 'hidden'
              ? 'mini'
              : state.presentation,
        })),
      enqueueTracks: (tracks) =>
        set((state) => {
          const seen = new Set(
            state.queue.map((track) => `${track.source}:${track.trackId}`)
          );
          const nextTracks = tracks.filter((track) => {
            const key = `${track.source}:${track.trackId}`;
            if (seen.has(key)) {
              return false;
            }

            seen.add(key);
            return true;
          });

          if (nextTracks.length === 0) {
            return state;
          }

          const nextQueue = [...state.queue, ...nextTracks];
          const nextIndex = state.currentIndex < 0 ? 0 : state.currentIndex;

          return {
            queue: nextQueue,
            currentIndex: clampIndex(nextIndex, nextQueue),
            isPlaying: state.currentIndex < 0 ? true : state.isPlaying,
            isTrackLoading: state.currentIndex < 0,
            shuffleHistory: state.currentIndex < 0 ? [] : state.shuffleHistory,
            presentation:
              state.currentIndex < 0
                ? resolveCollapsedPresentation(nextQueue, nextIndex)
                : state.presentation,
          };
        }),
      togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      playNext: (trigger = 'manual') =>
        set((state) => {
          if (state.queue.length === 0) {
            return state;
          }

          const currentIndex = clampIndex(state.currentIndex, state.queue);
          const atQueueEnd = currentIndex >= state.queue.length - 1;

          if (trigger === 'ended' && state.repeatMode === 'one') {
            return {
              currentIndex,
              currentTimeSec: 0,
              durationSec: 0,
              streamUrl: null,
              lyrics: null,
              trackError: null,
              isTrackLoading: true,
              isPlaying: true,
            };
          }

          if (state.shuffleEnabled && state.queue.length > 1) {
            let nextIndex = currentIndex;
            while (nextIndex === currentIndex) {
              nextIndex = Math.floor(Math.random() * state.queue.length);
            }

            return {
              currentIndex: clampIndex(nextIndex, state.queue),
              currentTimeSec: 0,
              durationSec: 0,
              streamUrl: null,
              lyrics: null,
              trackError: null,
              isTrackLoading: true,
              isPlaying: true,
              shuffleHistory: [...state.shuffleHistory, currentIndex].slice(
                -MAX_SHUFFLE_HISTORY
              ),
            };
          }

          if (atQueueEnd) {
            if (state.repeatMode === 'all') {
              return {
                currentIndex: 0,
                currentTimeSec: 0,
                durationSec: 0,
                streamUrl: null,
                lyrics: null,
                trackError: null,
                isTrackLoading: true,
                isPlaying: true,
                shuffleHistory: [],
              };
            }

            if (trigger === 'ended') {
              return {
                currentTimeSec: 0,
                isPlaying: false,
                isTrackLoading: false,
                shuffleHistory: [],
              };
            }

            return state;
          }

          const nextIndex = currentIndex + 1;

          return {
            currentIndex: clampIndex(nextIndex, state.queue),
            currentTimeSec: 0,
            durationSec: 0,
            streamUrl: null,
            lyrics: null,
            trackError: null,
            isTrackLoading: true,
            isPlaying: true,
            shuffleHistory: [],
          };
        }),
      playPrevious: () =>
        set((state) => {
          if (state.queue.length === 0) {
            return state;
          }

          if (state.shuffleEnabled && state.shuffleHistory.length > 0) {
            const nextIndex =
              state.shuffleHistory[state.shuffleHistory.length - 1];

            return {
              currentIndex: clampIndex(nextIndex, state.queue),
              currentTimeSec: 0,
              durationSec: 0,
              streamUrl: null,
              lyrics: null,
              trackError: null,
              isTrackLoading: true,
              isPlaying: true,
              shuffleHistory: state.shuffleHistory.slice(0, -1),
            };
          }

          let nextIndex = state.currentIndex - 1;
          if (nextIndex < 0) {
            if (state.repeatMode === 'all') {
              nextIndex = state.queue.length - 1;
            } else {
              return state;
            }
          }

          return {
            currentIndex: clampIndex(nextIndex, state.queue),
            currentTimeSec: 0,
            durationSec: 0,
            streamUrl: null,
            lyrics: null,
            trackError: null,
            isTrackLoading: true,
            isPlaying: true,
            shuffleHistory: [],
          };
        }),
      cycleRepeatMode: () =>
        set((state) => ({
          repeatMode:
            state.repeatMode === 'all'
              ? 'one'
              : state.repeatMode === 'one'
              ? 'off'
              : 'all',
        })),
      toggleShuffle: () =>
        set((state) => ({
          shuffleEnabled: !state.shuffleEnabled,
          shuffleHistory: [],
        })),
      expandPlayer: () =>
        set((state) => ({
          presentation: hasQueueTrack(state.queue, state.currentIndex)
            ? 'expanded'
            : 'hidden',
        })),
      collapsePlayer: () =>
        set((state) => ({
          presentation: resolveCollapsedPresentation(
            state.queue,
            state.currentIndex
          ),
        })),
      dismissPlayer: () =>
        set({
          isPlaying: false,
          isTrackLoading: false,
          presentation: 'hidden',
        }),
      stopPlayback: () =>
        set((state) => ({
          currentTimeSec: 0,
          isPlaying: false,
          isTrackLoading: false,
          presentation: state.presentation,
        })),
      setVolume: (volume) => set({ volume: normalizeVolume(volume) }),
      setMuted: (muted) => set({ muted }),
      setCurrentTimeSec: (currentTimeSec) =>
        set({
          currentTimeSec:
            typeof currentTimeSec === 'number' && currentTimeSec >= 0
              ? currentTimeSec
              : 0,
        }),
      setDurationSec: (durationSec) =>
        set({
          durationSec:
            typeof durationSec === 'number' && durationSec >= 0
              ? durationSec
              : 0,
        }),
      setStreamUrl: (streamUrl) => set({ streamUrl }),
      setLyrics: (lyrics) => set({ lyrics }),
      setTrackLoading: (isTrackLoading) => set({ isTrackLoading }),
      setTrackError: (trackError) => set({ trackError }),
      syncRecentTrack: (track) =>
        set((state) => {
          const deduped = [
            track,
            ...state.recentTracks.filter(
              (entry) =>
                `${entry.source}:${entry.trackId}` !==
                `${track.source}:${track.trackId}`
            ),
          ];

          return {
            recentTracks: deduped.slice(0, MAX_RECENT_TRACKS),
          };
        }),
      resetTransientPlaybackState: () =>
        set({
          durationSec: 0,
          streamUrl: null,
          lyrics: null,
          isTrackLoading: false,
          trackError: null,
        }),
    }),
    {
      name: MUSIC_PLAYER_STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): MusicPlayerPersistedState =>
        buildPersistedState({
          queue: state.queue,
          currentIndex: state.currentIndex,
          repeatMode: state.repeatMode,
          shuffleEnabled: state.shuffleEnabled,
          volume: state.volume,
          muted: state.muted,
          currentTimeSec: state.currentTimeSec,
          recentTracks: state.recentTracks,
        }),
      merge: (persistedState, currentState) => {
        const normalized = buildPersistedState(
          (persistedState as Partial<MusicPlayerPersistedState>) || {}
        );

        return {
          ...currentState,
          ...normalized,
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

export function getCurrentTrackKey(track: PlayerQueueItem | null | undefined) {
  if (!track) {
    return '';
  }

  return `${track.source}:${track.trackId}`;
}

export function getCurrentTrackFromStore() {
  return getCurrentQueueTrack(useMusicPlayerStore.getState());
}

export function queueContainsTrack(track: PlayerQueueItem) {
  const state = get();
  return state.queue.some(
    (entry) => entry.trackId === track.trackId && entry.source === track.source
  );
}

function get() {
  return useMusicPlayerStore.getState();
}
