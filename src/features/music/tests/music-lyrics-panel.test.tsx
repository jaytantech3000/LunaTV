import { act, fireEvent, render, screen } from '@testing-library/react';

import { MusicLyricsPanel } from '../components/MusicLyricsPanel';
import { useLyricsStore } from '../state/lyrics-store';
import { usePlaybackStore } from '../state/playback-store';

describe('MusicLyricsPanel', () => {
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
      requestedSeekMs: null,
      error: null,
    });
    useLyricsStore.setState({
      lyrics: {
        trackId: '9001',
        source: 'netease',
        offsetMs: 0,
        lines: [
          { timeMs: 1000, text: '第一句' },
          { timeMs: 2500, text: '第二句' },
          { timeMs: 4000, text: '第三句' },
        ],
      },
      activeLineIndex: 0,
      followMode: 'auto',
      manualSeekLock: false,
    });
  });

  it('auto-scrolls the active lyric line while follow mode is auto', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: jest.fn(),
      configurable: true,
    });
    const scrollIntoViewSpy = jest.spyOn(
      HTMLElement.prototype,
      'scrollIntoView'
    );

    render(<MusicLyricsPanel />);
    scrollIntoViewSpy.mockClear();

    act(() => {
      useLyricsStore.getState().setActiveLineIndex(2);
    });

    expect(scrollIntoViewSpy).toHaveBeenCalled();
    scrollIntoViewSpy.mockRestore();
  });

  it('lets the user switch to manual follow mode and seek by clicking a lyric line', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: jest.fn(),
      configurable: true,
    });
    const scrollIntoViewSpy = jest.spyOn(
      HTMLElement.prototype,
      'scrollIntoView'
    );

    render(<MusicLyricsPanel />);
    scrollIntoViewSpy.mockClear();

    fireEvent.click(
      screen.getByRole('button', { name: 'Set lyrics follow mode to manual' })
    );

    act(() => {
      useLyricsStore.getState().setActiveLineIndex(1);
    });

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Seek to lyric 第二句' })
    );

    expect(usePlaybackStore.getState().requestedSeekMs).toBe(2500);
    scrollIntoViewSpy.mockRestore();
  });
});
