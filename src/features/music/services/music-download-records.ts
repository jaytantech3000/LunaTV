import type {
  MusicDownloadRecord,
  MusicDownloadStatus,
  MusicPlaybackQuality,
  MusicSourceKey,
  MusicTrackEntity,
} from '../domain/entities';
import {
  buildPersistedTrackSnapshot,
  sanitizeTrackSnapshot,
} from './music-profile-records';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveDownloadStatus(value: unknown): MusicDownloadStatus {
  switch (value) {
    case 'idle':
    case 'downloading':
    case 'downloaded':
    case 'failed':
      return value;
    default:
      return 'idle';
  }
}

function resolvePlaybackQuality(value: unknown): MusicPlaybackQuality {
  return value === 'high' ? 'high' : 'standard';
}

function resolveNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function resolveTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : Date.now();
}

function resolveNullableTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function resolveOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeDownloadedRecord(
  record: MusicDownloadRecord
): MusicDownloadRecord {
  if (record.status !== 'downloaded' || record.localFilePath) {
    return record;
  }

  return {
    ...record,
    status: 'failed',
    progressPercent: 0,
    localFilePath: null,
    errorMessage: 'Downloaded file is unavailable.',
    downloadedAt: null,
  };
}

export function buildMusicDownloadId(
  source: MusicSourceKey,
  trackId: string
): string {
  return `${source}+${trackId}`;
}

export function createMusicDownloadRecord(params: {
  track: MusicTrackEntity;
  quality: MusicPlaybackQuality;
  status: MusicDownloadStatus;
  progressPercent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  localFilePath?: string | null;
  errorMessage?: string | null;
  downloadedAt?: number | null;
  updatedAt?: number;
}): MusicDownloadRecord {
  return normalizeDownloadedRecord({
    downloadId: buildMusicDownloadId(params.track.source, params.track.id),
    track: buildPersistedTrackSnapshot(params.track),
    quality: params.quality,
    status: params.status,
    progressPercent: Math.min(
      100,
      Math.max(0, resolveNonNegativeNumber(params.progressPercent))
    ),
    downloadedBytes: resolveNonNegativeNumber(params.downloadedBytes),
    totalBytes: resolveNonNegativeNumber(params.totalBytes),
    localFilePath: resolveOptionalText(params.localFilePath),
    errorMessage: resolveOptionalText(params.errorMessage),
    downloadedAt: resolveNullableTimestamp(params.downloadedAt),
    updatedAt:
      typeof params.updatedAt === 'number' && Number.isFinite(params.updatedAt)
        ? Math.max(params.updatedAt, 0)
        : Date.now(),
  });
}

export function sanitizeMusicDownloadRecord(
  value: unknown
): MusicDownloadRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const track = sanitizeTrackSnapshot(value.track);
  const downloadId =
    typeof value.downloadId === 'string' ? value.downloadId.trim() : '';

  if (!track || !downloadId) {
    return null;
  }

  return normalizeDownloadedRecord({
    downloadId,
    track: buildPersistedTrackSnapshot(track),
    quality: resolvePlaybackQuality(value.quality),
    status: resolveDownloadStatus(value.status),
    progressPercent: Math.min(
      100,
      Math.max(0, resolveNonNegativeNumber(value.progressPercent))
    ),
    downloadedBytes: resolveNonNegativeNumber(value.downloadedBytes),
    totalBytes: resolveNonNegativeNumber(value.totalBytes),
    localFilePath: resolveOptionalText(value.localFilePath),
    errorMessage: resolveOptionalText(value.errorMessage),
    downloadedAt: resolveNullableTimestamp(value.downloadedAt),
    updatedAt: resolveTimestamp(value.updatedAt),
  });
}

export function sanitizeMusicDownloadRecords(
  value: unknown
): MusicDownloadRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => sanitizeMusicDownloadRecord(entry))
    .filter((entry): entry is MusicDownloadRecord => Boolean(entry))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}
