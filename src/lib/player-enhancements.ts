import {
  AudioSpikeProtectionLevel,
  normalizeAudioSpikeProtectionLevel,
  normalizeBooleanSetting,
  normalizeVisualEnhancementLevel,
  VisualEnhancementLevel,
} from '@/lib/player-enhancement-types';
import { AppRuntimeConfig, getRuntimeConfig } from '@/lib/runtime-config';

export interface PlayerEnhancementPreferences {
  audioSpikeProtectionLevel: AudioSpikeProtectionLevel;
  audioDynamicProtectionEnabled: boolean;
  audioFixedCeilingEnabled: boolean;
  visualEnhancementLevel: VisualEnhancementLevel;
}

export type PlayerEnhancementPreferenceKey =
  | 'audioSpikeProtectionLevel'
  | 'audioDynamicProtectionEnabled'
  | 'audioFixedCeilingEnabled'
  | 'visualEnhancementLevel';

export type PlayerEnhancementPreferenceValue =
  PlayerEnhancementPreferences[PlayerEnhancementPreferenceKey];

export const PLAYER_ENHANCEMENTS_UPDATED_EVENT =
  'lunatv:player-enhancements-updated';

const PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY =
  'playerAudioSpikeProtectionLevel';
const PLAYER_AUDIO_DYNAMIC_PROTECTION_STORAGE_KEY =
  'playerAudioDynamicProtectionEnabled';
const PLAYER_AUDIO_FIXED_CEILING_STORAGE_KEY =
  'playerAudioFixedCeilingEnabled';
const PLAYER_VISUAL_ENHANCEMENT_STORAGE_KEY = 'playerVisualEnhancementLevel';
const PLAYER_AUDIO_DEFAULTS_MIGRATION_STORAGE_KEY =
  'playerAudioDefaultsMigratedV2';

const LEGACY_PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY =
  'playerAudioSpikeProtectionEnabled';
const LEGACY_PLAYER_VISUAL_ENHANCEMENT_STORAGE_KEY =
  'playerVisualEnhancementEnabled';

function parseStoredBooleanValue(value: string | null): boolean | null {
  if (value === null) {
    return null;
  }

  return normalizeBooleanSetting(value, false);
}

function shouldMigrateLegacyDefaultAudioPreferences(
  runtimeConfig: AppRuntimeConfig
): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const runtimeAudioSpikeProtectionLevel =
    getDefaultAudioSpikeProtectionLevel(runtimeConfig);
  const runtimeAudioDynamicProtection =
    getDefaultAudioDynamicProtectionEnabled(
      runtimeConfig,
      runtimeAudioSpikeProtectionLevel
    );
  const runtimeAudioFixedCeiling = getDefaultAudioFixedCeilingEnabled(
    runtimeConfig,
    runtimeAudioSpikeProtectionLevel
  );

  if (
    runtimeAudioSpikeProtectionLevel !== 'off' ||
    runtimeAudioDynamicProtection ||
    runtimeAudioFixedCeiling
  ) {
    return false;
  }

  const rawLevel = window.localStorage.getItem(
    PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY
  );
  const rawLegacyLevel = window.localStorage.getItem(
    LEGACY_PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY
  );
  const rawDynamic = window.localStorage.getItem(
    PLAYER_AUDIO_DYNAMIC_PROTECTION_STORAGE_KEY
  );
  const rawFixed = window.localStorage.getItem(
    PLAYER_AUDIO_FIXED_CEILING_STORAGE_KEY
  );

  const level = normalizeAudioSpikeProtectionLevel(
    rawLevel ?? rawLegacyLevel,
    'off'
  );
  const dynamic = normalizeBooleanSetting(rawDynamic, level !== 'off');
  const fixed = normalizeBooleanSetting(rawFixed, level !== 'off');

  if (level !== 'standard' || !dynamic || !fixed) {
    return false;
  }

  const dynamicSetting = parseStoredBooleanValue(rawDynamic);
  const fixedSetting = parseStoredBooleanValue(rawFixed);

  return (
    rawLegacyLevel !== null ||
    ((dynamicSetting === null || dynamicSetting) &&
      (fixedSetting === null || fixedSetting))
  );
}

function auditLegacyDefaultAudioPreferences(
  runtimeConfig: AppRuntimeConfig
): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (
    window.localStorage.getItem(PLAYER_AUDIO_DEFAULTS_MIGRATION_STORAGE_KEY) ===
    'true'
  ) {
    return;
  }

  if (shouldMigrateLegacyDefaultAudioPreferences(runtimeConfig)) {
    window.localStorage.setItem(
      PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY,
      'off'
    );
    window.localStorage.setItem(
      PLAYER_AUDIO_DYNAMIC_PROTECTION_STORAGE_KEY,
      'false'
    );
    window.localStorage.setItem(
      PLAYER_AUDIO_FIXED_CEILING_STORAGE_KEY,
      'false'
    );
  }

  window.localStorage.removeItem(LEGACY_PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY);
  window.localStorage.setItem(
    PLAYER_AUDIO_DEFAULTS_MIGRATION_STORAGE_KEY,
    'true'
  );
}

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

function getDefaultAudioDynamicProtectionEnabled(
  runtimeConfig: AppRuntimeConfig,
  audioSpikeProtectionLevel = getDefaultAudioSpikeProtectionLevel(runtimeConfig)
): boolean {
  return normalizeBooleanSetting(
    runtimeConfig.PLAYER_AUDIO_DYNAMIC_PROTECTION,
    audioSpikeProtectionLevel !== 'off'
  );
}

function getDefaultAudioFixedCeilingEnabled(
  runtimeConfig: AppRuntimeConfig,
  audioSpikeProtectionLevel = getDefaultAudioSpikeProtectionLevel(runtimeConfig)
): boolean {
  return normalizeBooleanSetting(
    runtimeConfig.PLAYER_AUDIO_FIXED_CEILING,
    audioSpikeProtectionLevel !== 'off'
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
  const audioSpikeProtectionLevel =
    getDefaultAudioSpikeProtectionLevel(runtimeConfig);

  return {
    audioSpikeProtectionLevel,
    audioDynamicProtectionEnabled: getDefaultAudioDynamicProtectionEnabled(
      runtimeConfig,
      audioSpikeProtectionLevel
    ),
    audioFixedCeilingEnabled: getDefaultAudioFixedCeilingEnabled(
      runtimeConfig,
      audioSpikeProtectionLevel
    ),
    visualEnhancementLevel: getDefaultVisualEnhancementLevel(runtimeConfig),
  };
}

function getStorageKey(key: PlayerEnhancementPreferenceKey): string {
  switch (key) {
    case 'audioSpikeProtectionLevel':
      return PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY;
    case 'audioDynamicProtectionEnabled':
      return PLAYER_AUDIO_DYNAMIC_PROTECTION_STORAGE_KEY;
    case 'audioFixedCeilingEnabled':
      return PLAYER_AUDIO_FIXED_CEILING_STORAGE_KEY;
    case 'visualEnhancementLevel':
      return PLAYER_VISUAL_ENHANCEMENT_STORAGE_KEY;
    default:
      return PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY;
  }
}

function readStoredAudioSpikeProtectionLevel(
  fallbackValue: AudioSpikeProtectionLevel
): {
  level: AudioSpikeProtectionLevel;
  hasStoredValue: boolean;
} {
  if (typeof window === 'undefined') {
    return {
      level: fallbackValue,
      hasStoredValue: false,
    };
  }

  const value =
    window.localStorage.getItem(PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY) ??
    window.localStorage.getItem(
      LEGACY_PLAYER_AUDIO_SPIKE_PROTECTION_STORAGE_KEY
    );

  return {
    level: normalizeAudioSpikeProtectionLevel(value, fallbackValue),
    hasStoredValue: value !== null,
  };
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

function readStoredBooleanPreference(
  storageKey: string,
  fallbackValue: boolean
): boolean {
  if (typeof window === 'undefined') {
    return fallbackValue;
  }

  return normalizeBooleanSetting(
    window.localStorage.getItem(storageKey),
    fallbackValue
  );
}

export function readPlayerEnhancementPreferences(
  runtimeConfig: AppRuntimeConfig = getRuntimeConfig()
): PlayerEnhancementPreferences {
  auditLegacyDefaultAudioPreferences(runtimeConfig);

  const defaults = getDefaultPlayerEnhancementPreferences(runtimeConfig);
  const storedAudioPreference = readStoredAudioSpikeProtectionLevel(
    defaults.audioSpikeProtectionLevel
  );

  if (typeof window === 'undefined') {
    return defaults;
  }

  const derivedAudioModeFallback = storedAudioPreference.hasStoredValue
    ? storedAudioPreference.level !== 'off'
    : defaults.audioDynamicProtectionEnabled;
  const derivedFixedCeilingFallback = storedAudioPreference.hasStoredValue
    ? storedAudioPreference.level !== 'off'
    : defaults.audioFixedCeilingEnabled;

  return {
    audioSpikeProtectionLevel: storedAudioPreference.level,
    audioDynamicProtectionEnabled: readStoredBooleanPreference(
      PLAYER_AUDIO_DYNAMIC_PROTECTION_STORAGE_KEY,
      derivedAudioModeFallback
    ),
    audioFixedCeilingEnabled: readStoredBooleanPreference(
      PLAYER_AUDIO_FIXED_CEILING_STORAGE_KEY,
      derivedFixedCeilingFallback
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

export function updatePlayerEnhancementPreference<
  K extends PlayerEnhancementPreferenceKey,
>(
  key: K,
  value: PlayerEnhancementPreferences[K],
  runtimeConfig: AppRuntimeConfig = getRuntimeConfig()
): PlayerEnhancementPreferences {
  const currentPreferences = readPlayerEnhancementPreferences(runtimeConfig);
  const nextPreferences = {
    ...currentPreferences,
    [key]: value,
  } as PlayerEnhancementPreferences;

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(getStorageKey(key), String(value));
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
      PLAYER_AUDIO_DYNAMIC_PROTECTION_STORAGE_KEY,
      String(defaults.audioDynamicProtectionEnabled)
    );
    window.localStorage.setItem(
      PLAYER_AUDIO_FIXED_CEILING_STORAGE_KEY,
      String(defaults.audioFixedCeilingEnabled)
    );
    window.localStorage.setItem(
      PLAYER_VISUAL_ENHANCEMENT_STORAGE_KEY,
      defaults.visualEnhancementLevel
    );
  }

  dispatchPlayerEnhancementPreferencesUpdate(defaults);
  return defaults;
}
