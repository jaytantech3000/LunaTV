import { ProfileContext } from '@/lib/auth';
import { db } from '@/lib/db';
import { Favorite, PlayRecord, SkipConfig } from '@/lib/types';

import { parseCompositeProfileKey, ProfileServiceError } from './service';

function getProfileUsername(profileContext: ProfileContext): string {
  return profileContext.username;
}

function assertValidPlayRecord(record: PlayRecord): void {
  if (!record.title || !record.source_name || record.index < 1) {
    throw new ProfileServiceError('Invalid record data', 400);
  }
}

function assertValidFavorite(favorite: Favorite): void {
  if (!favorite.title || !favorite.source_name) {
    throw new ProfileServiceError('Invalid favorite data', 400);
  }
}

export async function getAllPlayRecords(profileContext: ProfileContext) {
  return db.getAllPlayRecords(getProfileUsername(profileContext));
}

export async function savePlayRecord(
  profileContext: ProfileContext,
  params: {
    key: string;
    record: PlayRecord;
  }
): Promise<void> {
  assertValidPlayRecord(params.record);

  const { source, id } = parseCompositeProfileKey(
    params.key,
    'Invalid key format'
  );

  const finalRecord: PlayRecord = {
    ...params.record,
    save_time: params.record.save_time ?? Date.now(),
  };

  await db.savePlayRecord(
    getProfileUsername(profileContext),
    source,
    id,
    finalRecord
  );
}

export async function deletePlayRecord(
  profileContext: ProfileContext,
  key: string
): Promise<void> {
  const { source, id } = parseCompositeProfileKey(key, 'Invalid key format');

  await db.deletePlayRecord(getProfileUsername(profileContext), source, id);
}

export async function deleteAllPlayRecords(
  profileContext: ProfileContext
): Promise<void> {
  await db.deleteAllPlayRecords(getProfileUsername(profileContext));
}

export async function getFavorite(profileContext: ProfileContext, key: string) {
  const { source, id } = parseCompositeProfileKey(key, 'Invalid key format');

  return db.getFavorite(getProfileUsername(profileContext), source, id);
}

export async function getAllFavorites(profileContext: ProfileContext) {
  return db.getAllFavorites(getProfileUsername(profileContext));
}

export async function saveFavorite(
  profileContext: ProfileContext,
  params: {
    key: string;
    favorite: Favorite;
  }
): Promise<void> {
  assertValidFavorite(params.favorite);

  const { source, id } = parseCompositeProfileKey(
    params.key,
    'Invalid key format'
  );

  const finalFavorite: Favorite = {
    ...params.favorite,
    save_time: params.favorite.save_time ?? Date.now(),
  };

  await db.saveFavorite(
    getProfileUsername(profileContext),
    source,
    id,
    finalFavorite
  );
}

export async function deleteFavorite(
  profileContext: ProfileContext,
  key: string
): Promise<void> {
  const { source, id } = parseCompositeProfileKey(key, 'Invalid key format');

  await db.deleteFavorite(getProfileUsername(profileContext), source, id);
}

export async function deleteAllFavorites(
  profileContext: ProfileContext
): Promise<void> {
  await db.deleteAllFavorites(getProfileUsername(profileContext));
}

export async function getSearchHistory(profileContext: ProfileContext) {
  return db.getSearchHistory(getProfileUsername(profileContext));
}

export async function addSearchHistory(
  profileContext: ProfileContext,
  keyword: string
): Promise<void> {
  const normalizedKeyword = keyword.trim();

  if (!normalizedKeyword) {
    throw new ProfileServiceError('Keyword is required', 400);
  }

  await db.addSearchHistory(
    getProfileUsername(profileContext),
    normalizedKeyword
  );
}

export async function deleteSearchHistory(
  profileContext: ProfileContext,
  keyword?: string
): Promise<void> {
  const normalizedKeyword = keyword?.trim() || undefined;
  await db.deleteSearchHistory(
    getProfileUsername(profileContext),
    normalizedKeyword
  );
}

export async function getSkipConfig(
  profileContext: ProfileContext,
  source: string,
  id: string
) {
  return db.getSkipConfig(getProfileUsername(profileContext), source, id);
}

export async function getAllSkipConfigs(profileContext: ProfileContext) {
  return db.getAllSkipConfigs(getProfileUsername(profileContext));
}

export async function setSkipConfig(
  profileContext: ProfileContext,
  params: {
    key: string;
    config: SkipConfig;
  }
): Promise<void> {
  const { source, id } = parseCompositeProfileKey(params.key, '无效的key格式');
  const skipConfig: SkipConfig = {
    enable: Boolean(params.config.enable),
    intro_time: Number(params.config.intro_time) || 0,
    outro_time: Number(params.config.outro_time) || 0,
  };

  await db.setSkipConfig(
    getProfileUsername(profileContext),
    source,
    id,
    skipConfig
  );
}

export async function deleteSkipConfig(
  profileContext: ProfileContext,
  key: string
): Promise<void> {
  const { source, id } = parseCompositeProfileKey(key, '无效的key格式');

  await db.deleteSkipConfig(getProfileUsername(profileContext), source, id);
}
