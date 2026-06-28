jest.mock('@/lib/profile/runtime', () => ({
  shouldUseProfileApiStorage: jest.fn(() => false),
}));

import { shouldUseProfileApiStorage } from '@/lib/profile/runtime';

import {
  getMusicPreferences,
  saveMusicPreferencesPatch,
  subscribeToMusicPreferencesUpdates,
} from '../services/music-preferences';

const mockedShouldUseProfileApiStorage =
  shouldUseProfileApiStorage as jest.MockedFunction<
    typeof shouldUseProfileApiStorage
  >;

describe('music preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockedShouldUseProfileApiStorage.mockReturnValue(false);
  });

  it('persists merged local music preferences and dispatches updates', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToMusicPreferencesUpdates(listener);

    const nextPreferences = await saveMusicPreferencesPatch({
      themeVariant: 'sunset',
      sidebarCollapsed: true,
      preferredPlaybackQuality: 'high',
      lyricsFollowMode: 'manual',
      playMode: 'single-loop',
      volume: 0.24,
      muted: true,
    });

    expect(nextPreferences).toEqual({
      themeVariant: 'sunset',
      sidebarCollapsed: true,
      preferredPlaybackQuality: 'high',
      lyricsFollowMode: 'manual',
      playMode: 'single-loop',
      volume: 0.24,
      muted: true,
    });
    await expect(getMusicPreferences()).resolves.toEqual(nextPreferences);
    expect(listener).toHaveBeenLastCalledWith(nextPreferences);

    unsubscribe();
  });

  it('falls back to defaults and clamps invalid local values', async () => {
    localStorage.setItem(
      'moontv_music_preferences',
      JSON.stringify({
        themeVariant: 'unknown',
        sidebarCollapsed: 'yes',
        preferredPlaybackQuality: 'lossless',
        lyricsFollowMode: 'magic',
        playMode: 'shuffle',
        volume: 4,
        muted: 'no',
      })
    );

    await expect(getMusicPreferences()).resolves.toEqual({
      themeVariant: 'midnight',
      sidebarCollapsed: false,
      preferredPlaybackQuality: 'standard',
      lyricsFollowMode: 'auto',
      playMode: 'list-loop',
      volume: 1,
      muted: false,
    });
  });
});
