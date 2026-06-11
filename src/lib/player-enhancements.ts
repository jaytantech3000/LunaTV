import {
  AudioSpikeProtectionLevel,
  VisualEnhancementLevel,
  normalizeAudioSpikeProtectionLevel,
  normalizeVisualEnhancementLevel,
} from '@/lib/player-enhancement-types';
import { AppRuntimeConfig, getRuntimeConfig } from '@/lib/runtime-config';

export interface PlayerEnhancementPreferences {
  audioSpikeProtectionLevel: AudioSpikeProtectionLevel;
  visualEnhancementLevel: VisualEnhancementLevel;
}

export type PlayerEnhancementPreferenceKey =
  | 'audioSpikeProtectionLevel'
  | 'visualEnhancementLevel';

export const PLAYER_ENHANCEMENTS_UPDATED_EVENT =
  'lunatv:player-enhancements-updated';

const PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY =
  'playerAudioSpikeProtectionLevel';
const PLAYER_VISUAL_ENHANCEMENT_STORAGE_KEY = 'playerVisualEnhancementLevel';

const LEGACY_PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY =
  'playerAudioSpikeProtectionEnabled';
const LEGACY_PLAYER_VISUAL_ENHANCEMENT_STORAGE_KEY =
  'playerVisualEnhancementEnabled';

function getDefaultAudioSpikeProtectionLevel(
  runtimeConfig: AppRuntimeConfig
): AudioSpikeProtectionLevel {
  return normalizeAudioSpikeProtectionLevel(
    runtimeConfig.PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL ??
      runtimeConfig.PLAYER_AUDIO_SPIKE_PROTECTION,
    'off'
  );
}

function getDefaultVisualEnhancementLevel(
  runtimeConfig: AppRuntimeConfig
): VisualEnhancementLevel {
  return normalizeVisualEnhancementLevel(
    runtimeConfig.PLAYER_VISUAL_ENHANCEMENT_LEVEL ??
      runtimeConfig.PLAYER_VISUAL_ENHANCEMENT,
    'off'
  );
}

export function isAudioSpikeProtectionActive(
  level: AudioSpikeProtectionLevel
): boolean {
  return level !== 'off';
}

export function isVisualEnhancementActive(
  level: VisualEnhancementLevel
): boolean {
  return level !== 'off';
}

export function getDefaultPlayerEnhancementPreferences(
  runtimeConfig: AppRuntimeConfig = getRuntimeConfig()
): PlayerEnhancementPreferences {
  return {
    audioSpikeProtectionLevel:
      getDefaultAudioSpikeProtectionLevel(runtimeConfig),
    visualEnhancementLevel: getDefaultVisualEnhancementLevel(runtimeConfig),
  };
}

function getStorageKey(key: PlayerEnhancementPreferenceKey): string {
  switch (key) {
    case 'audioSpikeProtectionLevel':
      return PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY;
    case 'visualEnhancementLevel':
      return PLAYER_VISUAL_ENHANCEMENT_STORAGE_KEY;
    default:
      return PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY;
  }
}

function readStoredAudioSpikeProtectionLevel(
  fallbackValue: AudioSpikeProtectionLevel
): AudioSpikeProtectionLevel {
  if (typeof window === 'undefined') {
    return fallbackValue;
  }

  const value =
    window.localStorage.getItem(PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY) ??
    window.localStorage.getItem(
      LEGACY_PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY
    );

  return normalizeAudioSpikeProtectionLevel(value, fallbackValue);
}

function readStoredVisualEnhancementLevel(
  fallbackValue: VisualEnhancementLevel
): VisualEnhancementLevel {
  if (typeof window === 'undefined') {
    return fallbackValue;
  }

  const value =
    window.localStorage.getItem(PLAYER_VISUAL_ENHANCEMENT_STORAGE_KEY) ??
    window.localStorage.getItem(LEGACY_PLAYER_VISUAL_ENHANCEMENT_STORAGE_KEY);

  return normalizeVisualEnhancementLevel(value, fallbackValue);
}

export function readPlayerEnhancementPreferences(
  runtimeConfig: AppRuntimeConfig = getRuntimeConfig()
): PlayerEnhancementPreferences {
  const defaults = getDefaultPlayerEnhancementPreferences(runtimeConfig);

  if (typeof window === 'undefined') {
    return defaults;
  }

  return {
    audioSpikeProtectionLevel: readStoredAudioSpikeProtectionLevel(
      defaults.audioSpikeProtectionLevel
    ),
    visualEnhancementLevel: readStoredVisualEnhancementLevel(
      defaults.visualEnhancementLevel
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
  value: AudioSpikeProtectionLevel | VisualEnhancementLevel,
  runtimeConfig: AppRuntimeConfig = getRuntimeConfig()
): PlayerEnhancementPreferences {
  const currentPreferences = readPlayerEnhancementPreferences(runtimeConfig);
  const nextPreferences = {
    ...currentPreferences,
    [key]: value,
  } as PlayerEnhancementPreferences;

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(getStorageKey(key), value);
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
      defaults.audioSpikeProtectionLevel
    );
    window.localStorage.setItem(
      PLAYER_VISUAL_ENHANCEMENT_STORAGE_KEY,
      defaults.visualEnhancementLevel
    );
  }

  dispatchPlayerEnhancementPreferencesUpdate(defaults);
  return defaults;
}
