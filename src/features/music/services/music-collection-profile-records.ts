import type {
  MusicCollectionKind,
  MusicCollectionSummaryEntity,
  MusicSourceKey,
} from '../domain/entities';

export interface SavedMusicCollectionRecord {
  summary: MusicCollectionSummaryEntity;
  savedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveMusicSourceKey(value: unknown): MusicSourceKey | null {
  return value === 'netease' ? value : null;
}

function resolveMusicCollectionKind(
  value: unknown
): MusicCollectionKind | null {
  return value === 'playlist' ||
    value === 'album' ||
    value === 'rank' ||
    value === 'artist-toplist'
    ? value
    : null;
}

function resolvePositiveTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return Date.now();
  }

  return value;
}

function resolveOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resolveOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function sanitizeMusicCollectionSummary(
  value: unknown
): MusicCollectionSummaryEntity | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const source = resolveMusicSourceKey(value.source);
  const kind = resolveMusicCollectionKind(value.kind);
  const title = typeof value.title === 'string' ? value.title.trim() : '';

  if (!id || !source || !kind || !title) {
    return null;
  }

  return {
    id,
    source,
    kind,
    title,
    coverUrl: resolveOptionalString(value.coverUrl),
    description: resolveOptionalString(value.description),
    trackCount: resolveOptionalNumber(value.trackCount),
    accentColor: resolveOptionalString(value.accentColor),
  };
}

export function sanitizeMusicCollectionRecord(
  value: unknown
): SavedMusicCollectionRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const summary = sanitizeMusicCollectionSummary(value.summary);

  if (!summary) {
    return null;
  }

  return {
    summary,
    savedAt: resolvePositiveTimestamp(value.savedAt),
  };
}

export function sanitizeMusicCollectionRecordList(
  value: unknown[]
): SavedMusicCollectionRecord[] {
  return value
    .map((entry) => sanitizeMusicCollectionRecord(entry))
    .filter((entry): entry is SavedMusicCollectionRecord => Boolean(entry))
    .sort(sortMusicCollectionsBySavedAt);
}

export function sanitizeMusicCollectionRecordMap(
  value: Record<string, unknown>
): Record<string, SavedMusicCollectionRecord> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, record]) => {
      const nextRecord = sanitizeMusicCollectionRecord(record);
      return nextRecord ? [[key, nextRecord] as const] : [];
    })
  );
}

export function buildMusicCollectionProfileKey(
  source: MusicSourceKey,
  collectionId: string
): string {
  return `${source}+${collectionId}`;
}

export function sortMusicCollectionsBySavedAt(
  left: SavedMusicCollectionRecord,
  right: SavedMusicCollectionRecord
): number {
  return right.savedAt - left.savedAt;
}
