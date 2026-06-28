import type { MusicPlaybackQuality } from '../domain/entities';

export type MusicThemeVariant = 'midnight' | 'sunset';
export type MusicLyricsFollowMode = 'auto' | 'manual';
export type MusicPlaybackLoopMode = 'list-loop' | 'single-loop';

export interface MusicPreferences {
  themeVariant: MusicThemeVariant;
  sidebarCollapsed: boolean;
  preferredPlaybackQuality: MusicPlaybackQuality;
  lyricsFollowMode: MusicLyricsFollowMode;
  playMode: MusicPlaybackLoopMode;
  volume: number;
  muted: boolean;
}

const DEFAULT_MUSIC_PREFERENCES: MusicPreferences = {
  themeVariant: 'midnight',
  sidebarCollapsed: false,
  preferredPlaybackQuality: 'standard',
  lyricsFollowMode: 'auto',
  playMode: 'list-loop',
  volume: 0.9,
  muted: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeVolume(value: unknown, fallback: number): number {
  const parsedValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
      ? Number(value)
      : Number.NaN;

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.min(Math.max(parsedValue, 0), 1);
}

export function createDefaultMusicPreferences(): MusicPreferences {
  return {
    ...DEFAULT_MUSIC_PREFERENCES,
  };
}

export function sanitizeMusicPreferences(value: unknown): MusicPreferences {
  const defaults = createDefaultMusicPreferences();

  if (!isRecord(value)) {
    return defaults;
  }

  return {
    themeVariant:
      value.themeVariant === 'sunset' ? 'sunset' : defaults.themeVariant,
    sidebarCollapsed:
      typeof value.sidebarCollapsed === 'boolean'
        ? value.sidebarCollapsed
        : defaults.sidebarCollapsed,
    preferredPlaybackQuality:
      value.preferredPlaybackQuality === 'high'
        ? 'high'
        : defaults.preferredPlaybackQuality,
    lyricsFollowMode:
      value.lyricsFollowMode === 'manual'
        ? 'manual'
        : defaults.lyricsFollowMode,
    playMode:
      value.playMode === 'single-loop' ? 'single-loop' : defaults.playMode,
    volume: normalizeVolume(value.volume, defaults.volume),
    muted: typeof value.muted === 'boolean' ? value.muted : defaults.muted,
  };
}

export function mergeMusicPreferences(
  currentPreferences: MusicPreferences,
  patch: Partial<MusicPreferences>
): MusicPreferences {
  return sanitizeMusicPreferences({
    ...currentPreferences,
    ...patch,
  });
}
