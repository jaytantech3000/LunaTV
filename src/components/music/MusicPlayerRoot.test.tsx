'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useMusicPlayerStore } from '@/stores/musicPlayerStore';

import MusicPlayerRoot from './MusicPlayerRoot';

const mockFetchMusicTrack = jest.fn();
const mockFetchMusicLyric = jest.fn();
const mockSaveMusicRecentTrack = jest.fn();
const mockSaveMusicPlayRecord = jest.fn();
const mockIsMusicFavorited = jest.fn();
const mockSaveMusicFavorite = jest.fn();
const mockDeleteMusicFavorite = jest.fn();
const mockPush = jest.fn();
let mockPathname = '/music';

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: jest.fn(() => ({
    ENABLE_WEB_MUSIC: true,
  })),
}));

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => mockPathname),
  useRouter: jest.fn(() => ({
    push: mockPush,
  })),
}));

jest.mock('@/lib/transport/music-client', () => ({
  buildMusicStreamUrl: jest.fn(
    ({ source, id }: { source: string; id: string }) =>
      `https://example.com/${source}/${id}.mp3`
  ),
  fetchMusicTrack: (...args: Parameters<typeof mockFetchMusicTrack>) =>
    mockFetchMusicTrack(...args),
  fetchMusicLyric: (...args: Parameters<typeof mockFetchMusicLyric>) =>
    mockFetchMusicLyric(...args),
}));

jest.mock('@/lib/music/media-session', () => ({
  bindMusicMediaSessionAction: jest.fn(),
  setMusicMediaSessionMetadata: jest.fn(),
  setMusicMediaSessionPlaybackState: jest.fn(),
  setMusicMediaSessionPositionState: jest.fn(),
}));

jest.mock('@/lib/music/profile', () => ({
  saveMusicRecentTrack: (
    ...args: Parameters<typeof mockSaveMusicRecentTrack>
  ) => mockSaveMusicRecentTrack(...args),
  saveMusicPlayRecord: (...args: Parameters<typeof mockSaveMusicPlayRecord>) =>
    mockSaveMusicPlayRecord(...args),
  isMusicFavorited: (...args: Parameters<typeof mockIsMusicFavorited>) =>
    mockIsMusicFavorited(...args),
  saveMusicFavorite: (...args: Parameters<typeof mockSaveMusicFavorite>) =>
    mockSaveMusicFavorite(...args),
  deleteMusicFavorite: (...args: Parameters<typeof mockDeleteMusicFavorite>) =>
    mockDeleteMusicFavorite(...args),
}));

jest.mock(
  './MusicMiniPlayer',
  () =>
    (props: {
      onDismiss?: () => void;
      onExpand: () => void;
      onStop?: () => void;
    }) =>
      (
        <div>
          <button type='button' onClick={props.onExpand}>
            mini-expand
          </button>
          <button type='button' onClick={props.onStop}>
            mini-stop
          </button>
          <button type='button' onClick={props.onDismiss}>
            mini-dismiss
          </button>
        </div>
      )
);
jest.mock(
  './MusicFullscreenPlayer',
  () =>
    (props: {
      open: boolean;
      onDismiss?: () => void;
      onMinimize?: () => void;
      onStop?: () => void;
      onToggleFavorite?: () => void;
    }) =>
      props.open ? (
        <div data-testid='expanded-player'>
          <button type='button' onClick={props.onToggleFavorite}>
            toggle-favorite
          </button>
          <button type='button' onClick={props.onMinimize}>
            minimize-player
          </button>
          <button type='button' onClick={props.onStop}>
            stop-player
          </button>
          <button type='button' onClick={props.onDismiss}>
            dismiss-player
          </button>
        </div>
      ) : null
);

function primeMusicPlayerStore(options?: {
  currentTimeSec?: number;
  durationSec?: number;
  presentation?: 'hidden' | 'mini' | 'expanded';
}) {
  useMusicPlayerStore.setState({
    hasHydrated: true,
    queue: [
      {
        trackId: 'netease-track-1',
        source: 'netease',
        title: '霓虹夜航',
        artistsText: 'Luna Drive',
        cover: 'https://example.com/cover.jpg',
        durationMs: 188000,
        albumTitle: 'Midnight Circuits',
        subtitle: '夜色电子',
      },
    ],
    currentIndex: 0,
    playMode: 'list-loop',
    volume: 0.85,
    muted: false,
    currentTimeSec: options?.currentTimeSec ?? 0,
    recentTracks: [],
    isPlaying: true,
    presentation: options?.presentation ?? 'mini',
    durationSec: options?.durationSec ?? 0,
    streamUrl: null,
    lyrics: null,
    isTrackLoading: false,
    trackError: null,
  });
}

function mountExpandedSlot() {
  const slot = document.createElement('div');
  slot.id = 'music-player-expanded-slot';
  document.body.appendChild(slot);
  return slot;
}

describe('MusicPlayerRoot', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: jest.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: jest.fn(),
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'load', {
      configurable: true,
      value: jest.fn(),
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockPathname = '/music';
    document.body.innerHTML = '';
    primeMusicPlayerStore();
    mockFetchMusicTrack.mockResolvedValue({
      track: {
        id: 'netease-track-1',
        source: 'netease',
        title: '霓虹夜航',
        artists: [{ name: 'Luna Drive' }],
        durationMs: 188000,
        playable: true,
      },
      streamUrl: 'https://example.com/netease-track-1.mp3',
      quality: 'standard',
    });
    mockFetchMusicLyric.mockResolvedValue({
      trackId: 'netease-track-1',
      source: 'netease',
      lines: [],
    });
    mockSaveMusicRecentTrack.mockResolvedValue(undefined);
    mockSaveMusicPlayRecord.mockResolvedValue(undefined);
    mockIsMusicFavorited.mockResolvedValue(false);
    mockSaveMusicFavorite.mockResolvedValue(undefined);
    mockDeleteMusicFavorite.mockResolvedValue(undefined);
  });

  it('writes the resolved current track into music recent tracks', async () => {
    render(<MusicPlayerRoot />);

    await waitFor(() => {
      expect(mockSaveMusicRecentTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          trackId: 'netease-track-1',
          source: 'netease',
          title: '霓虹夜航',
        })
      );
    });
  });

  it('persists a music playback snapshot when playback pauses', async () => {
    primeMusicPlayerStore({
      currentTimeSec: 42,
      durationSec: 188,
    });

    const { container } = render(<MusicPlayerRoot />);

    await waitFor(() => {
      expect(mockFetchMusicTrack).toHaveBeenCalled();
    });

    const audio = container.querySelector('audio');
    if (!audio) {
      throw new Error('audio element not rendered');
    }

    Object.defineProperty(audio, 'ended', {
      configurable: true,
      value: false,
    });

    fireEvent.pause(audio);

    await waitFor(() => {
      expect(mockSaveMusicPlayRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          trackId: 'netease-track-1',
        }),
        expect.objectContaining({
          playTimeSec: 42,
          durationSec: 188,
          completed: false,
        })
      );
    });
  });

  it('favorites the current track from the fullscreen player action', async () => {
    primeMusicPlayerStore({
      presentation: 'expanded',
    });
    mountExpandedSlot();

    render(<MusicPlayerRoot />);

    await waitFor(() => {
      expect(mockIsMusicFavorited).toHaveBeenCalledWith(
        'netease',
        'netease-track-1'
      );
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'toggle-favorite' })
    );

    await waitFor(() => {
      expect(mockSaveMusicFavorite).toHaveBeenCalledWith(
        expect.objectContaining({
          trackId: 'netease-track-1',
          source: 'netease',
        })
      );
    });
  });

  it('routes expand requests outside the music page back into /music', async () => {
    mockPathname = '/search';

    render(<MusicPlayerRoot />);

    fireEvent.click(await screen.findByRole('button', { name: 'mini-expand' }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/music');
    });
  });

  it('downgrades the expanded player to mini when leaving the music page', async () => {
    primeMusicPlayerStore({
      presentation: 'expanded',
    });
    mountExpandedSlot();

    const { rerender } = render(<MusicPlayerRoot />);

    expect(await screen.findByTestId('expanded-player')).toBeInTheDocument();

    mockPathname = '/search';
    rerender(<MusicPlayerRoot />);

    await waitFor(() => {
      expect(useMusicPlayerStore.getState().presentation).toBe('mini');
    });
  });

  it('dismisses playback from the mini player controls', async () => {
    render(<MusicPlayerRoot />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'mini-dismiss' })
    );

    await waitFor(() => {
      expect(useMusicPlayerStore.getState().presentation).toBe('hidden');
      expect(useMusicPlayerStore.getState().isPlaying).toBe(false);
    });
  });
});
