import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import MusicPageShell from '../app/MusicPageShell';
import MusicPlayerRoot from '../components/MusicPlayerRoot';
import { useLyricsStore } from '../state/lyrics-store';
import { usePlaybackStore } from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid='page-layout'>{children}</div>
  ),
}));

describe('music big-bang smoke', () => {
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
    usePlayerSurfaceStore.setState({
      miniVisible: false,
      fullPlayerOpen: false,
      lyricsPanelOpen: true,
      queuePanelOpen: false,
      transitionState: 'idle',
    });
    useLyricsStore.setState({
      lyrics: null,
      activeLineIndex: -1,
      followMode: 'auto',
      manualSeekLock: false,
    });
  });

  it('runs the rebuilt /music flow end to end with fixture data', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    expect(screen.getByText('Music big-bang rewrite')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Play featured queue' })
    );
    expect(await screen.findByTestId('music-mini-player')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open full player' }));
    expect(await screen.findByTestId('music-full-player')).toBeInTheDocument();
    expect(screen.getByTestId('music-lyrics-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close full player' }));
    await waitFor(() => {
      expect(screen.queryByTestId('music-full-player')).not.toBeInTheDocument();
    });
  });
});
