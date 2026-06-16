import { PlaybackBufferMode } from '@/lib/player-enhancement-types';

export interface HlsPlaybackConfig {
  lowLatencyMode: boolean;
  maxBufferLength: number;
  backBufferLength: number;
  maxBufferSize: number;
}

const MEGABYTE = 1000 * 1000;

export function getHlsPlaybackConfig(params: {
  mode: PlaybackBufferMode;
  isOfflineMode: boolean;
}): HlsPlaybackConfig {
  const { mode, isOfflineMode } = params;

  if (isOfflineMode) {
    return {
      lowLatencyMode: false,
      maxBufferLength: 30,
      backBufferLength: 30,
      maxBufferSize: 60 * MEGABYTE,
    };
  }

  switch (mode) {
    case 'enhanced':
      return {
        lowLatencyMode: false,
        maxBufferLength: 45,
        backBufferLength: 45,
        maxBufferSize: 90 * MEGABYTE,
      };
    case 'max':
      return {
        lowLatencyMode: false,
        maxBufferLength: 75,
        backBufferLength: 60,
        maxBufferSize: 120 * MEGABYTE,
      };
    case 'standard':
    default:
      return {
        lowLatencyMode: true,
        maxBufferLength: 30,
        backBufferLength: 30,
        maxBufferSize: 60 * MEGABYTE,
      };
  }
}
