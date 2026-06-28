jest.mock('@/lib/desktop/tauri-client', () => ({
  deleteDesktopMusicDownload: jest.fn(),
  downloadDesktopMusicTrack: jest.fn(),
  isDesktopTauriRuntimeAvailable: jest.fn(() => true),
  listDesktopMusicDownloads: jest.fn(),
  resolveDesktopMusicDownloadPlayback: jest.fn(),
}));

jest.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: jest.fn((filePath: string) => `asset://${filePath}`),
}));

import {
  deleteDesktopMusicDownload,
  downloadDesktopMusicTrack,
  isDesktopTauriRuntimeAvailable,
  listDesktopMusicDownloads,
  resolveDesktopMusicDownloadPlayback,
} from '@/lib/desktop/tauri-client';

import {
  deleteMusicDownload,
  downloadMusicTrack,
  listMusicDownloads,
  resolveDownloadedMusicTrackPlaybackUrl,
} from '../services/music-downloads';

const mockedDeleteDesktopMusicDownload =
  deleteDesktopMusicDownload as jest.MockedFunction<
    typeof deleteDesktopMusicDownload
  >;
const mockedDownloadDesktopMusicTrack =
  downloadDesktopMusicTrack as jest.MockedFunction<
    typeof downloadDesktopMusicTrack
  >;
const mockedIsDesktopTauriRuntimeAvailable =
  isDesktopTauriRuntimeAvailable as jest.MockedFunction<
    typeof isDesktopTauriRuntimeAvailable
  >;
const mockedListDesktopMusicDownloads =
  listDesktopMusicDownloads as jest.MockedFunction<
    typeof listDesktopMusicDownloads
  >;
const mockedResolveDesktopMusicDownloadPlayback =
  resolveDesktopMusicDownloadPlayback as jest.MockedFunction<
    typeof resolveDesktopMusicDownloadPlayback
  >;

describe('music downloads desktop bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
    };
    mockedIsDesktopTauriRuntimeAvailable.mockReturnValue(true);
  });

  it('lists sanitized desktop download records', async () => {
    mockedListDesktopMusicDownloads.mockResolvedValue([
      {
        downloadId: 'netease+9001',
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '/api/music/stream?source=netease&id=9001',
          playable: true,
        },
        quality: 'high',
        status: 'downloaded',
        progressPercent: 100,
        downloadedBytes: 1024,
        totalBytes: 1024,
        localFilePath: '/tmp/music/9001.mp3',
        errorMessage: null,
        downloadedAt: 1000,
        updatedAt: 1000,
      },
    ]);

    await expect(listMusicDownloads()).resolves.toEqual([
      expect.objectContaining({
        track: expect.objectContaining({
          stream: '',
        }),
      }),
    ]);
  });

  it('rejects desktop downloads outside the desktop target', async () => {
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'web',
    };

    await expect(
      downloadMusicTrack({
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
        quality: 'high',
        downloadUrl: 'https://cdn.music.test/9001-high.mp3',
      })
    ).rejects.toThrow('Music downloads are only available in the desktop app.');
  });

  it('resolves a local playback path into a tauri asset url', async () => {
    mockedResolveDesktopMusicDownloadPlayback.mockResolvedValue({
      filePath: '/tmp/music/9001.mp3',
    });

    await expect(
      resolveDownloadedMusicTrackPlaybackUrl({
        source: 'netease',
        trackId: '9001',
      })
    ).resolves.toBe('asset:///tmp/music/9001.mp3');
  });

  it('passes desktop delete and download calls through to tauri', async () => {
    mockedDownloadDesktopMusicTrack.mockResolvedValue({
      downloadId: 'netease+9001',
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
      quality: 'high',
      status: 'downloaded',
      progressPercent: 100,
      downloadedBytes: 1024,
      totalBytes: 1024,
      localFilePath: '/tmp/music/9001.mp3',
      errorMessage: null,
      downloadedAt: 1000,
      updatedAt: 1000,
    });

    await downloadMusicTrack({
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
      quality: 'high',
      downloadUrl: 'https://cdn.music.test/9001-high.mp3',
    });
    await deleteMusicDownload('netease+9001');

    expect(mockedDownloadDesktopMusicTrack).toHaveBeenCalledWith({
      track: expect.objectContaining({
        id: '9001',
      }),
      quality: 'high',
      downloadUrl: 'https://cdn.music.test/9001-high.mp3',
    });
    expect(mockedDeleteDesktopMusicDownload).toHaveBeenCalledWith(
      'netease+9001'
    );
  });
});
