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

export type AudioSpikeProtectionLevel =
  (typeof AUDIO_SPIKE_PROTECTION_LEVELS)[number];
export type VisualEnhancementLevel = (typeof VISUAL_ENHANCEMENT_LEVELS)[number];

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
