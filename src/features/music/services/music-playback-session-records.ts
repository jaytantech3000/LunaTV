import {
  buildPersistedTrackSnapshot,
  sanitizeTrackSnapshot,
} from './music-profile-records';
import type { MusicQueueContext, QueueItemEntity } from '../domain/entities';

export interface MusicPlaybackSession {
  queue: QueueItemEntity[];
  currentTrackId: string | null;
  positionMs: number;
  durationMs: number;
  savedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function resolveTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function resolveQueueContext(value: unknown): MusicQueueContext | null {
  switch (value) {
    case 'featured':
    case 'recent':
    case 'library':
    case 'discovery':
    case 'fm':
      return value;
    default:
      return null;
  }
}

function sanitizeQueueItem(value: unknown): QueueItemEntity | null {
  if (!isRecord(value)) {
    return null;
  }

  const queueId = typeof value.queueId === 'string' ? value.queueId.trim() : '';
  const fromContext = resolveQueueContext(value.fromContext);
  const track = sanitizeTrackSnapshot(value.track);

  if (!queueId || !fromContext || !track) {
    return null;
  }

  return {
    queueId,
    addedAt: resolveNonNegativeNumber(value.addedAt),
    fromContext,
    track,
  };
}

export function createEmptyMusicPlaybackSession(): MusicPlaybackSession {
  return {
    queue: [],
    currentTrackId: null,
    positionMs: 0,
    durationMs: 0,
    savedAt: 0,
  };
}

export function sanitizeMusicPlaybackSession(
  value: unknown
): MusicPlaybackSession {
  if (!isRecord(value)) {
    return createEmptyMusicPlaybackSession();
  }

  const queue = Array.isArray(value.queue)
    ? value.queue
        .map((item) => sanitizeQueueItem(item))
        .filter((item): item is QueueItemEntity => Boolean(item))
    : [];
  const currentTrackId =
    typeof value.currentTrackId === 'string' && value.currentTrackId.trim()
      ? value.currentTrackId.trim()
      : null;

  if (queue.length === 0 && !currentTrackId) {
    return createEmptyMusicPlaybackSession();
  }

  if (
    !currentTrackId ||
    !queue.some((item) => item.track.id === currentTrackId)
  ) {
    return createEmptyMusicPlaybackSession();
  }

  return {
    queue,
    currentTrackId,
    positionMs: resolveNonNegativeNumber(value.positionMs),
    durationMs: resolveNonNegativeNumber(value.durationMs),
    savedAt: resolveTimestamp(value.savedAt),
  };
}

export function buildMusicPlaybackSessionSnapshot(params: {
  queue: QueueItemEntity[];
  currentTrackId: string | null;
  positionMs: number;
  durationMs: number;
  savedAt?: number;
}): MusicPlaybackSession {
  return sanitizeMusicPlaybackSession({
    queue: params.queue.map((item) => ({
      queueId: item.queueId,
      addedAt: item.addedAt,
      fromContext: item.fromContext,
      track: buildPersistedTrackSnapshot(item.track),
    })),
    currentTrackId: params.currentTrackId,
    positionMs: params.positionMs,
    durationMs: params.durationMs,
    savedAt: params.savedAt ?? Date.now(),
  });
}
