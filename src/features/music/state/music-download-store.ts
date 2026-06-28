'use client';

/* eslint-disable no-console */

import { create } from 'zustand';

import type {
  MusicDownloadRecord,
  MusicPlaybackQuality,
  MusicTrackEntity,
} from '../domain/entities';
import { fetchMusicTrackPlayback } from '../services/music-api-client';
import {
  buildMusicDownloadId,
  createMusicDownloadRecord,
} from '../services/music-download-records';
import {
  deleteMusicDownload,
  downloadMusicTrack,
  isMusicDownloadBridgeAvailable,
  listMusicDownloads,
} from '../services/music-downloads';

interface MusicDownloadState {
  hydrated: boolean;
  hydrating: boolean;
  batchDownloading: boolean;
  error: string | null;
  records: Record<string, MusicDownloadRecord>;
  hydrateDownloads: () => Promise<void>;
  downloadTrack: (
    track: MusicTrackEntity,
    quality: MusicPlaybackQuality
  ) => Promise<MusicDownloadRecord>;
  downloadCollectionTracks: (
    tracks: MusicTrackEntity[],
    quality: MusicPlaybackQuality
  ) => Promise<void>;
  removeTrackDownload: (
    track: Pick<MusicTrackEntity, 'source' | 'id'>
  ) => Promise<void>;
  isTrackDownloaded: (
    track: Pick<MusicTrackEntity, 'source' | 'id'>
  ) => boolean;
}

function toRecordMap(
  records: MusicDownloadRecord[]
): Record<string, MusicDownloadRecord> {
  return Object.fromEntries(
    records.map((record) => [record.downloadId, record] as const)
  );
}

function resolveStoreErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message || fallback;
  }

  return fallback;
}

export const useMusicDownloadStore = create<MusicDownloadState>((set, get) => ({
  hydrated: false,
  hydrating: false,
  batchDownloading: false,
  error: null,
  records: {},
  hydrateDownloads: async () => {
    if (!isMusicDownloadBridgeAvailable()) {
      set({
        hydrated: true,
        hydrating: false,
        error: null,
        records: {},
      });
      return;
    }

    set({
      hydrating: true,
      error: null,
    });

    try {
      const records = await listMusicDownloads();
      set({
        hydrated: true,
        hydrating: false,
        error: null,
        records: toRecordMap(records),
      });
    } catch (error) {
      console.error('加载音乐下载记录失败', error);
      set({
        hydrated: true,
        hydrating: false,
        error: resolveStoreErrorMessage(error, '加载音乐下载记录失败'),
      });
    }
  },
  downloadTrack: async (track, quality) => {
    const downloadId = buildMusicDownloadId(track.source, track.id);
    const existingRecord = get().records[downloadId];

    if (existingRecord?.status === 'downloaded') {
      return existingRecord;
    }

    const downloadingRecord = createMusicDownloadRecord({
      track,
      quality,
      status: 'downloading',
      updatedAt: Date.now(),
    });

    set((state) => ({
      error: null,
      records: {
        ...state.records,
        [downloadId]: downloadingRecord,
      },
    }));

    try {
      const playback = await fetchMusicTrackPlayback({
        source: track.source,
        id: track.id,
        quality,
      });
      const record = await downloadMusicTrack({
        track: playback.track,
        quality,
        downloadUrl: playback.streamUrl,
      });

      set((state) => ({
        error: null,
        records: {
          ...state.records,
          [record.downloadId]: record,
        },
      }));

      return record;
    } catch (error) {
      const failedRecord = createMusicDownloadRecord({
        track,
        quality,
        status: 'failed',
        errorMessage: resolveStoreErrorMessage(error, '下载音乐失败'),
        updatedAt: Date.now(),
      });

      console.error('下载音乐失败', error);
      set((state) => ({
        error: failedRecord.errorMessage,
        records: {
          ...state.records,
          [failedRecord.downloadId]: failedRecord,
        },
      }));
      throw error;
    }
  },
  downloadCollectionTracks: async (tracks, quality) => {
    set({
      batchDownloading: true,
      error: null,
    });

    try {
      for (const track of tracks) {
        if (!track.playable) {
          continue;
        }

        try {
          await get().downloadTrack(track, quality);
        } catch {
          // Keep batch download moving and surface the latest per-track state.
        }
      }
    } finally {
      set({
        batchDownloading: false,
      });
    }
  },
  removeTrackDownload: async (track) => {
    const downloadId = buildMusicDownloadId(track.source, track.id);
    try {
      await deleteMusicDownload(downloadId);

      set((state) => {
        const nextRecords = { ...state.records };
        delete nextRecords[downloadId];

        return {
          error: null,
          records: nextRecords,
        };
      });
    } catch (error) {
      const errorMessage = resolveStoreErrorMessage(error, '删除下载音乐失败');

      console.error('删除下载音乐失败', error);
      set({
        error: errorMessage,
      });
      throw error;
    }
  },
  isTrackDownloaded: (track) => {
    const downloadId = buildMusicDownloadId(track.source, track.id);
    return get().records[downloadId]?.status === 'downloaded';
  },
}));
