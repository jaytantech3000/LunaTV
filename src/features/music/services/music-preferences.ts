/* eslint-disable no-console */

import {
  fetchRemoteProfileJson,
  postRemoteProfilePayload,
} from '@/lib/profile/remote-adapter';
import {
  isProfileApiAuthPending,
  PROFILE_API_NO_REDIRECT_OPTIONS,
} from '@/lib/profile/request-state';
import { shouldUseProfileApiStorage } from '@/lib/profile/runtime';

import {
  type MusicPreferences,
  createDefaultMusicPreferences,
  mergeMusicPreferences,
  sanitizeMusicPreferences,
} from './music-preferences-records';

export type MusicPreferencesUpdateEvent = 'musicPreferencesUpdated';

const LOCAL_MUSIC_PREFERENCES_STORAGE_KEY = 'moontv_music_preferences';
const MUSIC_PREFERENCES_API_PATH = '/music/profile/preferences';

function shouldUseRemoteMusicPreferencesStorage(): boolean {
  return shouldUseProfileApiStorage();
}

function logMusicPreferencesFailure(message: string, error: unknown): void {
  console.error(message, error);
}

export function readCachedMusicPreferences(): MusicPreferences {
  if (typeof window === 'undefined') {
    return createDefaultMusicPreferences();
  }

  try {
    const rawValue = localStorage.getItem(LOCAL_MUSIC_PREFERENCES_STORAGE_KEY);

    if (!rawValue) {
      return createDefaultMusicPreferences();
    }

    return sanitizeMusicPreferences(JSON.parse(rawValue) as unknown);
  } catch {
    return createDefaultMusicPreferences();
  }
}

function writeCachedMusicPreferences(preferences: MusicPreferences): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(
      LOCAL_MUSIC_PREFERENCES_STORAGE_KEY,
      JSON.stringify(preferences)
    );
  } catch (error) {
    logMusicPreferencesFailure('写入音乐偏好失败:', error);
  }
}

function dispatchMusicPreferencesUpdate(preferences: MusicPreferences): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<MusicPreferences>('musicPreferencesUpdated', {
      detail: preferences,
    })
  );
}

async function fetchMusicPreferencesFromApi(): Promise<MusicPreferences> {
  const payload = await fetchRemoteProfileJson<unknown>(
    MUSIC_PREFERENCES_API_PATH,
    PROFILE_API_NO_REDIRECT_OPTIONS
  );

  return sanitizeMusicPreferences(payload);
}

export function subscribeToMusicPreferencesUpdates(
  callback: (preferences: MusicPreferences) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleEvent = (event: Event) => {
    callback(
      sanitizeMusicPreferences((event as CustomEvent<MusicPreferences>).detail)
    );
  };

  window.addEventListener('musicPreferencesUpdated', handleEvent);

  return () => {
    window.removeEventListener('musicPreferencesUpdated', handleEvent);
  };
}

export async function getMusicPreferences(): Promise<MusicPreferences> {
  if (shouldUseRemoteMusicPreferencesStorage()) {
    if (isProfileApiAuthPending()) {
      return readCachedMusicPreferences();
    }

    try {
      const preferences = await fetchMusicPreferencesFromApi();
      writeCachedMusicPreferences(preferences);
      return preferences;
    } catch (error) {
      logMusicPreferencesFailure('读取音乐偏好失败:', error);
      return readCachedMusicPreferences();
    }
  }

  return readCachedMusicPreferences();
}

export async function saveMusicPreferencesPatch(
  patch: Partial<MusicPreferences>
): Promise<MusicPreferences> {
  const nextPreferences = mergeMusicPreferences(
    readCachedMusicPreferences(),
    patch
  );

  writeCachedMusicPreferences(nextPreferences);
  dispatchMusicPreferencesUpdate(nextPreferences);

  if (shouldUseRemoteMusicPreferencesStorage() && !isProfileApiAuthPending()) {
    try {
      await postRemoteProfilePayload(
        MUSIC_PREFERENCES_API_PATH,
        {
          preferences: nextPreferences,
        },
        PROFILE_API_NO_REDIRECT_OPTIONS
      );
    } catch (error) {
      logMusicPreferencesFailure('写入远端音乐偏好失败:', error);
    }
  }

  return nextPreferences;
}
