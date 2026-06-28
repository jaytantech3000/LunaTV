jest.mock('../services/music-downloads', () => ({
  deleteMusicDownload: jest.fn(),
  downloadMusicTrack: jest.fn(),
  isMusicDownloadBridgeAvailable: jest.fn(() => true),
  listMusicDownloads: jest.fn(),
  resolveDownloadedMusicTrackPlaybackUrl: jest.fn(),
}));

jest.mock('../services/music-api-client', () => ({
  fetchMusicTrackPlayback: jest.fn(),
}));

import { fetchMusicTrackPlayback } from '../services/music-api-client';
import {
  deleteMusicDownload,
  downloadMusicTrack,
  listMusicDownloads,
} from '../services/music-downloads';
import { useMusicDownloadStore } from '../state/music-download-store';

const mockedFetchMusicTrackPlayback =
  fetchMusicTrackPlayback as jest.MockedFunction<typeof fetchMusicTrackPlayback>;
const mockedDeleteMusicDownload =
  deleteMusicDownload as jest.MockedFunction<typeof deleteMusicDownload>;
const mockedDownloadMusicTrack =
  downloadMusicTrack as jest.MockedFunction<typeof downloadMusicTrack>;
const mockedListMusicDownloads =
  listMusicDownloads as jest.MockedFunction<typeof listMusicDownloads>;

describe('music download store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
    };
    useMusicDownloadStore.setState({
      hydrated: false,
      hydrating: false,
      error: null,
      records: {},
      batchDownloading: false,
    });
  });

  it('hydrates desktop download records into the store', async () => {
    mockedListMusicDownloads.mockResolvedValue([
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
      },
    ]);

    await useMusicDownloadStore.getState().hydrateDownloads();

    expect(useMusicDownloadStore.getState().hydrated).toBe(true);
    expect(useMusicDownloadStore.getState().records['netease+9001']).toEqual(
      expect.objectContaining({
        status: 'downloaded',
      })
    );
  });

  it('downloads a track by resolving the live stream first', async () => {
    mockedFetchMusicTrackPlayback.mockResolvedValue({
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
      streamUrl: 'https://cdn.music.test/9001-high.mp3',
      quality: 'high',
    });
    mockedDownloadMusicTrack.mockResolvedValue({
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

    await useMusicDownloadStore.getState().downloadTrack(
      {
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
      'high'
    );

    expect(mockedFetchMusicTrackPlayback).toHaveBeenCalledWith({
      source: 'netease',
      id: '9001',
      quality: 'high',
    });
    expect(mockedDownloadMusicTrack).toHaveBeenCalledWith({
      track: expect.objectContaining({
        id: '9001',
      }),
      quality: 'high',
      downloadUrl: 'https://cdn.music.test/9001-high.mp3',
    });
    expect(useMusicDownloadStore.getState().records['netease+9001']).toEqual(
      expect.objectContaining({
        status: 'downloaded',
      })
    );
  });

  it('removes a downloaded track from the store after desktop deletion', async () => {
    useMusicDownloadStore.setState({
      hydrated: true,
      hydrating: false,
      error: null,
      batchDownloading: false,
      records: {
        'netease+9001': {
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
        },
      },
    });

    await useMusicDownloadStore.getState().removeTrackDownload({
      source: 'netease',
      id: '9001',
    });

    expect(mockedDeleteMusicDownload).toHaveBeenCalledWith('netease+9001');
    expect(useMusicDownloadStore.getState().records['netease+9001']).toBeUndefined();
  });

  it('keeps the download record and exposes the error when desktop deletion fails', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockedDeleteMusicDownload.mockRejectedValue(
      new Error('failed to remove /tmp/music/9001.mp3')
    );

    try {
      useMusicDownloadStore.setState({
        hydrated: true,
        hydrating: false,
        error: null,
        batchDownloading: false,
        records: {
          'netease+9001': {
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
          },
        },
      });

      await expect(
        useMusicDownloadStore.getState().removeTrackDownload({
          source: 'netease',
          id: '9001',
        })
      ).rejects.toThrow('failed to remove /tmp/music/9001.mp3');

      expect(useMusicDownloadStore.getState().records['netease+9001']).toEqual(
        expect.objectContaining({
          status: 'downloaded',
        })
      );
      expect(useMusicDownloadStore.getState().error).toBe(
        'failed to remove /tmp/music/9001.mp3'
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '删除下载音乐失败',
        expect.any(Error)
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
