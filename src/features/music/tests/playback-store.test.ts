import type { QueueItemEntity } from '../domain/entities';
import { useLyricsStore } from '../state/lyrics-store';
import {
  selectCurrentQueueItem,
  usePlaybackStore,
} from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

const FEATURED_QUEUE: QueueItemEntity[] = [
  {
    queueId: 'a',
    addedAt: 1,
    fromContext: 'featured',
    track: {
      id: 't1',
      source: 'netease',
      title: 'A',
      artists: ['x'],
      album: 'aa',
      coverUrl: '/logo.png',
      durationMs: 1000,
      stream: '/a.mp3',
      playable: true,
    },
  },
  {
    queueId: 'b',
    addedAt: 2,
    fromContext: 'featured',
    track: {
      id: 't2',
      source: 'netease',
      title: 'B',
      artists: ['y'],
      album: 'bb',
      coverUrl: '/logo.png',
      durationMs: 1000,
      stream: '/b.mp3',
      playable: true,
    },
  },
];

describe('music playback state', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
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
    });
    usePlayerSurfaceStore.setState({
      miniVisible: false,
      fullPlayerOpen: false,
      lyricsPanelOpen: true,
      queuePanelOpen: false,
      transitionState: 'idle',
    });
    useLyricsStore.setState({
      lyrics: null,
      activeLineIndex: -1,
      followMode: 'auto',
      manualSeekLock: false,
    });
  });

  it('selects the current queue item after seeding the queue', () => {
    usePlaybackStore.getState().seedQueue(FEATURED_QUEUE);

    expect(selectCurrentQueueItem(usePlaybackStore.getState())?.queueId).toBe(
      'a'
    );
  });

  it('advances to the next track in list-loop mode', () => {
    const playback = usePlaybackStore.getState();
    playback.seedQueue(FEATURED_QUEUE);

    playback.playNext();

    expect(usePlaybackStore.getState().currentTrackId).toBe('t2');
  });

  it('selects an explicit queue track and resumes playback from the top', () => {
    const playback = usePlaybackStore.getState();
    playback.seedQueue(FEATURED_QUEUE);
    playback.setPlayState('paused');
    playback.setPositionMs(480);

    playback.selectTrack('t2');

    expect(usePlaybackStore.getState().currentTrackId).toBe('t2');
    expect(usePlaybackStore.getState().playState).toBe('playing');
    expect(usePlaybackStore.getState().positionMs).toBe(0);
  });

  it('hydrates an existing queue track without reordering the queue', () => {
    const playback = usePlaybackStore.getState();
    playback.seedQueue(FEATURED_QUEUE);

    playback.updateTrack({
      ...FEATURED_QUEUE[1].track,
      stream: '/b-hydrated.mp3',
      durationMs: 223000,
    });

    expect(usePlaybackStore.getState().queue[0]?.track.id).toBe('t1');
    expect(usePlaybackStore.getState().queue[1]?.track.stream).toBe(
      '/b-hydrated.mp3'
    );
  });

  it('stores seek requests while updating the visible playback position', () => {
    const playback = usePlaybackStore.getState();
    playback.seedQueue(FEATURED_QUEUE);

    playback.requestSeek(64000);

    expect(usePlaybackStore.getState().requestedSeekMs).toBe(64000);
    expect(usePlaybackStore.getState().positionMs).toBe(64000);
  });

  it('stores buffered progress in playback state', () => {
    const playback = usePlaybackStore.getState();

    playback.setBufferedMs(128000);

    expect(usePlaybackStore.getState().bufferedMs).toBe(128000);
  });

  it('updates play mode and volume preferences in playback state', () => {
    const playback = usePlaybackStore.getState();

    playback.togglePlayMode();
    playback.setVolume(0.35);
    playback.toggleMuted();

    expect(usePlaybackStore.getState().playMode).toBe('single-loop');
    expect(usePlaybackStore.getState().volume).toBe(0.35);
    expect(usePlaybackStore.getState().muted).toBe(true);
  });

  it('opens the full player without mutating the queue', () => {
    usePlayerSurfaceStore.getState().openFullPlayer();

    expect(usePlayerSurfaceStore.getState().fullPlayerOpen).toBe(true);
  });

  it('tracks the active lyric line index', () => {
    useLyricsStore.getState().setLyrics({
      trackId: 't1',
      source: 'netease',
      offsetMs: 0,
      lines: [{ timeMs: 0, text: 'line 1' }],
    });

    useLyricsStore.getState().setActiveLineIndex(0);
    expect(useLyricsStore.getState().activeLineIndex).toBe(0);
  });
});
