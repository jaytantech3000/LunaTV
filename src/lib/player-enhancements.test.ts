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

  it('defaults audio spike protection to off when runtime config does not enable it', () => {
    expect(getDefaultPlayerEnhancementPreferences({})).toEqual({
      audioSpikeProtectionLevel: 'off',
      audioDynamicProtectionEnabled: false,
      audioFixedCeilingEnabled: false,
      visualEnhancementLevel: 'off',
    });
  });

  it('reads runtime defaults when no local override exists', () => {
    expect(
      getDefaultPlayerEnhancementPreferences({
        PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: 'strong',
        PLAYER_AUDIO_DYNAMIC_PROTECTION: false,
        PLAYER_AUDIO_FIXED_CEILING: true,
        PLAYER_VISUAL_ENHANCEMENT_LEVEL: 'light',
      })
    ).toEqual({
      audioSpikeProtectionLevel: 'strong',
      audioDynamicProtectionEnabled: false,
      audioFixedCeilingEnabled: true,
      visualEnhancementLevel: 'light',
    });

    expect(
      readPlayerEnhancementPreferences({
        PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: 'strong',
        PLAYER_AUDIO_DYNAMIC_PROTECTION: false,
        PLAYER_AUDIO_FIXED_CEILING: true,
        PLAYER_VISUAL_ENHANCEMENT_LEVEL: 'light',
      })
    ).toEqual({
      audioSpikeProtectionLevel: 'strong',
      audioDynamicProtectionEnabled: false,
      audioFixedCeilingEnabled: true,
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
      audioDynamicProtectionEnabled: true,
      audioFixedCeilingEnabled: true,
      visualEnhancementLevel: 'off',
    });
  });

  it('prefers local storage level values over runtime defaults', () => {
    window.localStorage.setItem('playerAudioSpikeProtectionLevel', 'light');
    window.localStorage.setItem('playerAudioDynamicProtectionEnabled', 'false');
    window.localStorage.setItem('playerAudioFixedCeilingEnabled', 'true');
    window.localStorage.setItem('playerVisualEnhancementLevel', 'strong');

    expect(
      readPlayerEnhancementPreferences({
        PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: 'strong',
        PLAYER_VISUAL_ENHANCEMENT_LEVEL: 'off',
      })
    ).toEqual({
      audioSpikeProtectionLevel: 'light',
      audioDynamicProtectionEnabled: false,
      audioFixedCeilingEnabled: true,
      visualEnhancementLevel: 'strong',
    });
  });

  it('migrates legacy audio default storage values to the new disabled defaults', () => {
    window.localStorage.setItem('playerAudioSpikeProtectionEnabled', 'true');
    window.localStorage.setItem('playerVisualEnhancementEnabled', 'false');

    expect(
      readPlayerEnhancementPreferences({
        PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: 'off',
        PLAYER_VISUAL_ENHANCEMENT_LEVEL: 'strong',
      })
    ).toEqual({
      audioSpikeProtectionLevel: 'off',
      audioDynamicProtectionEnabled: false,
      audioFixedCeilingEnabled: false,
      visualEnhancementLevel: 'off',
    });
    expect(window.localStorage.getItem('playerAudioSpikeProtectionLevel')).toBe(
      'off'
    );
    expect(
      window.localStorage.getItem('playerAudioDynamicProtectionEnabled')
    ).toBe('false');
    expect(window.localStorage.getItem('playerAudioFixedCeilingEnabled')).toBe(
      'false'
    );
  });

  it('backfills the new audio mode toggles from an existing stored level', () => {
    window.localStorage.setItem('playerAudioSpikeProtectionLevel', 'light');

    expect(
      readPlayerEnhancementPreferences({
        PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: 'off',
        PLAYER_AUDIO_DYNAMIC_PROTECTION: false,
        PLAYER_AUDIO_FIXED_CEILING: false,
        PLAYER_VISUAL_ENHANCEMENT_LEVEL: 'off',
      })
    ).toEqual({
      audioSpikeProtectionLevel: 'light',
      audioDynamicProtectionEnabled: true,
      audioFixedCeilingEnabled: true,
      visualEnhancementLevel: 'off',
    });
  });

  it('migrates stored old default standard audio settings to off once', () => {
    window.localStorage.setItem('playerAudioSpikeProtectionLevel', 'standard');
    window.localStorage.setItem('playerAudioDynamicProtectionEnabled', 'true');
    window.localStorage.setItem('playerAudioFixedCeilingEnabled', 'true');

    expect(readPlayerEnhancementPreferences({})).toEqual({
      audioSpikeProtectionLevel: 'off',
      audioDynamicProtectionEnabled: false,
      audioFixedCeilingEnabled: false,
      visualEnhancementLevel: 'off',
    });
    expect(window.localStorage.getItem('playerAudioSpikeProtectionLevel')).toBe(
      'off'
    );
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
      audioDynamicProtectionEnabled: false,
      audioFixedCeilingEnabled: false,
      visualEnhancementLevel: 'light',
    });
    expect(window.localStorage.getItem('playerAudioSpikeProtectionLevel')).toBe(
      'strong'
    );
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(PLAYER_ENHANCEMENTS_UPDATED_EVENT, listener);
  });

  it('updates audio mode toggles independently', () => {
    const preferences = updatePlayerEnhancementPreference(
      'audioDynamicProtectionEnabled',
      true,
      {
        PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: 'standard',
        PLAYER_AUDIO_DYNAMIC_PROTECTION: false,
        PLAYER_AUDIO_FIXED_CEILING: false,
        PLAYER_VISUAL_ENHANCEMENT_LEVEL: 'off',
      }
    );

    expect(preferences).toEqual({
      audioSpikeProtectionLevel: 'standard',
      audioDynamicProtectionEnabled: true,
      audioFixedCeilingEnabled: false,
      visualEnhancementLevel: 'off',
    });
    expect(
      window.localStorage.getItem('playerAudioDynamicProtectionEnabled')
    ).toBe('true');
  });

  it('resets both preferences back to runtime defaults', () => {
    window.localStorage.setItem('playerAudioSpikeProtectionLevel', 'light');
    window.localStorage.setItem('playerAudioDynamicProtectionEnabled', 'false');
    window.localStorage.setItem('playerAudioFixedCeilingEnabled', 'false');
    window.localStorage.setItem('playerVisualEnhancementLevel', 'strong');

    const preferences = resetPlayerEnhancementPreferences({
      PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: 'off',
      PLAYER_AUDIO_DYNAMIC_PROTECTION: true,
      PLAYER_AUDIO_FIXED_CEILING: false,
      PLAYER_VISUAL_ENHANCEMENT_LEVEL: 'standard',
    });

    expect(preferences).toEqual({
      audioSpikeProtectionLevel: 'off',
      audioDynamicProtectionEnabled: true,
      audioFixedCeilingEnabled: false,
      visualEnhancementLevel: 'standard',
    });
    expect(window.localStorage.getItem('playerAudioSpikeProtectionLevel')).toBe(
      'off'
    );
    expect(
      window.localStorage.getItem('playerAudioDynamicProtectionEnabled')
    ).toBe('true');
    expect(window.localStorage.getItem('playerAudioFixedCeilingEnabled')).toBe(
      'false'
    );
    expect(window.localStorage.getItem('playerVisualEnhancementLevel')).toBe(
      'standard'
    );
  });
});
