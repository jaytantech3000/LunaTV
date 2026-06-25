import { type Favorite, type PlayRecord } from './contracts';
import { type FollowRecord, type SkipConfig } from '../types';

export const LOCAL_PLAY_RECORDS_STORAGE_KEY = 'moontv_play_records';
export const LOCAL_FAVORITES_STORAGE_KEY = 'moontv_favorites';
export const LOCAL_FOLLOWS_STORAGE_KEY = 'moontv_follows';
export const LOCAL_SEARCH_HISTORY_STORAGE_KEY = 'moontv_search_history';
export const LOCAL_SKIP_CONFIGS_STORAGE_KEY = 'moontv_skip_configs';
export const LOCAL_SEARCH_HISTORY_LIMIT = 20;

function readLocalJsonValue<T>(storageKey: string, fallback: T): T {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return fallback;
  }

  return JSON.parse(raw) as T;
}

function writeLocalJsonValue(storageKey: string, value: unknown): void {
  localStorage.setItem(storageKey, JSON.stringify(value));
}

export function readLocalPlayRecords(): Record<string, PlayRecord> {
  return readLocalJsonValue<Record<string, PlayRecord>>(
    LOCAL_PLAY_RECORDS_STORAGE_KEY,
    {}
  );
}

export function writeLocalPlayRecords(
  records: Record<string, PlayRecord>
): void {
  writeLocalJsonValue(LOCAL_PLAY_RECORDS_STORAGE_KEY, records);
}

export function clearLocalPlayRecords(): void {
  localStorage.removeItem(LOCAL_PLAY_RECORDS_STORAGE_KEY);
}

export function readLocalFavorites(): Record<string, Favorite> {
  return readLocalJsonValue<Record<string, Favorite>>(
    LOCAL_FAVORITES_STORAGE_KEY,
    {}
  );
}

export function writeLocalFavorites(favorites: Record<string, Favorite>): void {
  writeLocalJsonValue(LOCAL_FAVORITES_STORAGE_KEY, favorites);
}

export function clearLocalFavorites(): void {
  localStorage.removeItem(LOCAL_FAVORITES_STORAGE_KEY);
}

export function readLocalFollowRecords(): Record<string, FollowRecord> {
  return readLocalJsonValue<Record<string, FollowRecord>>(
    LOCAL_FOLLOWS_STORAGE_KEY,
    {}
  );
}

export function writeLocalFollowRecords(
  follows: Record<string, FollowRecord>
): void {
  writeLocalJsonValue(LOCAL_FOLLOWS_STORAGE_KEY, follows);
}

export function clearLocalFollowRecords(): void {
  localStorage.removeItem(LOCAL_FOLLOWS_STORAGE_KEY);
}

export function readLocalSearchHistoryValues(): string[] {
  const value = readLocalJsonValue<unknown[]>(
    LOCAL_SEARCH_HISTORY_STORAGE_KEY,
    []
  );

  return Array.isArray(value) ? (value as string[]) : [];
}

export function writeLocalSearchHistoryValues(values: string[]): void {
  writeLocalJsonValue(LOCAL_SEARCH_HISTORY_STORAGE_KEY, values);
}

export function clearLocalSearchHistoryValues(): void {
  localStorage.removeItem(LOCAL_SEARCH_HISTORY_STORAGE_KEY);
}

export function readLocalSkipConfigs(): Record<string, SkipConfig> {
  return readLocalJsonValue<Record<string, SkipConfig>>(
    LOCAL_SKIP_CONFIGS_STORAGE_KEY,
    {}
  );
}

export function writeLocalSkipConfigs(
  configs: Record<string, SkipConfig>
): void {
  writeLocalJsonValue(LOCAL_SKIP_CONFIGS_STORAGE_KEY, configs);
}

export function clearLocalSkipConfigs(): void {
  localStorage.removeItem(LOCAL_SKIP_CONFIGS_STORAGE_KEY);
}
