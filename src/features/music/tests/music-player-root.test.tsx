import { act, render, waitFor } from '@testing-library/react';

import {
  createLiveMusicFetchMock,
  mockMediaElementPlayback,
  resetLiveMusicStores,
} from './live-music-test-utils';
import MusicPlayerRoot from '../components/MusicPlayerRoot';
import {
  getAllMusicPlayRecords,
  getMusicRecentTracks,
} from '../services/music-profile';
import { useLyricsStore } from '../state/lyrics-store';
import { usePlaybackStore } from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

const mockDesktopTraySync = jest.fn();
let desktopTrayHandlers: {
  onOpenMusic: () => void;
  onTogglePlay: () => void;
  onPlayNext: () => void;
  onPlayPrevious: () => void;
} | null = null;

jest.mock('../services/desktop-music-tray', () => ({
  bindDesktopMusicTrayControls: (handlers: {
    onOpenMusic: () => void;
    onTogglePlay: () => void;
    onPlayNext: () => void;
    onPlayPrevious: () => void;
  }) => {
    desktopTrayHandlers = handlers;

    return () => {
      desktopTrayHandlers = null;
    };
  },
  syncDesktopMusicTrayState: (...args: unknown[]) =>
    mockDesktopTraySync(...args),
}));

class TestMediaMetadata {
  title: string;
  artist: string;
  album: string;

  constructor(init: { title: string; artist: string; album: string }) {
    this.title = init.title;
    this.artist = init.artist;
    this.album = init.album;
  }
}

describe('MusicPlayerRoot', () => {
  const originalFetch = global.fetch;
  let mediaPlaybackMocks: ReturnType<typeof mockMediaElementPlayback>;

  beforeEach(() => {
    resetLiveMusicStores();
    global.fetch = createLiveMusicFetchMock();
    mediaPlaybackMocks = mockMediaElementPlayback();
    mockDesktopTraySync.mockReset();
    mockDesktopTraySync.mockResolvedValue(undefined);
    desktopTrayHandlers = null;
    window.history.replaceState({}, '', '/');
    Object.defineProperty(globalThis, 'MediaMetadata', {
      value: TestMediaMetadata,
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'mediaSession', {
      value: { metadata: null },
      configurable: true,
    });
  });

  afterEach(() => {
    mediaPlaybackMocks.pauseSpy.mockRestore();
    mediaPlaybackMocks.playSpy.mockRestore();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('mounts the rebuilt player root without importing legacy music modules', () => {
    const { container } = render(<MusicPlayerRoot />);

    expect(container.querySelector('audio')).toBeInTheDocument();
  });

  it('loads and starts the current live stream when playback is active', () => {
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'q1',
        addedAt: 1,
        fromContext: 'featured',
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '/api/music/stream?source=netease&id=9001&quality=standard',
          playable: true,
        },
      },
    ]);

    const { container } = render(<MusicPlayerRoot />);
    const audio = container.querySelector('audio');

    expect(audio?.getAttribute('src')).toContain('/api/music/stream');
    expect(mediaPlaybackMocks.playSpy).toHaveBeenCalled();
  });

  it('hydrates queued tracks and lyrics before continuing playback', async () => {
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'q1',
        addedAt: 1,
        fromContext: 'featured',
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '/api/music/stream?source=netease&id=9001&quality=standard',
          playable: true,
        },
      },
      {
        queueId: 'q2',
        addedAt: 2,
        fromContext: 'featured',
        track: {
          id: '9002',
          source: 'netease',
          title: 'Second Collection Track',
          artists: ['Artist B'],
          album: 'Album B',
          coverUrl: 'https://cdn.music.test/album-b.jpg',
          durationMs: 223000,
          stream: '',
          playable: true,
        },
      },
    ]);
    useLyricsStore.setState({
      lyrics: {
        trackId: '9001',
        source: 'netease',
        offsetMs: 0,
        lines: [{ timeMs: 0, text: '第一句' }],
      },
      activeLineIndex: 0,
      followMode: 'auto',
      manualSeekLock: false,
    });
    const { container } = render(<MusicPlayerRoot />);
    const audio = container.querySelector('audio');

    act(() => {
      usePlaybackStore.getState().playNext();
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().queue[1]?.track.stream).toContain(
        'id=9002'
      );
    });
    expect(useLyricsStore.getState().lyrics?.trackId).toBe('9002');
    expect(audio?.getAttribute('src')).toContain('id=9002');
    expect(mediaPlaybackMocks.playSpy).toHaveBeenCalledTimes(2);
  });

  it('refreshes the personal fm queue when the last fm track ends', async () => {
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'fm-1',
        addedAt: 1,
        fromContext: 'fm',
        track: {
          id: '9501',
          source: 'netease',
          title: 'FM Session Track',
          artists: ['FM Artist'],
          album: 'FM Album',
          coverUrl: 'https://cdn.music.test/fm-track.jpg',
          durationMs: 214000,
          stream: '/api/music/stream?source=netease&id=9501&quality=standard',
          playable: true,
        },
      },
    ]);

    const { container } = render(<MusicPlayerRoot />);
    const audio = container.querySelector('audio');

    act(() => {
      if (audio) {
        audio.currentTime = 214;
        audio.dispatchEvent(new Event('ended'));
      }
    });

    await waitFor(() => {
      expect(usePlaybackStore.getState().currentTrackId).toBe('9601');
    });
    expect(audio?.getAttribute('src')).toContain('id=9601');
    expect(mediaPlaybackMocks.playSpy).toHaveBeenCalledTimes(2);
  });

  it('tracks the active lyric line from audio time updates', () => {
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'q1',
        addedAt: 1,
        fromContext: 'featured',
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '/api/music/stream?source=netease&id=9001&quality=standard',
          playable: true,
        },
      },
    ]);
    useLyricsStore.setState({
      lyrics: {
        trackId: '9001',
        source: 'netease',
        offsetMs: 0,
        lines: [
          { timeMs: 1000, text: '第一句' },
          { timeMs: 2500, text: '第二句' },
        ],
      },
      activeLineIndex: 0,
      followMode: 'auto',
      manualSeekLock: false,
    });

    const { container } = render(<MusicPlayerRoot />);
    const audio = container.querySelector('audio');

    act(() => {
      if (audio) {
        audio.currentTime = 3;
        audio.dispatchEvent(new Event('timeupdate'));
      }
    });

    expect(usePlaybackStore.getState().positionMs).toBe(3000);
    expect(useLyricsStore.getState().activeLineIndex).toBe(1);
  });

  it('seeks the active audio element when playback requests a new position', () => {
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'q1',
        addedAt: 1,
        fromContext: 'featured',
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '/api/music/stream?source=netease&id=9001&quality=standard',
          playable: true,
        },
      },
    ]);

    const { container } = render(<MusicPlayerRoot />);
    const audio = container.querySelector('audio');

    act(() => {
      usePlaybackStore.getState().requestSeek(64000);
    });

    expect(audio?.currentTime).toBe(64);
    expect(usePlaybackStore.getState().positionMs).toBe(64000);
  });

  it('syncs audio output preferences from playback state', async () => {
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'q1',
        addedAt: 1,
        fromContext: 'featured',
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '/api/music/stream?source=netease&id=9001&quality=standard',
          playable: true,
        },
      },
    ]);

    const { container } = render(<MusicPlayerRoot />);
    const audio = container.querySelector('audio');

    act(() => {
      usePlaybackStore.getState().setVolume(0.35);
      usePlaybackStore.getState().setMuted(true);
    });

    await waitFor(() => {
      expect(audio?.volume).toBeCloseTo(0.35, 5);
      expect(audio?.muted).toBe(true);
    });
  });

  it('tracks buffered progress from the active audio element', () => {
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'q1',
        addedAt: 1,
        fromContext: 'featured',
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '/api/music/stream?source=netease&id=9001&quality=standard',
          playable: true,
        },
      },
    ]);

    const { container } = render(<MusicPlayerRoot />);
    const audio = container.querySelector('audio');

    Object.defineProperty(audio, 'buffered', {
      configurable: true,
      value: {
        length: 1,
        start: () => 0,
        end: () => 120,
      } as TimeRanges,
    });

    act(() => {
      audio?.dispatchEvent(new Event('progress'));
    });

    expect(usePlaybackStore.getState().bufferedMs).toBe(120000);
  });

  it('restarts the current track when single-loop mode is active', () => {
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'q1',
        addedAt: 1,
        fromContext: 'featured',
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '/api/music/stream?source=netease&id=9001&quality=standard',
          playable: true,
        },
      },
      {
        queueId: 'q2',
        addedAt: 2,
        fromContext: 'featured',
        track: {
          id: '9002',
          source: 'netease',
          title: 'Second Collection Track',
          artists: ['Artist B'],
          album: 'Album B',
          coverUrl: 'https://cdn.music.test/album-b.jpg',
          durationMs: 223000,
          stream: '/api/music/stream?source=netease&id=9002&quality=standard',
          playable: true,
        },
      },
    ]);

    const { container } = render(<MusicPlayerRoot />);
    const audio = container.querySelector('audio');

    act(() => {
      usePlaybackStore.getState().togglePlayMode();

      if (audio) {
        audio.currentTime = 215;
        audio.dispatchEvent(new Event('ended'));
      }
    });

    expect(usePlaybackStore.getState().currentTrackId).toBe('9001');
    expect(audio?.currentTime).toBe(0);
    expect(mediaPlaybackMocks.playSpy).toHaveBeenCalledTimes(2);
  });

  it('writes the active track into the local recent library', async () => {
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'q1',
        addedAt: 1,
        fromContext: 'featured',
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '/api/music/stream?source=netease&id=9001&quality=standard',
          playable: true,
        },
      },
    ]);

    render(<MusicPlayerRoot />);

    await waitFor(async () => {
      const recentTracks = await getMusicRecentTracks();

      expect(recentTracks[0]?.track.id).toBe('9001');
    });
  });

  it('persists a local resume snapshot when playback pauses', async () => {
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'q1',
        addedAt: 1,
        fromContext: 'featured',
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '/api/music/stream?source=netease&id=9001&quality=standard',
          playable: true,
        },
      },
    ]);

    const { container } = render(<MusicPlayerRoot />);
    const audio = container.querySelector('audio');

    act(() => {
      if (audio) {
        Object.defineProperty(audio, 'duration', {
          configurable: true,
          value: 215,
        });
        audio.currentTime = 42;
        audio.dispatchEvent(new Event('pause'));
      }
    });

    await waitFor(async () => {
      const playRecords = await getAllMusicPlayRecords();

      expect(playRecords['netease+9001']).toEqual(
        expect.objectContaining({
          track: expect.objectContaining({
            id: '9001',
          }),
          playTimeMs: 42000,
          durationMs: 215000,
          completed: false,
        })
      );
    });
  });

  it('restores a persisted playback session on first mount without auto-playing', async () => {
    localStorage.setItem(
      'moontv_music_playback_session',
      JSON.stringify({
        queue: [
          {
            queueId: 'q1',
            addedAt: 1,
            fromContext: 'featured',
            track: {
              id: '9001',
              source: 'netease',
              title: 'Playable Track',
              artists: ['Artist A'],
              album: 'Album A',
              coverUrl: 'https://cdn.music.test/album-a.jpg',
              durationMs: 215000,
              stream: '',
              playable: true,
            },
          },
        ],
        currentTrackId: '9001',
        positionMs: 42000,
        durationMs: 215000,
        savedAt: 123,
      })
    );

    const { container } = render(<MusicPlayerRoot />);
    const audio = container.querySelector('audio');

    await waitFor(() => {
      expect(usePlaybackStore.getState().currentTrackId).toBe('9001');
    });

    await waitFor(() => {
      expect(audio?.currentTime).toBe(42);
    });

    expect(usePlaybackStore.getState().playState).toBe('paused');
    expect(usePlaybackStore.getState().positionMs).toBe(42000);
    expect(usePlayerSurfaceStore.getState().miniVisible).toBe(true);
    expect(mediaPlaybackMocks.playSpy).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing queue with late playback-session restore', async () => {
    localStorage.setItem(
      'moontv_music_playback_session',
      JSON.stringify({
        queue: [
          {
            queueId: 'q1',
            addedAt: 1,
            fromContext: 'featured',
            track: {
              id: '9001',
              source: 'netease',
              title: 'Playable Track',
              artists: ['Artist A'],
              album: 'Album A',
              coverUrl: 'https://cdn.music.test/album-a.jpg',
              durationMs: 215000,
              stream: '',
              playable: true,
            },
          },
        ],
        currentTrackId: '9001',
        positionMs: 42000,
        durationMs: 215000,
        savedAt: 123,
      })
    );
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'q-local',
        addedAt: 1,
        fromContext: 'featured',
        track: {
          id: '9101',
          source: 'netease',
          title: 'Local Queue Track',
          artists: ['Artist B'],
          album: 'Album B',
          coverUrl: 'https://cdn.music.test/album-b.jpg',
          durationMs: 223000,
          stream: '/api/music/stream?source=netease&id=9101&quality=standard',
          playable: true,
        },
      },
    ]);

    render(<MusicPlayerRoot />);

    await waitFor(() => {
      expect(usePlaybackStore.getState().currentTrackId).toBe('9101');
    });

    expect(usePlaybackStore.getState().queue[0]?.track.id).toBe('9101');
  });

  it('flushes the latest playback session on pagehide', async () => {
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'q1',
        addedAt: 1,
        fromContext: 'featured',
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '/api/music/stream?source=netease&id=9001&quality=standard',
          playable: true,
        },
      },
    ]);

    const { container } = render(<MusicPlayerRoot />);
    const audio = container.querySelector('audio');

    act(() => {
      if (audio) {
        audio.currentTime = 24;
      }

      window.dispatchEvent(new Event('pagehide'));
    });

    await waitFor(() => {
      const rawSession = localStorage.getItem('moontv_music_playback_session');
      expect(rawSession).toContain('9001');
    });

    expect(localStorage.getItem('moontv_music_playback_session')).toContain(
      '"positionMs":24000'
    );
  });

  it('binds desktop shortcuts and media session metadata to active playback', () => {
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'q1',
        addedAt: 1,
        fromContext: 'featured',
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '/api/music/stream?source=netease&id=9001&quality=standard',
          playable: true,
        },
      },
      {
        queueId: 'q2',
        addedAt: 2,
        fromContext: 'featured',
        track: {
          id: '9002',
          source: 'netease',
          title: 'Second Collection Track',
          artists: ['Artist B'],
          album: 'Album B',
          coverUrl: 'https://cdn.music.test/album-b.jpg',
          durationMs: 223000,
          stream: '/api/music/stream?source=netease&id=9002&quality=standard',
          playable: true,
        },
      },
    ]);

    render(<MusicPlayerRoot />);

    expect(window.navigator.mediaSession.metadata).toMatchObject({
      title: 'Playable Track',
      artist: 'Artist A',
      album: 'Album A',
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    });
    expect(usePlaybackStore.getState().playState).toBe('paused');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    });
    expect(usePlaybackStore.getState().playState).toBe('playing');

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'ArrowRight' })
      );
    });

    expect(usePlaybackStore.getState().currentTrackId).toBe('9002');
    expect(window.navigator.mediaSession.metadata).toMatchObject({
      title: 'Second Collection Track',
      artist: 'Artist B',
      album: 'Album B',
    });
  });

  it('syncs desktop tray state and handles tray playback commands', () => {
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'q1',
        addedAt: 1,
        fromContext: 'featured',
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '/api/music/stream?source=netease&id=9001&quality=standard',
          playable: true,
        },
      },
      {
        queueId: 'q2',
        addedAt: 2,
        fromContext: 'featured',
        track: {
          id: '9002',
          source: 'netease',
          title: 'Second Collection Track',
          artists: ['Artist B'],
          album: 'Album B',
          coverUrl: 'https://cdn.music.test/album-b.jpg',
          durationMs: 223000,
          stream: '/api/music/stream?source=netease&id=9002&quality=standard',
          playable: true,
        },
      },
    ]);

    render(<MusicPlayerRoot />);

    expect(mockDesktopTraySync).toHaveBeenCalledWith({
      currentTrack: {
        title: 'Playable Track',
        artists: ['Artist A'],
        source: 'netease',
      },
      playState: 'playing',
      queueLength: 2,
    });
    expect(desktopTrayHandlers).not.toBeNull();

    act(() => {
      desktopTrayHandlers?.onTogglePlay();
    });
    expect(usePlaybackStore.getState().playState).toBe('paused');

    act(() => {
      desktopTrayHandlers?.onTogglePlay();
    });
    expect(usePlaybackStore.getState().playState).toBe('playing');

    act(() => {
      desktopTrayHandlers?.onPlayNext();
    });
    expect(usePlaybackStore.getState().currentTrackId).toBe('9002');

    act(() => {
      desktopTrayHandlers?.onPlayPrevious();
    });
    expect(usePlaybackStore.getState().currentTrackId).toBe('9001');

    act(() => {
      desktopTrayHandlers?.onOpenMusic();
    });
    expect(window.location.pathname).toBe('/music');
  });
});
