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
        PLAYER_AUDIO_SPIKE_PROTECTION: true,
        PLAYER_VISUAL_ENHANCEMENT: false,
      })
    ).toEqual({
      audioSpikeProtectionEnabled: true,
      visualEnhancementEnabled: false,
    });

    expect(
      readPlayerEnhancementPreferences({
        PLAYER_AUDIO_SPIKE_PROTECTION: true,
        PLAYER_VISUAL_ENHANCEMENT: false,
      })
    ).toEqual({
      audioSpikeProtectionEnabled: true,
      visualEnhancementEnabled: false,
    });
  });

  it('prefers local storage values over runtime defaults', () => {
    window.localStorage.setItem('playerAudioSpikeProtectionEnabled', 'false');
    window.localStorage.setItem('playerVisualEnhancementEnabled', 'true');

    expect(
      readPlayerEnhancementPreferences({
        PLAYER_AUDIO_SPIKE_PROTECTION: true,
        PLAYER_VISUAL_ENHANCEMENT: false,
      })
    ).toEqual({
      audioSpikeProtectionEnabled: false,
      visualEnhancementEnabled: true,
    });
  });

  it('updates a single preference and dispatches a sync event', () => {
    const listener = jest.fn();
    window.addEventListener(PLAYER_ENHANCEMENTS_UPDATED_EVENT, listener);

    const preferences = updatePlayerEnhancementPreference(
      'audioSpikeProtectionEnabled',
      true,
      {
        PLAYER_AUDIO_SPIKE_PROTECTION: false,
        PLAYER_VISUAL_ENHANCEMENT: true,
      }
    );

    expect(preferences).toEqual({
      audioSpikeProtectionEnabled: true,
      visualEnhancementEnabled: true,
    });
    expect(
      window.localStorage.getItem('playerAudioSpikeProtectionEnabled')
    ).toBe('true');
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(PLAYER_ENHANCEMENTS_UPDATED_EVENT, listener);
  });

  it('resets both preferences back to runtime defaults', () => {
    window.localStorage.setItem('playerAudioSpikeProtectionEnabled', 'true');
    window.localStorage.setItem('playerVisualEnhancementEnabled', 'true');

    const preferences = resetPlayerEnhancementPreferences({
      PLAYER_AUDIO_SPIKE_PROTECTION: false,
      PLAYER_VISUAL_ENHANCEMENT: true,
    });

    expect(preferences).toEqual({
      audioSpikeProtectionEnabled: false,
      visualEnhancementEnabled: true,
    });
    expect(
      window.localStorage.getItem('playerAudioSpikeProtectionEnabled')
    ).toBe('false');
    expect(window.localStorage.getItem('playerVisualEnhancementEnabled')).toBe(
      'true'
    );
  });
});
