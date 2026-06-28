import type { MusicTrackEntity } from '../domain/entities';
import {
  buildMusicDownloadId,
  sanitizeMusicDownloadRecord,
  sanitizeMusicDownloadRecords,
} from '../services/music-download-records';

const BASE_TRACK: MusicTrackEntity = {
  id: '9001',
  source: 'netease',
  title: 'Playable Track',
  artists: ['Artist A'],
  album: 'Album A',
  coverUrl: 'https://cdn.music.test/album-a.jpg',
  durationMs: 215000,
  stream: '/api/music/stream?source=netease&id=9001&quality=high',
  playable: true,
};

describe('music download records', () => {
  it('builds a stable download id from source and track id', () => {
    expect(buildMusicDownloadId('netease', '9001')).toBe('netease+9001');
  });

  it('sanitizes persisted records and strips stream urls', () => {
    expect(
      sanitizeMusicDownloadRecord({
        downloadId: 'netease+9001',
        track: BASE_TRACK,
        quality: 'high',
        status: 'downloaded',
        progressPercent: 100,
        downloadedBytes: 1024,
        totalBytes: 1024,
        localFilePath: '/tmp/music/9001.mp3',
        errorMessage: null,
        downloadedAt: 1000,
        updatedAt: 1000,
      })
    ).toEqual({
      downloadId: 'netease+9001',
      track: {
        ...BASE_TRACK,
        stream: '',
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
  });

  it('downgrades downloaded records without a file path into failed state', () => {
    expect(
      sanitizeMusicDownloadRecord({
        downloadId: 'netease+9001',
        track: BASE_TRACK,
        quality: 'high',
        status: 'downloaded',
        progressPercent: 100,
        downloadedBytes: 1024,
        totalBytes: 1024,
        localFilePath: '',
        errorMessage: null,
        downloadedAt: 1000,
        updatedAt: 1000,
      })
    ).toEqual({
      downloadId: 'netease+9001',
      track: {
        ...BASE_TRACK,
        stream: '',
      },
      quality: 'high',
      status: 'failed',
      progressPercent: 0,
      downloadedBytes: 1024,
      totalBytes: 1024,
      localFilePath: null,
      errorMessage: 'Downloaded file is unavailable.',
      downloadedAt: null,
      updatedAt: 1000,
    });
  });

  it('drops invalid records and sorts the rest by updatedAt descending', () => {
    expect(
      sanitizeMusicDownloadRecords([
        {
          downloadId: 'netease+9002',
          track: {
            ...BASE_TRACK,
            id: '9002',
            title: 'Second Track',
          },
          quality: 'standard',
          status: 'downloaded',
          progressPercent: 100,
          downloadedBytes: 2048,
          totalBytes: 2048,
          localFilePath: '/tmp/music/9002.mp3',
          errorMessage: null,
          downloadedAt: 2000,
          updatedAt: 2000,
        },
        {
          downloadId: '',
          track: BASE_TRACK,
        },
        {
          downloadId: 'netease+9001',
          track: BASE_TRACK,
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
      ])
    ).toEqual([
      expect.objectContaining({
        downloadId: 'netease+9002',
      }),
      expect.objectContaining({
        downloadId: 'netease+9001',
      }),
    ]);
  });
});
