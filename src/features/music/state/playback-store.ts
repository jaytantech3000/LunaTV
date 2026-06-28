'use client';

import { create } from 'zustand';

import type { QueueItemEntity } from '../domain/entities';

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
  error: string | null;
  seedQueue: (queue: QueueItemEntity[]) => void;
  playNext: () => void;
  playPrevious: () => void;
  setPlayState: (playState: PlaybackState['playState']) => void;
  setPositionMs: (positionMs: number) => void;
  setDurationMs: (durationMs: number) => void;
  setError: (error: string | null) => void;
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
  error: null,
  seedQueue: (queue) =>
    set({
      queue,
      currentTrackId: queue[0]?.track.id ?? null,
      playState: queue.length > 0 ? 'playing' : 'idle',
      positionMs: 0,
      durationMs: queue[0]?.track.durationMs ?? 0,
      error: null,
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
      };
    }),
  setPlayState: (playState) => set({ playState }),
  setPositionMs: (positionMs) => set({ positionMs }),
  setDurationMs: (durationMs) => set({ durationMs }),
  setError: (error) => set({ error }),
}));
