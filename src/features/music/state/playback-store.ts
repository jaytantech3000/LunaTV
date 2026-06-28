'use client';

import { create } from 'zustand';

import type { MusicTrackEntity, QueueItemEntity } from '../domain/entities';

export interface PlaybackState {
  queue: QueueItemEntity[];
  currentTrackId: string | null;
  playState: 'idle' | 'playing' | 'paused';
  playMode: 'list-loop' | 'single-loop';
  volume: number;
  muted: boolean;
  positionMs: number;
  durationMs: number;
  bufferedMs: number;
  requestedSeekMs: number | null;
  error: string | null;
  seedQueue: (queue: QueueItemEntity[], startTrackId?: string) => void;
  playNext: () => void;
  playPrevious: () => void;
  selectTrack: (trackId: string, autoPlay?: boolean) => void;
  updateTrack: (track: MusicTrackEntity) => void;
  requestSeek: (positionMs: number) => void;
  clearRequestedSeek: () => void;
  setPlayState: (playState: PlaybackState['playState']) => void;
  setPositionMs: (positionMs: number) => void;
  setDurationMs: (durationMs: number) => void;
  setBufferedMs: (bufferedMs: number) => void;
  togglePlayMode: () => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
  setError: (error: string | null) => void;
}

function clampPlaybackLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 0;
  }

  return Math.min(Math.max(level, 0), 1);
}

export function selectCurrentQueueItem(
  state: Pick<PlaybackState, 'queue' | 'currentTrackId'>
): QueueItemEntity | null {
  return (
    state.queue.find((item) => item.track.id === state.currentTrackId) ?? null
  );
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  queue: [],
  currentTrackId: null,
  playState: 'idle',
  playMode: 'list-loop',
  volume: 0.9,
  muted: false,
  positionMs: 0,
  durationMs: 0,
  bufferedMs: 0,
  requestedSeekMs: null,
  error: null,
  seedQueue: (queue, startTrackId) =>
    set(() => {
      const selectedTrack =
        queue.find((item) => item.track.id === startTrackId) ??
        queue[0] ??
        null;

      return {
        queue,
        currentTrackId: selectedTrack?.track.id ?? null,
        playState: queue.length > 0 ? 'playing' : 'idle',
        positionMs: 0,
        durationMs: selectedTrack?.track.durationMs ?? 0,
        bufferedMs: 0,
        requestedSeekMs: null,
        error: null,
      };
    }),
  playNext: () =>
    set((state) => {
      const currentIndex = state.queue.findIndex(
        (item) => item.track.id === state.currentTrackId
      );
      const nextItem = state.queue[currentIndex + 1] ?? state.queue[0] ?? null;

      return {
        currentTrackId: nextItem?.track.id ?? null,
        durationMs: nextItem?.track.durationMs ?? 0,
        positionMs: 0,
        bufferedMs: 0,
        requestedSeekMs: null,
      };
    }),
  playPrevious: () =>
    set((state) => {
      const currentIndex = state.queue.findIndex(
        (item) => item.track.id === state.currentTrackId
      );
      const previousItem =
        state.queue[currentIndex - 1] ??
        state.queue[state.queue.length - 1] ??
        null;

      return {
        currentTrackId: previousItem?.track.id ?? null,
        durationMs: previousItem?.track.durationMs ?? 0,
        positionMs: 0,
        bufferedMs: 0,
        requestedSeekMs: null,
      };
    }),
  selectTrack: (trackId, autoPlay = true) =>
    set((state) => {
      const selectedItem =
        state.queue.find((item) => item.track.id === trackId) ?? null;

      if (!selectedItem) {
        return state;
      }

      return {
        currentTrackId: selectedItem.track.id,
        durationMs: selectedItem.track.durationMs,
        positionMs: 0,
        bufferedMs: 0,
        requestedSeekMs: null,
        playState: autoPlay
          ? 'playing'
          : state.playState === 'idle'
          ? 'paused'
          : state.playState,
        error: null,
      };
    }),
  updateTrack: (track) =>
    set((state) => ({
      queue: state.queue.map((item) =>
        item.track.id === track.id
          ? {
              ...item,
              track: {
                ...item.track,
                ...track,
              },
            }
          : item
      ),
      durationMs:
        state.currentTrackId === track.id ? track.durationMs : state.durationMs,
    })),
  requestSeek: (positionMs) =>
    set(() => {
      const normalizedPosition = Math.max(positionMs, 0);

      return {
        requestedSeekMs: normalizedPosition,
        positionMs: normalizedPosition,
      };
    }),
  clearRequestedSeek: () => set({ requestedSeekMs: null }),
  setPlayState: (playState) => set({ playState }),
  setPositionMs: (positionMs) => set({ positionMs }),
  setDurationMs: (durationMs) => set({ durationMs }),
  setBufferedMs: (bufferedMs) =>
    set(() => ({
      bufferedMs: Math.max(bufferedMs, 0),
    })),
  togglePlayMode: () =>
    set((state) => ({
      playMode: state.playMode === 'list-loop' ? 'single-loop' : 'list-loop',
    })),
  setVolume: (volume) =>
    set(() => ({
      volume: clampPlaybackLevel(volume),
    })),
  setMuted: (muted) => set({ muted }),
  toggleMuted: () =>
    set((state) => ({
      muted: !state.muted,
    })),
  setError: (error) => set({ error }),
}));
