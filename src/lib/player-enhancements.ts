import { AppRuntimeConfig, getRuntimeConfig } from '@/lib/runtime-config';

export interface PlayerEnhancementPreferences {
  audioSpikeProtectionEnabled: boolean;
  visualEnhancementEnabled: boolean;
}

export type PlayerEnhancementPreferenceKey =
  | 'audioSpikeProtectionEnabled'
  | 'visualEnhancementEnabled';

export const PLAYER_ENHANCEMENTS_UPDATED_EVENT =
  'lunatv:player-enhancements-updated';

const PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY =
  'playerAudioSpikeProtectionEnabled';
const PLAYER_VISUAL_ENHANCEMENT_STORAGE_KEY = 'playerVisualEnhancementEnabled';

function normalizeBooleanValue(
  value: unknown,
  fallbackValue: boolean
): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'on', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'off', 'no'].includes(normalized)) {
      return false;
    }
  }

  return fallbackValue;
}

export function getDefaultPlayerEnhancementPreferences(
  runtimeConfig: AppRuntimeConfig = getRuntimeConfig()
): PlayerEnhancementPreferences {
  return {
    audioSpikeProtectionEnabled:
      runtimeConfig.PLAYER_AUDIO_SPIKE_PROTECTION === true,
    visualEnhancementEnabled: runtimeConfig.PLAYER_VISUAL_ENHANCEMENT === true,
  };
}

function getStorageKey(key: PlayerEnhancementPreferenceKey): string {
  switch (key) {
    case 'audioSpikeProtectionEnabled':
      return PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY;
    case 'visualEnhancementEnabled':
      return PLAYER_VISUAL_ENHANCEMENT_STORAGE_KEY;
    default:
      return PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY;
  }
}

export function readPlayerEnhancementPreferences(
  runtimeConfig: AppRuntimeConfig = getRuntimeConfig()
): PlayerEnhancementPreferences {
  const defaults = getDefaultPlayerEnhancementPreferences(runtimeConfig);

  if (typeof window === 'undefined') {
    return defaults;
  }

  return {
    audioSpikeProtectionEnabled: normalizeBooleanValue(
      window.localStorage.getItem(PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY),
      defaults.audioSpikeProtectionEnabled
    ),
    visualEnhancementEnabled: normalizeBooleanValue(
      window.localStorage.getItem(PLAYER_VISUAL_ENHANCEMENT_STORAGE_KEY),
      defaults.visualEnhancementEnabled
    ),
  };
}

export function dispatchPlayerEnhancementPreferencesUpdate(
  preferences: PlayerEnhancementPreferences
) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<PlayerEnhancementPreferences>(
      PLAYER_ENHANCEMENTS_UPDATED_EVENT,
      {
        detail: preferences,
      }
    )
  );
}

export function updatePlayerEnhancementPreference(
  key: PlayerEnhancementPreferenceKey,
  value: boolean,
  runtimeConfig: AppRuntimeConfig = getRuntimeConfig()
): PlayerEnhancementPreferences {
  const defaults = readPlayerEnhancementPreferences(runtimeConfig);
  const nextPreferences = {
    ...defaults,
    [key]: value,
  };

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(getStorageKey(key), JSON.stringify(value));
  }

  dispatchPlayerEnhancementPreferencesUpdate(nextPreferences);
  return nextPreferences;
}

export function resetPlayerEnhancementPreferences(
  runtimeConfig: AppRuntimeConfig = getRuntimeConfig()
): PlayerEnhancementPreferences {
  const defaults = getDefaultPlayerEnhancementPreferences(runtimeConfig);

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY,
      JSON.stringify(defaults.audioSpikeProtectionEnabled)
    );
    window.localStorage.setItem(
      PLAYER_VISUAL_ENHANCEMENT_STORAGE_KEY,
      JSON.stringify(defaults.visualEnhancementEnabled)
    );
  }

  dispatchPlayerEnhancementPreferencesUpdate(defaults);
  return defaults;
}
