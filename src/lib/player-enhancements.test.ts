import {
  getDefaultPlayerEnhancementPreferences,
  PLAYER_ENHANCEMENTS_UPDATED_EVENT,
  readPlayerEnhancementPreferences,
  resetPlayerEnhancementPreferences,
  updatePlayerEnhancementPreference,
} from '@/lib/player-enhancements';

describe('player enhancement preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reads runtime defaults when no local override exists', () => {
    expect(
      getDefaultPlayerEnhancementPreferences({
        PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: 'strong',
        PLAYER_VISUAL_ENHANCEMENT_LEVEL: 'light',
      })
    ).toEqual({
      audioSpikeProtectionLevel: 'strong',
      visualEnhancementLevel: 'light',
    });

    expect(
      readPlayerEnhancementPreferences({
        PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: 'strong',
        PLAYER_VISUAL_ENHANCEMENT_LEVEL: 'light',
      })
    ).toEqual({
      audioSpikeProtectionLevel: 'strong',
      visualEnhancementLevel: 'light',
    });
  });

  it('falls back to boolean runtime defaults for backward compatibility', () => {
    expect(
      readPlayerEnhancementPreferences({
        PLAYER_AUDIO_SPIKE_PROTECTION: true,
        PLAYER_VISUAL_ENHANCEMENT: false,
      })
    ).toEqual({
      audioSpikeProtectionLevel: 'standard',
      visualEnhancementLevel: 'off',
    });
  });

  it('prefers local storage level values over runtime defaults', () => {
    window.localStorage.setItem('playerAudioSpikeProtectionLevel', 'light');
    window.localStorage.setItem('playerVisualEnhancementLevel', 'strong');

    expect(
      readPlayerEnhancementPreferences({
        PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: 'strong',
        PLAYER_VISUAL_ENHANCEMENT_LEVEL: 'off',
      })
    ).toEqual({
      audioSpikeProtectionLevel: 'light',
      visualEnhancementLevel: 'strong',
    });
  });

  it('migrates legacy boolean storage values into levels', () => {
    window.localStorage.setItem('playerAudioSpikeProtectionEnabled', 'true');
    window.localStorage.setItem('playerVisualEnhancementEnabled', 'false');

    expect(
      readPlayerEnhancementPreferences({
        PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: 'off',
        PLAYER_VISUAL_ENHANCEMENT_LEVEL: 'strong',
      })
    ).toEqual({
      audioSpikeProtectionLevel: 'standard',
      visualEnhancementLevel: 'off',
    });
  });

  it('updates a single preference and dispatches a sync event', () => {
    const listener = jest.fn();
    window.addEventListener(PLAYER_ENHANCEMENTS_UPDATED_EVENT, listener);

    const preferences = updatePlayerEnhancementPreference(
      'audioSpikeProtectionLevel',
      'strong',
      {
        PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: 'off',
        PLAYER_VISUAL_ENHANCEMENT_LEVEL: 'light',
      }
    );

    expect(preferences).toEqual({
      audioSpikeProtectionLevel: 'strong',
      visualEnhancementLevel: 'light',
    });
    expect(window.localStorage.getItem('playerAudioSpikeProtectionLevel')).toBe(
      'strong'
    );
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(PLAYER_ENHANCEMENTS_UPDATED_EVENT, listener);
  });

  it('resets both preferences back to runtime defaults', () => {
    window.localStorage.setItem('playerAudioSpikeProtectionLevel', 'light');
    window.localStorage.setItem('playerVisualEnhancementLevel', 'strong');

    const preferences = resetPlayerEnhancementPreferences({
      PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: 'off',
      PLAYER_VISUAL_ENHANCEMENT_LEVEL: 'standard',
    });

    expect(preferences).toEqual({
      audioSpikeProtectionLevel: 'off',
      visualEnhancementLevel: 'standard',
    });
    expect(window.localStorage.getItem('playerAudioSpikeProtectionLevel')).toBe(
      'off'
    );
    expect(window.localStorage.getItem('playerVisualEnhancementLevel')).toBe(
      'standard'
    );
  });
});
