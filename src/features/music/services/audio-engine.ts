import { usePlaybackStore } from '../state/playback-store';

export interface AudioEngine {
  load: (src: string) => void;
  play: () => void;
  pause: () => void;
  syncDuration: (durationMs: number) => void;
  syncPosition: (positionMs: number) => void;
}

export function createAudioEngine(audio: HTMLAudioElement): AudioEngine {
  return {
    load(src) {
      audio.src = src;
    },
    play() {
      usePlaybackStore.getState().setPlayState('playing');
    },
    pause() {
      usePlaybackStore.getState().setPlayState('paused');
    },
    syncDuration(durationMs) {
      usePlaybackStore.getState().setDurationMs(durationMs);
    },
    syncPosition(positionMs) {
      usePlaybackStore.getState().setPositionMs(positionMs);
    },
  };
}
