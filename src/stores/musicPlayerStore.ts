'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  type MusicLyricPayload,
  type MusicPlayMode,
  type PlayerQueueItem,
} from '@/lib/music/types';

interface MusicPlayerPersistedState {
  queue: PlayerQueueItem[];
  currentIndex: number;
  playMode: MusicPlayMode;
  volume: number;
  muted: boolean;
  currentTimeSec: number;
  recentTracks: PlayerQueueItem[];
}

interface MusicPlayerState extends MusicPlayerPersistedState {
  hasHydrated: boolean;
  isPlaying: boolean;
  expanded: boolean;
  durationSec: number;
  streamUrl: string | null;
  lyrics: MusicLyricPayload | null;
  isTrackLoading: boolean;
  trackError: string | null;
  setHasHydrated: (hasHydrated: boolean) => void;
  playQueue: (queue: PlayerQueueItem[], startIndex?: number) => void;
  selectQueueIndex: (index: number, shouldAutoplay?: boolean) => void;
  enqueueTracks: (tracks: PlayerQueueItem[]) => void;
  togglePlay: () => void;
  setIsPlaying: (isPlaying: boolean) => void;
  playNext: () => void;
  playPrevious: () => void;
  cyclePlayMode: () => void;
  setExpanded: (expanded: boolean) => void;
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

function normalizeQueue(queue?: PlayerQueueItem[]): PlayerQueueItem[] {
  if (!Array.isArray(queue)) {
    return [];
  }

  return queue.filter(
    (item): item is PlayerQueueItem =>
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

function buildPersistedState(
  state: Partial<MusicPlayerPersistedState>
): MusicPlayerPersistedState {
  const queue = normalizeQueue(state.queue);

  return {
    queue,
    currentIndex: clampIndex(state.currentIndex ?? 0, queue),
    playMode:
      state.playMode === 'single-loop' || state.playMode === 'shuffle'
        ? state.playMode
        : 'list-loop',
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

export function getCurrentQueueTrack(state: Pick<MusicPlayerState, 'queue' | 'currentIndex'>) {
  if (state.currentIndex < 0 || state.currentIndex >= state.queue.length) {
    return null;
  }

  return state.queue[state.currentIndex] || null;
}

export const useMusicPlayerStore = create<MusicPlayerState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      queue: [],
      currentIndex: -1,
      playMode: 'list-loop',
      volume: 0.85,
      muted: false,
      currentTimeSec: 0,
      recentTracks: [],
      isPlaying: false,
      expanded: false,
      durationSec: 0,
      streamUrl: null,
      lyrics: null,
      isTrackLoading: false,
      trackError: null,
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      playQueue: (queue, startIndex = 0) =>
        set({
          queue: normalizeQueue(queue),
          currentIndex: clampIndex(startIndex, queue),
          currentTimeSec: 0,
          durationSec: 0,
          streamUrl: null,
          lyrics: null,
          trackError: null,
          isTrackLoading: true,
          isPlaying: normalizeQueue(queue).length > 0,
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
          };
        }),
      togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      playNext: () =>
        set((state) => {
          if (state.queue.length === 0) {
            return state;
          }

          let nextIndex = state.currentIndex;

          if (state.playMode === 'single-loop') {
            nextIndex = clampIndex(state.currentIndex, state.queue);
          } else if (state.playMode === 'shuffle') {
            if (state.queue.length > 1) {
              do {
                nextIndex = Math.floor(Math.random() * state.queue.length);
              } while (nextIndex === state.currentIndex);
            }
          } else {
            nextIndex = state.currentIndex + 1;
            if (nextIndex >= state.queue.length) {
              nextIndex = 0;
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
          };
        }),
      playPrevious: () =>
        set((state) => {
          if (state.queue.length === 0) {
            return state;
          }

          let nextIndex = state.currentIndex - 1;
          if (nextIndex < 0) {
            nextIndex = state.queue.length - 1;
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
          };
        }),
      cyclePlayMode: () =>
        set((state) => ({
          playMode:
            state.playMode === 'list-loop'
              ? 'single-loop'
              : state.playMode === 'single-loop'
              ? 'shuffle'
              : 'list-loop',
        })),
      setExpanded: (expanded) => set({ expanded }),
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
            typeof durationSec === 'number' && durationSec >= 0 ? durationSec : 0,
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
          playMode: state.playMode,
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
    (entry) =>
      entry.trackId === track.trackId && entry.source === track.source
  );
}

function get() {
  return useMusicPlayerStore.getState();
}
