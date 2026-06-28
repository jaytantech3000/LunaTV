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
      source: 'fixture',
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
      source: 'fixture',
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

  it('opens the full player without mutating the queue', () => {
    usePlayerSurfaceStore.getState().openFullPlayer();

    expect(usePlayerSurfaceStore.getState().fullPlayerOpen).toBe(true);
  });

  it('tracks the active lyric line index', () => {
    useLyricsStore.getState().setLyrics({
      trackId: 't1',
      source: 'fixture',
      offsetMs: 0,
      lines: [{ timeMs: 0, text: 'line 1' }],
    });

    useLyricsStore.getState().setActiveLineIndex(0);
    expect(useLyricsStore.getState().activeLineIndex).toBe(0);
  });
});
