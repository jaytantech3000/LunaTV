import { getRuntimeConfig } from '@/lib/runtime-config';
import {
  deleteDesktopMusicDownload,
  downloadDesktopMusicTrack,
  isDesktopTauriRuntimeAvailable,
  listDesktopMusicDownloads,
  resolveDesktopMusicDownloadPlayback,
} from '@/lib/desktop/tauri-client';

import type {
  MusicDownloadRecord,
  MusicPlaybackQuality,
  MusicTrackEntity,
} from '../domain/entities';
import {
  createMusicDownloadRecord,
  sanitizeMusicDownloadRecords,
} from './music-download-records';
import { buildPersistedTrackSnapshot } from './music-profile-records';

function assertDesktopDownloadTarget(): void {
  if (getRuntimeConfig().APP_TARGET !== 'desktop') {
    throw new Error('Music downloads are only available in the desktop app.');
  }
}

export function isMusicDownloadFeatureEnabled(): boolean {
  return getRuntimeConfig().APP_TARGET === 'desktop';
}

export function isMusicDownloadBridgeAvailable(): boolean {
  return isMusicDownloadFeatureEnabled() && isDesktopTauriRuntimeAvailable();
}

export async function listMusicDownloads(): Promise<MusicDownloadRecord[]> {
  if (!isMusicDownloadBridgeAvailable()) {
    return [];
  }

  return sanitizeMusicDownloadRecords(await listDesktopMusicDownloads());
}

export async function downloadMusicTrack(params: {
  track: MusicTrackEntity;
  quality: MusicPlaybackQuality;
  downloadUrl: string;
}): Promise<MusicDownloadRecord> {
  assertDesktopDownloadTarget();

  const payload = {
    track: buildPersistedTrackSnapshot(params.track),
    quality: params.quality,
    downloadUrl: params.downloadUrl,
  };

  if (!isDesktopTauriRuntimeAvailable()) {
    throw new Error(
      'Desktop music download bridge is unavailable outside the Tauri shell.'
    );
  }

  const result = await downloadDesktopMusicTrack(payload);
  return (
    sanitizeMusicDownloadRecords([result])[0] ??
    createMusicDownloadRecord({
      track: payload.track,
      quality: params.quality,
      status: 'failed',
      errorMessage: 'Desktop music download returned an invalid record.',
    })
  );
}

export async function deleteMusicDownload(downloadId: string): Promise<void> {
  assertDesktopDownloadTarget();

  if (!isDesktopTauriRuntimeAvailable()) {
    throw new Error(
      'Desktop music download bridge is unavailable outside the Tauri shell.'
    );
  }

  await deleteDesktopMusicDownload(downloadId);
}

export async function resolveDownloadedMusicTrackPlaybackUrl(params: {
  source: MusicTrackEntity['source'];
  trackId: string;
}): Promise<string | null> {
  if (!isMusicDownloadBridgeAvailable()) {
    return null;
  }

  const playback = await resolveDesktopMusicDownloadPlayback(params);

  if (!playback.filePath) {
    return null;
  }

  const { convertFileSrc } = await import('@tauri-apps/api/core');
  return convertFileSrc(playback.filePath);
}
