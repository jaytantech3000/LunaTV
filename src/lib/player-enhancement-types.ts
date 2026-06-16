export const AUDIO_SPIKE_PROTECTION_LEVELS = [
  'off',
  'light',
  'standard',
  'strong',
] as const;

export const VISUAL_ENHANCEMENT_LEVELS = [
  'off',
  'light',
  'standard',
  'strong',
] as const;

export const PLAYBACK_BUFFER_MODES = ['standard', 'enhanced', 'max'] as const;

export type AudioSpikeProtectionLevel =
  (typeof AUDIO_SPIKE_PROTECTION_LEVELS)[number];
export type VisualEnhancementLevel = (typeof VISUAL_ENHANCEMENT_LEVELS)[number];
export type PlaybackBufferMode = (typeof PLAYBACK_BUFFER_MODES)[number];

export interface PlayerEnhancementLevelOption<T extends string> {
  value: T;
  label: string;
}

export const AUDIO_SPIKE_PROTECTION_LEVEL_OPTIONS: PlayerEnhancementLevelOption<AudioSpikeProtectionLevel>[] =
  [
    { value: 'off', label: '关闭' },
    { value: 'light', label: '轻度' },
    { value: 'standard', label: '标准' },
    { value: 'strong', label: '强力' },
  ];

export const VISUAL_ENHANCEMENT_LEVEL_OPTIONS: PlayerEnhancementLevelOption<VisualEnhancementLevel>[] =
  [
    { value: 'off', label: '关闭' },
    { value: 'light', label: '轻度' },
    { value: 'standard', label: '标准' },
    { value: 'strong', label: '强力' },
  ];

export const PLAYBACK_BUFFER_MODE_OPTIONS: PlayerEnhancementLevelOption<PlaybackBufferMode>[] =
  [
    { value: 'standard', label: '默认模式' },
    { value: 'enhanced', label: '增强模式' },
    { value: 'max', label: '强力模式' },
  ];

const TRUE_VALUES = new Set(['true', '1', 'on', 'yes']);
const FALSE_VALUES = new Set(['false', '0', 'off', 'no']);
const LIGHT_VALUES = new Set(['light', 'low', 'soft', 'mild']);
const STANDARD_VALUES = new Set([
  'standard',
  'normal',
  'default',
  'balanced',
  'medium',
]);
const STRONG_VALUES = new Set(['strong', 'high', 'hard', 'max', 'aggressive']);

function normalizeStringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();
  return normalizedValue ? normalizedValue : null;
}

function resolveEnabledFallback<T extends string>(
  fallbackValue: T,
  enabledValue: T
): T {
  return fallbackValue === ('off' as T) ? enabledValue : fallbackValue;
}

function normalizeEnhancementLevel<T extends string>(
  value: unknown,
  fallbackValue: T,
  enabledValue: T,
  isValidLevel: (candidate: string) => candidate is T
): T {
  if (typeof value === 'boolean') {
    return value
      ? resolveEnabledFallback(fallbackValue, enabledValue)
      : ('off' as T);
  }

  const normalizedValue = normalizeStringValue(value);
  if (!normalizedValue) {
    return fallbackValue;
  }

  if (isValidLevel(normalizedValue)) {
    return normalizedValue;
  }

  if (TRUE_VALUES.has(normalizedValue)) {
    return resolveEnabledFallback(fallbackValue, enabledValue);
  }

  if (FALSE_VALUES.has(normalizedValue)) {
    return 'off' as T;
  }

  if (LIGHT_VALUES.has(normalizedValue)) {
    return 'light' as T;
  }

  if (STANDARD_VALUES.has(normalizedValue)) {
    return 'standard' as T;
  }

  if (STRONG_VALUES.has(normalizedValue)) {
    return 'strong' as T;
  }

  return fallbackValue;
}

export function normalizeBooleanSetting(
  value: unknown,
  fallbackValue: boolean
): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalizedValue = normalizeStringValue(value);
  if (!normalizedValue) {
    return fallbackValue;
  }

  if (TRUE_VALUES.has(normalizedValue)) {
    return true;
  }

  if (FALSE_VALUES.has(normalizedValue)) {
    return false;
  }

  return fallbackValue;
}

export function isAudioSpikeProtectionLevel(
  value: unknown
): value is AudioSpikeProtectionLevel {
  return AUDIO_SPIKE_PROTECTION_LEVELS.includes(
    value as AudioSpikeProtectionLevel
  );
}

export function isVisualEnhancementLevel(
  value: unknown
): value is VisualEnhancementLevel {
  return VISUAL_ENHANCEMENT_LEVELS.includes(value as VisualEnhancementLevel);
}

export function isPlaybackBufferMode(
  value: unknown
): value is PlaybackBufferMode {
  return PLAYBACK_BUFFER_MODES.includes(value as PlaybackBufferMode);
}

export function normalizeAudioSpikeProtectionLevel(
  value: unknown,
  fallbackValue: AudioSpikeProtectionLevel = 'off'
): AudioSpikeProtectionLevel {
  return normalizeEnhancementLevel(
    value,
    fallbackValue,
    'standard',
    isAudioSpikeProtectionLevel
  );
}

export function normalizeVisualEnhancementLevel(
  value: unknown,
  fallbackValue: VisualEnhancementLevel = 'off'
): VisualEnhancementLevel {
  return normalizeEnhancementLevel(
    value,
    fallbackValue,
    'standard',
    isVisualEnhancementLevel
  );
}

export function normalizePlaybackBufferMode(
  value: unknown,
  fallbackValue: PlaybackBufferMode = 'standard'
): PlaybackBufferMode {
  if (typeof value !== 'string') {
    return fallbackValue;
  }

  const normalizedValue = value.trim().toLowerCase();
  return isPlaybackBufferMode(normalizedValue)
    ? normalizedValue
    : fallbackValue;
}

export function getAudioSpikeProtectionLevelLabel(
  level: AudioSpikeProtectionLevel
): string {
  return (
    AUDIO_SPIKE_PROTECTION_LEVEL_OPTIONS.find(
      (option) => option.value === level
    )?.label || '关闭'
  );
}

export function getVisualEnhancementLevelLabel(
  level: VisualEnhancementLevel
): string {
  return (
    VISUAL_ENHANCEMENT_LEVEL_OPTIONS.find((option) => option.value === level)
      ?.label || '关闭'
  );
}

export function getPlaybackBufferModeLabel(mode: PlaybackBufferMode): string {
  return (
    PLAYBACK_BUFFER_MODE_OPTIONS.find((option) => option.value === mode)
      ?.label || '默认模式'
  );
}
