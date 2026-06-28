jest.mock('@/lib/profile/runtime', () => ({
  shouldUseProfileApiStorage: jest.fn(() => false),
}));

jest.mock('@/lib/profile/remote-adapter', () => ({
  fetchRemoteProfileJson: jest.fn(),
  postRemoteProfilePayload: jest.fn(),
}));

import {
  fetchRemoteProfileJson,
  postRemoteProfilePayload,
} from '@/lib/profile/remote-adapter';
import { shouldUseProfileApiStorage } from '@/lib/profile/runtime';

import {
  getMusicPreferences,
  saveMusicPreferencesPatch,
} from '../services/music-preferences';

const mockedShouldUseProfileApiStorage =
  shouldUseProfileApiStorage as jest.MockedFunction<
    typeof shouldUseProfileApiStorage
  >;
const mockedFetchRemoteProfileJson =
  fetchRemoteProfileJson as jest.MockedFunction<typeof fetchRemoteProfileJson>;
const mockedPostRemoteProfilePayload =
  postRemoteProfilePayload as jest.MockedFunction<
    typeof postRemoteProfilePayload
  >;

describe('music preferences desktop adapter', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    jest.clearAllMocks();
    mockedShouldUseProfileApiStorage.mockReturnValue(false);
    mockedFetchRemoteProfileJson.mockResolvedValue({});
    mockedPostRemoteProfilePayload.mockResolvedValue({ ok: true } as Response);
  });

  it('uses the desktop music profile api for persisted preferences', async () => {
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    document.cookie = `auth=${encodeURIComponent(
      JSON.stringify({
        username: 'desktop-owner',
        sessionMode: 'desktop-local',
      })
    )}; path=/`;
    mockedFetchRemoteProfileJson.mockResolvedValue({
      themeVariant: 'sunset',
      sidebarCollapsed: true,
      preferredPlaybackQuality: 'high',
      lyricsFollowMode: 'manual',
      playMode: 'single-loop',
      volume: 0.42,
      muted: true,
    });

    await saveMusicPreferencesPatch({
      themeVariant: 'sunset',
      sidebarCollapsed: true,
      preferredPlaybackQuality: 'high',
    });

    expect(mockedPostRemoteProfilePayload).toHaveBeenCalledWith(
      '/music/profile/preferences',
      {
        preferences: {
          themeVariant: 'sunset',
          sidebarCollapsed: true,
          preferredPlaybackQuality: 'high',
          lyricsFollowMode: 'auto',
          playMode: 'list-loop',
          volume: 0.9,
          muted: false,
        },
      },
      {
        redirectOnUnauthorized: false,
      }
    );

    await expect(getMusicPreferences()).resolves.toEqual({
      themeVariant: 'sunset',
      sidebarCollapsed: true,
      preferredPlaybackQuality: 'high',
      lyricsFollowMode: 'manual',
      playMode: 'single-loop',
      volume: 0.42,
      muted: true,
    });
    expect(mockedFetchRemoteProfileJson).toHaveBeenCalledWith(
      '/music/profile/preferences',
      {
        redirectOnUnauthorized: false,
      }
    );
  });

  it('short-circuits remote music preferences while auth is pending', async () => {
    mockedShouldUseProfileApiStorage.mockReturnValue(true);

    await saveMusicPreferencesPatch({
      muted: true,
      volume: 0.33,
    });

    await expect(getMusicPreferences()).resolves.toEqual({
      themeVariant: 'midnight',
      sidebarCollapsed: false,
      preferredPlaybackQuality: 'standard',
      lyricsFollowMode: 'auto',
      playMode: 'list-loop',
      volume: 0.33,
      muted: true,
    });
    expect(mockedFetchRemoteProfileJson).not.toHaveBeenCalled();
    expect(mockedPostRemoteProfilePayload).not.toHaveBeenCalled();
  });
});
