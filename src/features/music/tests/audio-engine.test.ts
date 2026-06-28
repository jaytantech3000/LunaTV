import type { QueueItemEntity } from '../domain/entities';
import { createAudioEngine } from '../services/audio-engine';
import { bindMusicKeyboardShortcuts } from '../services/keyboard-shortcuts';
import { bindMusicMediaSession } from '../services/media-session';
import { usePlaybackStore } from '../state/playback-store';

const CURRENT_TRACK: QueueItemEntity = {
  queueId: 'fixture-1',
  addedAt: 1,
  fromContext: 'featured',
  track: {
    id: 't1',
    source: 'fixture',
    title: 'Neon Harbour',
    artists: ['Luna Ensemble'],
    album: 'Afterglow',
    coverUrl: '/logo.png',
    durationMs: 215000,
    stream: '/fixtures/music/neon-harbour.mp3',
    playable: true,
  },
};

class TestMediaMetadata {
  title: string;
  artist: string;
  album: string;

  constructor(init: { title: string; artist: string; album: string }) {
    this.title = init.title;
    this.artist = init.artist;
    this.album = init.album;
  }
}

describe('playback services', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      queue: [],
      currentTrackId: null,
      playState: 'idle',
      playMode: 'list-loop',
      volume: 0.9,
      muted: false,
      positionMs: 0,
      durationMs: 0,
      bufferedMs: 0,
      error: null,
    });

    Object.defineProperty(globalThis, 'MediaMetadata', {
      value: TestMediaMetadata,
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'mediaSession', {
      value: { metadata: null },
      configurable: true,
    });
  });

  it('writes current time and pause state back into playbackStore', () => {
    const audio = document.createElement('audio');
    const engine = createAudioEngine(audio);

    engine.syncDuration(215000);
    engine.syncPosition(32000);
    engine.pause();

    expect(usePlaybackStore.getState().durationMs).toBe(215000);
    expect(usePlaybackStore.getState().positionMs).toBe(32000);
    expect(usePlaybackStore.getState().playState).toBe('paused');
  });

  it('binds the current track into media session metadata', () => {
    bindMusicMediaSession(CURRENT_TRACK);

    expect(window.navigator.mediaSession.metadata).toMatchObject({
      title: 'Neon Harbour',
      artist: 'Luna Ensemble',
      album: 'Afterglow',
    });
  });

  it('binds keyboard shortcuts and returns an unbind callback', () => {
    const onTogglePlay = jest.fn();
    const onNext = jest.fn();
    const unbind = bindMusicKeyboardShortcuts(onTogglePlay, onNext);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
    unbind();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));

    expect(onTogglePlay).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
