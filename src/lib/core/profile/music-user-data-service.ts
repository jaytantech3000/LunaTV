import type { ProfileContext } from '@/lib/auth';
import { db } from '@/lib/db';

import {
  type SavedMusicCollectionRecord,
  sanitizeMusicCollectionRecord,
  sanitizeMusicCollectionRecordMap,
  sortMusicCollectionsBySavedAt,
} from '@/features/music/services/music-collection-profile-records';
import {
  type MusicPreferences,
  sanitizeMusicPreferences,
} from '@/features/music/services/music-preferences-records';
import {
  type MusicFavoriteRecord,
  type MusicPlayRecord,
  type MusicRecentTrackRecord,
  buildMusicProfileKey,
  sanitizeMusicFavoriteRecord,
  sanitizeMusicFavoriteRecordMap,
  sanitizeMusicPlayRecord,
  sanitizeMusicPlayRecordMap,
  sanitizeMusicRecentTrackRecord,
  sanitizeMusicRecentTrackRecordList,
  upsertMusicRecentTrackRecord,
} from '@/features/music/services/music-profile-records';

import { parseCompositeProfileKey, ProfileServiceError } from './service';

function getProfileUsername(profileContext: ProfileContext): string {
  return profileContext.username;
}

function assertMusicProfileKeyMatchesTrack(
  key: string,
  track: MusicFavoriteRecord['track'] | MusicPlayRecord['track']
): void {
  if (buildMusicProfileKey(track.source, track.id) !== key) {
    throw new ProfileServiceError(
      'Music profile key does not match track',
      400
    );
  }
}

export async function getAllMusicFavorites(
  profileContext: ProfileContext
): Promise<Record<string, MusicFavoriteRecord>> {
  return sanitizeMusicFavoriteRecordMap(
    await db.getAllMusicFavorites(getProfileUsername(profileContext))
  );
}

export async function saveMusicFavoriteRecord(
  profileContext: ProfileContext,
  params: {
    key: string;
    favorite: MusicFavoriteRecord;
  }
): Promise<void> {
  const favorite = sanitizeMusicFavoriteRecord(params.favorite);
  if (!favorite) {
    throw new ProfileServiceError('Invalid music favorite data', 400);
  }

  const { source, id } = parseCompositeProfileKey(
    params.key,
    'Invalid key format'
  );
  assertMusicProfileKeyMatchesTrack(params.key, favorite.track);

  await db.saveMusicFavorite(
    getProfileUsername(profileContext),
    source,
    id,
    favorite
  );
}

export async function deleteMusicFavoriteRecord(
  profileContext: ProfileContext,
  key: string
): Promise<void> {
  const { source, id } = parseCompositeProfileKey(key, 'Invalid key format');
  await db.deleteMusicFavorite(getProfileUsername(profileContext), source, id);
}

export async function deleteAllMusicFavoriteRecords(
  profileContext: ProfileContext
): Promise<void> {
  await db.deleteAllMusicFavorites(getProfileUsername(profileContext));
}

export async function getMusicRecentTrackRecords(
  profileContext: ProfileContext
): Promise<MusicRecentTrackRecord[]> {
  return sanitizeMusicRecentTrackRecordList(
    await db.getMusicRecentTracks(getProfileUsername(profileContext))
  );
}

export async function saveMusicRecentTrackRecords(
  profileContext: ProfileContext,
  params: {
    track: MusicRecentTrackRecord;
  }
): Promise<void> {
  const trackRecord = sanitizeMusicRecentTrackRecord(params.track);
  if (!trackRecord) {
    throw new ProfileServiceError('Invalid music recent track data', 400);
  }

  const currentTracks = await getMusicRecentTrackRecords(profileContext);
  const nextTracks = upsertMusicRecentTrackRecord(currentTracks, trackRecord);

  await db.saveMusicRecentTracks(
    getProfileUsername(profileContext),
    nextTracks
  );
}

export async function deleteAllMusicRecentTrackRecords(
  profileContext: ProfileContext
): Promise<void> {
  await db.deleteAllMusicRecentTracks(getProfileUsername(profileContext));
}

export async function getAllMusicPlayRecords(
  profileContext: ProfileContext
): Promise<Record<string, MusicPlayRecord>> {
  return sanitizeMusicPlayRecordMap(
    await db.getAllMusicPlayRecords(getProfileUsername(profileContext))
  );
}

export async function saveMusicPlayRecord(
  profileContext: ProfileContext,
  params: {
    key: string;
    record: MusicPlayRecord;
  }
): Promise<void> {
  const record = sanitizeMusicPlayRecord(params.record);
  if (!record) {
    throw new ProfileServiceError('Invalid music play record data', 400);
  }

  const { source, id } = parseCompositeProfileKey(
    params.key,
    'Invalid key format'
  );
  assertMusicProfileKeyMatchesTrack(params.key, record.track);

  await db.saveMusicPlayRecord(
    getProfileUsername(profileContext),
    source,
    id,
    record
  );
}

export async function deleteMusicPlayRecord(
  profileContext: ProfileContext,
  key: string
): Promise<void> {
  const { source, id } = parseCompositeProfileKey(key, 'Invalid key format');
  await db.deleteMusicPlayRecord(
    getProfileUsername(profileContext),
    source,
    id
  );
}

export async function deleteAllMusicPlayRecords(
  profileContext: ProfileContext
): Promise<void> {
  await db.deleteAllMusicPlayRecords(getProfileUsername(profileContext));
}

export async function getMusicSavedCollections(
  profileContext: ProfileContext
): Promise<SavedMusicCollectionRecord[]> {
  return Object.values(
    sanitizeMusicCollectionRecordMap(
      await db.getAllMusicCollections(getProfileUsername(profileContext))
    )
  ).sort(sortMusicCollectionsBySavedAt);
}

export async function saveMusicCollectionRecord(
  profileContext: ProfileContext,
  params: {
    key: string;
    collection: SavedMusicCollectionRecord;
  }
): Promise<void> {
  const collection = sanitizeMusicCollectionRecord(params.collection);

  if (!collection) {
    throw new ProfileServiceError('Invalid music collection data', 400);
  }

  const { source, id } = parseCompositeProfileKey(
    params.key,
    'Invalid key format'
  );
  if (
    buildMusicProfileKey(collection.summary.source, collection.summary.id) !==
    params.key
  ) {
    throw new ProfileServiceError(
      'Music collection key does not match summary',
      400
    );
  }

  await db.saveMusicCollection(
    getProfileUsername(profileContext),
    source,
    id,
    collection
  );
}

export async function deleteMusicCollectionRecord(
  profileContext: ProfileContext,
  key: string
): Promise<void> {
  const { source, id } = parseCompositeProfileKey(key, 'Invalid key format');
  await db.deleteMusicCollection(
    getProfileUsername(profileContext),
    source,
    id
  );
}

export async function deleteAllMusicCollectionRecords(
  profileContext: ProfileContext
): Promise<void> {
  await db.deleteAllMusicCollections(getProfileUsername(profileContext));
}

export async function getMusicSearchHistory(
  profileContext: ProfileContext
): Promise<string[]> {
  return db.getMusicSearchHistory(getProfileUsername(profileContext));
}

export async function addMusicSearchHistory(
  profileContext: ProfileContext,
  query: string
): Promise<void> {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    throw new ProfileServiceError('Query is required', 400);
  }

  await db.addMusicSearchHistory(
    getProfileUsername(profileContext),
    normalizedQuery
  );
}

export async function deleteMusicSearchHistory(
  profileContext: ProfileContext,
  query?: string
): Promise<void> {
  const normalizedQuery = query?.trim() || undefined;

  await db.deleteMusicSearchHistory(
    getProfileUsername(profileContext),
    normalizedQuery
  );
}

export async function getMusicPreferences(
  profileContext: ProfileContext
): Promise<MusicPreferences> {
  return sanitizeMusicPreferences(
    await db.getMusicPreferences(getProfileUsername(profileContext))
  );
}

export async function saveMusicPreferences(
  profileContext: ProfileContext,
  preferences: MusicPreferences
): Promise<void> {
  await db.saveMusicPreferences(
    getProfileUsername(profileContext),
    sanitizeMusicPreferences(preferences)
  );
}
