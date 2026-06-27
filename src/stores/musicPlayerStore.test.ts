'use client';

import type { MusicTrack } from '@/lib/music/types';
import { buildQueueItemFromTrack } from '@/lib/music/types';

import { getCurrentQueueTrack, useMusicPlayerStore } from './musicPlayerStore';

const trackA: MusicTrack = {
  id: 'netease-track-1',
  source: 'netease',
  title: '霓虹夜航',
  artists: [{ name: 'Luna Drive' }],
  album: {
    id: 'album-1',
    title: 'Midnight Circuits',
  },
  durationMs: 188000,
  playable: true,
};

const trackB: MusicTrack = {
  id: 'netease-track-2',
  source: 'netease',
  title: '晴空慢板',
  artists: [{ name: '北岸信号' }],
  album: {
    id: 'album-2',
    title: 'Blue Afternoon',
  },
  durationMs: 214000,
  playable: true,
};

const queue = [
  buildQueueItemFromTrack(trackA),
  buildQueueItemFromTrack(trackB),
];

function resetPlayerStore() {
  useMusicPlayerStore.setState({
    hasHydrated: true,
    queue: [],
    currentIndex: -1,
    playMode: 'list-loop',
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
  });
  localStorage.clear();
}

describe('musicPlayerStore', () => {
  beforeEach(() => {
    resetPlayerStore();
  });

  it('starts playing a queue from the requested index', () => {
    useMusicPlayerStore.getState().playQueue(queue, 1);

    const state = useMusicPlayerStore.getState();

    expect(state.queue).toHaveLength(2);
    expect(state.currentIndex).toBe(1);
    expect(state.isPlaying).toBe(true);
    expect(state.isTrackLoading).toBe(true);
    expect(state.presentation).toBe('mini');
    expect(getCurrentQueueTrack(state)?.trackId).toBe(trackB.id);
  });

  it('deduplicates enqueued tracks and boots playback from an empty queue', () => {
    useMusicPlayerStore
      .getState()
      .enqueueTracks([queue[0], queue[0], queue[1]]);

    const state = useMusicPlayerStore.getState();

    expect(state.queue).toHaveLength(2);
    expect(state.currentIndex).toBe(0);
    expect(state.isPlaying).toBe(true);
    expect(state.isTrackLoading).toBe(true);
    expect(state.presentation).toBe('mini');
    expect(getCurrentQueueTrack(state)?.trackId).toBe(trackA.id);
  });

  it('wraps to the first track in list-loop mode when playing next from the end', () => {
    useMusicPlayerStore.getState().playQueue(queue, 1);
    useMusicPlayerStore.setState({
      isTrackLoading: false,
      streamUrl: '/media/audio/stream?source=netease&id=netease-track-2',
    });

    useMusicPlayerStore.getState().playNext();

    const state = useMusicPlayerStore.getState();

    expect(state.currentIndex).toBe(0);
    expect(state.isPlaying).toBe(true);
    expect(state.streamUrl).toBeNull();
    expect(state.isTrackLoading).toBe(true);
  });

  it('stops playback without hiding the current player surface', () => {
    useMusicPlayerStore.getState().playQueue(queue, 0);
    useMusicPlayerStore.setState({
      currentTimeSec: 84,
      durationSec: 188,
      isTrackLoading: false,
      presentation: 'expanded',
      streamUrl: '/media/audio/stream?source=netease&id=netease-track-1',
    });

    useMusicPlayerStore.getState().stopPlayback();

    const state = useMusicPlayerStore.getState();

    expect(state.isPlaying).toBe(false);
    expect(state.currentTimeSec).toBe(0);
    expect(state.presentation).toBe('expanded');
    expect(getCurrentQueueTrack(state)?.trackId).toBe(trackA.id);
  });

  it('dismisses the player while preserving the queue', () => {
    useMusicPlayerStore.getState().playQueue(queue, 0);
    useMusicPlayerStore.getState().expandPlayer();

    useMusicPlayerStore.getState().dismissPlayer();

    const state = useMusicPlayerStore.getState();

    expect(state.presentation).toBe('hidden');
    expect(state.isPlaying).toBe(false);
    expect(state.queue).toHaveLength(2);
    expect(state.currentIndex).toBe(0);
  });
});
