/* eslint-disable no-console */

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import {
  deleteRemoteProfileResource,
  fetchRemoteProfileJson,
  postRemoteProfilePayload,
} from '@/lib/profile/remote-adapter';
import {
  isProfileApiAuthPending,
  PROFILE_API_NO_REDIRECT_OPTIONS,
} from '@/lib/profile/request-state';
import { shouldUseProfileApiStorage } from '@/lib/profile/runtime';

export const MUSIC_SEARCH_HISTORY_LIMIT = 20;

export type MusicSearchHistoryUpdateEvent = 'musicSearchHistoryUpdated';

const LOCAL_MUSIC_SEARCH_HISTORY_STORAGE_KEY = 'moontv_music_search_history';
const MUSIC_SEARCH_HISTORY_API_PATH = '/music/profile/search-history';
const MUSIC_SEARCH_HISTORY_MIGRATION_MARKER_PREFIX =
  'lunatv:desktop-local-music-search-history-migrated:v1';

let hydrationPromise: Promise<void> | null = null;

function shouldUseRemoteMusicSearchHistoryStorage(): boolean {
  return shouldUseProfileApiStorage();
}

function logMusicSearchHistoryFailure(message: string, error: unknown): void {
  console.error(message, error);
}

function normalizeMusicSearchQuery(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMusicSearchHistory(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const dedupedHistory: string[] = [];
  const seenQueries = new Set<string>();

  for (const entry of value) {
    const query = normalizeMusicSearchQuery(entry);

    if (!query || seenQueries.has(query)) {
      continue;
    }

    seenQueries.add(query);
    dedupedHistory.push(query);

    if (dedupedHistory.length >= MUSIC_SEARCH_HISTORY_LIMIT) {
      break;
    }
  }

  return dedupedHistory;
}

function readLocalMusicSearchHistory(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const rawValue = localStorage.getItem(
      LOCAL_MUSIC_SEARCH_HISTORY_STORAGE_KEY
    );

    if (!rawValue) {
      return [];
    }

    return normalizeMusicSearchHistory(JSON.parse(rawValue) as unknown);
  } catch {
    return [];
  }
}

function writeLocalMusicSearchHistory(history: string[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(
      LOCAL_MUSIC_SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify(history)
    );
  } catch (error) {
    logMusicSearchHistoryFailure('写入音乐搜索历史失败:', error);
  }
}

function clearLocalMusicSearchHistory(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(LOCAL_MUSIC_SEARCH_HISTORY_STORAGE_KEY);
  } catch (error) {
    logMusicSearchHistoryFailure('清空音乐搜索历史失败:', error);
  }
}

function buildNextMusicSearchHistory(
  history: string[],
  query: string
): string[] {
  return [query, ...history.filter((entry) => entry !== query)].slice(
    0,
    MUSIC_SEARCH_HISTORY_LIMIT
  );
}

function dispatchMusicSearchHistoryUpdate(history: string[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<readonly string[]>('musicSearchHistoryUpdated', {
      detail: history,
    })
  );
}

function getMusicMigrationUsername(): string {
  return (
    getAuthInfoFromBrowserCookie()?.username?.trim() || 'desktop-local-owner'
  );
}

function buildMusicSearchHistoryMigrationMarker(username: string): string {
  return `${MUSIC_SEARCH_HISTORY_MIGRATION_MARKER_PREFIX}:${username}`;
}

function isMusicSearchHistoryMigrationComplete(username: string): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    return (
      localStorage.getItem(buildMusicSearchHistoryMigrationMarker(username)) ===
      '1'
    );
  } catch {
    return false;
  }
}

function markMusicSearchHistoryMigrationComplete(username: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(buildMusicSearchHistoryMigrationMarker(username), '1');
  } catch {
    // Ignore marker persistence failures and retry next time.
  }
}

async function fetchMusicSearchHistoryFromApi(): Promise<string[]> {
  const payload = await fetchRemoteProfileJson<unknown[]>(
    MUSIC_SEARCH_HISTORY_API_PATH,
    PROFILE_API_NO_REDIRECT_OPTIONS
  );

  return normalizeMusicSearchHistory(payload);
}

async function migrateDesktopMusicSearchHistory(): Promise<void> {
  const legacyHistory = readLocalMusicSearchHistory();

  if (legacyHistory.length === 0) {
    return;
  }

  const remoteHistory = await fetchMusicSearchHistoryFromApi();
  const remoteHistorySet = new Set(remoteHistory);

  for (const query of [...legacyHistory].reverse()) {
    if (remoteHistorySet.has(query)) {
      continue;
    }

    await postRemoteProfilePayload(
      MUSIC_SEARCH_HISTORY_API_PATH,
      {
        query,
      },
      PROFILE_API_NO_REDIRECT_OPTIONS
    );

    remoteHistorySet.add(query);
  }

  clearLocalMusicSearchHistory();
}

async function hydrateDesktopMusicSearchHistoryStore(): Promise<void> {
  const username = getMusicMigrationUsername();

  if (isMusicSearchHistoryMigrationComplete(username)) {
    return;
  }

  await migrateDesktopMusicSearchHistory();
  markMusicSearchHistoryMigrationComplete(username);
}

async function ensureMusicSearchHistoryStoreHydrated(): Promise<void> {
  if (
    typeof window === 'undefined' ||
    !shouldUseRemoteMusicSearchHistoryStorage() ||
    isProfileApiAuthPending()
  ) {
    return;
  }

  if (!hydrationPromise) {
    hydrationPromise = hydrateDesktopMusicSearchHistoryStore()
      .catch((error) => {
        logMusicSearchHistoryFailure('桌面音乐搜索历史迁移失败:', error);
      })
      .finally(() => {
        hydrationPromise = null;
      });
  }

  await hydrationPromise;
}

export function subscribeToMusicSearchHistoryUpdates(
  callback: (history: string[]) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleEvent = (event: Event) => {
    callback([...(event as CustomEvent<readonly string[]>).detail]);
  };

  window.addEventListener('musicSearchHistoryUpdated', handleEvent);

  return () => {
    window.removeEventListener('musicSearchHistoryUpdated', handleEvent);
  };
}

export async function getMusicSearchHistory(): Promise<string[]> {
  if (shouldUseRemoteMusicSearchHistoryStorage()) {
    if (isProfileApiAuthPending()) {
      return readLocalMusicSearchHistory();
    }

    try {
      await ensureMusicSearchHistoryStoreHydrated();
      const history = await fetchMusicSearchHistoryFromApi();
      writeLocalMusicSearchHistory(history);
      return history;
    } catch (error) {
      logMusicSearchHistoryFailure('读取音乐搜索历史失败:', error);
      return readLocalMusicSearchHistory();
    }
  }

  return readLocalMusicSearchHistory();
}

export async function saveMusicSearchHistoryEntry(
  query: string
): Promise<string[]> {
  const normalizedQuery = normalizeMusicSearchQuery(query);

  if (!normalizedQuery) {
    return readLocalMusicSearchHistory();
  }

  if (
    shouldUseRemoteMusicSearchHistoryStorage() &&
    !isProfileApiAuthPending()
  ) {
    await ensureMusicSearchHistoryStoreHydrated();
  }

  const nextHistory = buildNextMusicSearchHistory(
    readLocalMusicSearchHistory(),
    normalizedQuery
  );
  writeLocalMusicSearchHistory(nextHistory);
  dispatchMusicSearchHistoryUpdate(nextHistory);

  if (
    shouldUseRemoteMusicSearchHistoryStorage() &&
    !isProfileApiAuthPending()
  ) {
    try {
      await postRemoteProfilePayload(
        MUSIC_SEARCH_HISTORY_API_PATH,
        {
          query: normalizedQuery,
        },
        PROFILE_API_NO_REDIRECT_OPTIONS
      );
    } catch (error) {
      logMusicSearchHistoryFailure('写入远端音乐搜索历史失败:', error);
    }
  }

  return nextHistory;
}

export async function deleteMusicSearchHistoryEntry(
  query: string
): Promise<string[]> {
  const normalizedQuery = normalizeMusicSearchQuery(query);

  if (!normalizedQuery) {
    return readLocalMusicSearchHistory();
  }

  if (
    shouldUseRemoteMusicSearchHistoryStorage() &&
    !isProfileApiAuthPending()
  ) {
    await ensureMusicSearchHistoryStoreHydrated();
  }

  const nextHistory = readLocalMusicSearchHistory().filter(
    (entry) => entry !== normalizedQuery
  );
  writeLocalMusicSearchHistory(nextHistory);
  dispatchMusicSearchHistoryUpdate(nextHistory);

  if (
    shouldUseRemoteMusicSearchHistoryStorage() &&
    !isProfileApiAuthPending()
  ) {
    try {
      await deleteRemoteProfileResource(
        MUSIC_SEARCH_HISTORY_API_PATH,
        {
          query: normalizedQuery,
        },
        PROFILE_API_NO_REDIRECT_OPTIONS
      );
    } catch (error) {
      logMusicSearchHistoryFailure('删除远端音乐搜索历史失败:', error);
    }
  }

  return nextHistory;
}

export async function clearMusicSearchHistory(): Promise<void> {
  if (
    shouldUseRemoteMusicSearchHistoryStorage() &&
    !isProfileApiAuthPending()
  ) {
    await ensureMusicSearchHistoryStoreHydrated();
  }

  clearLocalMusicSearchHistory();
  dispatchMusicSearchHistoryUpdate([]);

  if (
    shouldUseRemoteMusicSearchHistoryStorage() &&
    !isProfileApiAuthPending()
  ) {
    try {
      await deleteRemoteProfileResource(
        MUSIC_SEARCH_HISTORY_API_PATH,
        undefined,
        PROFILE_API_NO_REDIRECT_OPTIONS
      );
    } catch (error) {
      logMusicSearchHistoryFailure('清空远端音乐搜索历史失败:', error);
    }
  }
}
