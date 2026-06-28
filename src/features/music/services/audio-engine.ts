import { usePlaybackStore } from '../state/playback-store';

export interface AudioEngine {
  load: (src: string) => void;
  play: () => Promise<void>;
  pause: () => void;
  syncDuration: (durationMs: number) => void;
  syncPosition: (positionMs: number) => void;
  syncVolume: (volume: number) => void;
  syncMuted: (muted: boolean) => void;
}

function clampAudioVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 0;
  }

  return Math.min(Math.max(volume, 0), 1);
}

export function createAudioEngine(audio: HTMLAudioElement): AudioEngine {
  return {
    load(src) {
      if (audio.src !== src) {
        audio.src = src;
      }
    },
    async play() {
      await audio.play();
      usePlaybackStore.getState().setPlayState('playing');
    },
    pause() {
      audio.pause();
      usePlaybackStore.getState().setPlayState('paused');
    },
    syncDuration(durationMs) {
      usePlaybackStore.getState().setDurationMs(durationMs);
    },
    syncPosition(positionMs) {
      usePlaybackStore.getState().setPositionMs(positionMs);
    },
    syncVolume(volume) {
      audio.volume = clampAudioVolume(volume);
    },
    syncMuted(muted) {
      audio.muted = muted;
    },
  };
}
