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
  type MusicPlaybackSession,
  buildMusicPlaybackSessionSnapshot,
  createEmptyMusicPlaybackSession,
  sanitizeMusicPlaybackSession,
} from './music-playback-session-records';

export { buildMusicPlaybackSessionSnapshot };

const LOCAL_MUSIC_PLAYBACK_SESSION_STORAGE_KEY =
  'moontv_music_playback_session';
const MUSIC_PLAYBACK_SESSION_API_PATH = '/music/profile/playback-session';

function shouldUseRemoteMusicPlaybackSessionStorage(): boolean {
  return shouldUseProfileApiStorage();
}

function readCachedMusicPlaybackSession(): MusicPlaybackSession {
  if (typeof window === 'undefined') {
    return createEmptyMusicPlaybackSession();
  }

  try {
    const rawValue = localStorage.getItem(
      LOCAL_MUSIC_PLAYBACK_SESSION_STORAGE_KEY
    );

    if (!rawValue) {
      return createEmptyMusicPlaybackSession();
    }

    return sanitizeMusicPlaybackSession(JSON.parse(rawValue) as unknown);
  } catch {
    return createEmptyMusicPlaybackSession();
  }
}

function writeCachedMusicPlaybackSession(session: MusicPlaybackSession): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(
      LOCAL_MUSIC_PLAYBACK_SESSION_STORAGE_KEY,
      JSON.stringify(session)
    );
  } catch (error) {
    console.error('写入播放现场快照失败', error);
  }
}

async function fetchMusicPlaybackSessionFromApi(): Promise<MusicPlaybackSession> {
  const payload = await fetchRemoteProfileJson<unknown>(
    MUSIC_PLAYBACK_SESSION_API_PATH,
    PROFILE_API_NO_REDIRECT_OPTIONS
  );

  return sanitizeMusicPlaybackSession(payload);
}

export async function getMusicPlaybackSession(): Promise<MusicPlaybackSession> {
  if (shouldUseRemoteMusicPlaybackSessionStorage()) {
    if (isProfileApiAuthPending()) {
      return readCachedMusicPlaybackSession();
    }

    try {
      const session = await fetchMusicPlaybackSessionFromApi();
      writeCachedMusicPlaybackSession(session);
      return session;
    } catch (error) {
      console.error('读取播放现场快照失败', error);
      return readCachedMusicPlaybackSession();
    }
  }

  return readCachedMusicPlaybackSession();
}

export async function saveMusicPlaybackSession(
  session: MusicPlaybackSession
): Promise<MusicPlaybackSession> {
  const nextSession = sanitizeMusicPlaybackSession(session);

  writeCachedMusicPlaybackSession(nextSession);

  if (
    shouldUseRemoteMusicPlaybackSessionStorage() &&
    !isProfileApiAuthPending()
  ) {
    try {
      await postRemoteProfilePayload(
        MUSIC_PLAYBACK_SESSION_API_PATH,
        {
          session: nextSession,
        },
        PROFILE_API_NO_REDIRECT_OPTIONS
      );
    } catch (error) {
      console.error('写入远端播放现场快照失败', error);
    }
  }

  return nextSession;
}
