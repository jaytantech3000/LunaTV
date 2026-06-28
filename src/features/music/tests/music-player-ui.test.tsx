import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';

import {
  connectNeteaseSessionFromCookieFallback,
  createLiveMusicFetchMock,
  mockMediaElementPlayback,
  resetLiveMusicStores,
} from './live-music-test-utils';
import MusicPageShell from '../app/MusicPageShell';
import MusicPlayerRoot from '../components/MusicPlayerRoot';
import { getAllMusicFavorites } from '../services/music-profile';
import { usePlaybackStore } from '../state/playback-store';

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid='page-layout'>{children}</div>
  ),
}));

describe('rebuilt music player surfaces', () => {
  const originalFetch = global.fetch;
  let mediaPlaybackMocks: ReturnType<typeof mockMediaElementPlayback>;

  beforeEach(() => {
    resetLiveMusicStores();
    global.fetch = createLiveMusicFetchMock();
    mediaPlaybackMocks = mockMediaElementPlayback();
  });

  afterEach(() => {
    mediaPlaybackMocks.pauseSpy.mockRestore();
    mediaPlaybackMocks.playSpy.mockRestore();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('plays the live queue, shows lyrics, and expands the rebuilt player', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', { name: 'Open collection 官方榜单' });

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Play featured queue' })
      );
    });

    expect(await screen.findByTestId('music-mini-player')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open full player' }));
    expect(await screen.findByTestId('music-full-player')).toBeInTheDocument();
    expect(screen.getByTestId('music-lyrics-panel')).toBeInTheDocument();
    expect(screen.getByText('第一句')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open queue panel' }));
    expect(screen.getByTestId('music-queue-drawer')).toBeInTheDocument();
  });

  it('controls playback from the rebuilt mini and full player surfaces', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', { name: 'Open collection 官方榜单' });

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Play featured queue' })
      );
    });

    const miniPlayer = await screen.findByTestId('music-mini-player');
    expect(within(miniPlayer).getByText('Playable Track')).toBeInTheDocument();

    fireEvent.click(
      within(miniPlayer).getByRole('button', { name: 'Pause track' })
    );
    expect(
      within(screen.getByTestId('music-mini-player')).getByRole('button', {
        name: 'Resume track',
      })
    ).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByTestId('music-mini-player')).getByRole('button', {
        name: 'Resume track',
      })
    );
    expect(
      within(screen.getByTestId('music-mini-player')).getByRole('button', {
        name: 'Pause track',
      })
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId('music-mini-player')).getByRole('button', {
          name: 'Next track',
        })
      );
    });
    expect(
      await within(screen.getByTestId('music-mini-player')).findByText(
        'Second Collection Track'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open full player' }));
    const fullPlayer = await screen.findByTestId('music-full-player');

    await act(async () => {
      fireEvent.click(
        within(fullPlayer).getByRole('button', { name: 'Previous track' })
      );
    });
    expect(
      await within(fullPlayer).findByText('Playable Track')
    ).toBeInTheDocument();
  });

  it('advances and trashes the personal fm queue from the rebuilt transport controls', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', { name: 'Open collection 官方榜单' });

    await connectNeteaseSessionFromCookieFallback();

    await screen.findByRole('button', { name: 'Navigate 私人 FM' });
    fireEvent.click(screen.getByRole('button', { name: 'Navigate 私人 FM' }));

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Play discovery track FM Session Track',
        })
      );
    });

    const miniPlayer = await screen.findByTestId('music-mini-player');
    expect(
      within(miniPlayer).getByRole('button', { name: 'Trash FM track' })
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId('music-mini-player')).getByRole('button', {
          name: 'Next track',
        })
      );
    });
    expect(
      await within(screen.getByTestId('music-mini-player')).findByText(
        'FM Refresh Track One'
      )
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId('music-mini-player')).getByRole('button', {
          name: 'Trash FM track',
        })
      );
    });
    expect(
      await within(screen.getByTestId('music-mini-player')).findByText(
        'FM Trash Replacement'
      )
    ).toBeInTheDocument();
  });

  it('shows playback progress and lets the queue drawer jump to a queued track', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', { name: 'Open collection 官方榜单' });

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Play featured queue' })
      );
    });
    await screen.findByTestId('music-mini-player');
    fireEvent.click(screen.getByRole('button', { name: 'Open full player' }));

    const fullPlayer = await screen.findByTestId('music-full-player');
    act(() => {
      usePlaybackStore.getState().setPositionMs(32000);
      usePlaybackStore.getState().setDurationMs(215000);
    });

    expect(within(fullPlayer).getByText('00:32')).toBeInTheDocument();
    expect(within(fullPlayer).getByText('03:35')).toBeInTheDocument();
    fireEvent.change(within(fullPlayer).getByLabelText('Seek playback'), {
      target: { value: '64000' },
    });
    expect(within(fullPlayer).getByText('01:04')).toBeInTheDocument();

    fireEvent.click(
      within(fullPlayer).getByRole('button', { name: 'Open queue panel' })
    );

    const queueDrawer = await screen.findByTestId('music-queue-drawer');
    expect(
      within(queueDrawer).getByRole('button', {
        name: 'Play queued track Playable Track',
      })
    ).toHaveAttribute('aria-current', 'true');

    await act(async () => {
      fireEvent.click(
        within(queueDrawer).getByRole('button', {
          name: 'Play queued track Second Collection Track',
        })
      );
    });

    expect(
      within(fullPlayer).getAllByText('Second Collection Track').length
    ).toBeGreaterThan(0);
    expect(
      within(queueDrawer).getByRole('button', {
        name: 'Play queued track Second Collection Track',
      })
    ).toHaveAttribute('aria-current', 'true');
  });

  it('toggles the lyrics panel from the rebuilt full player shell', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', { name: 'Open collection 官方榜单' });

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Play featured queue' })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open full player' }));
    expect(await screen.findByTestId('music-lyrics-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide lyrics panel' }));
    expect(screen.queryByTestId('music-lyrics-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show lyrics panel' }));
    expect(screen.getByTestId('music-lyrics-panel')).toBeInTheDocument();
  });

  it('shows live playback progress inside the rebuilt mini player', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', { name: 'Open collection 官方榜单' });

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Play featured queue' })
      );
    });

    act(() => {
      usePlaybackStore.getState().setPositionMs(32000);
      usePlaybackStore.getState().setDurationMs(215000);
    });

    const miniPlayer = await screen.findByTestId('music-mini-player');
    expect(within(miniPlayer).getByText('00:32')).toBeInTheDocument();
    expect(within(miniPlayer).getByText('03:35')).toBeInTheDocument();
    expect(
      within(miniPlayer).getByTestId('music-playback-timeline-compact')
    ).toBeInTheDocument();
  });

  it('lets the rebuilt full player change repeat mode, volume, and mute state', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', { name: 'Open collection 官方榜单' });

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Play featured queue' })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open full player' }));
    const fullPlayer = await screen.findByTestId('music-full-player');

    fireEvent.click(
      within(fullPlayer).getByRole('button', {
        name: 'Switch to single-loop mode',
      })
    );
    expect(usePlaybackStore.getState().playMode).toBe('single-loop');

    fireEvent.change(within(fullPlayer).getByLabelText('Set playback volume'), {
      target: { value: '35' },
    });
    expect(usePlaybackStore.getState().volume).toBeCloseTo(0.35, 5);

    fireEvent.click(
      within(fullPlayer).getByRole('button', { name: 'Mute playback' })
    );
    expect(usePlaybackStore.getState().muted).toBe(true);

    fireEvent.click(
      within(fullPlayer).getByRole('button', { name: 'Unmute playback' })
    );
    expect(usePlaybackStore.getState().muted).toBe(false);
  });

  it('saves the active track to the local library from the rebuilt full player', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', { name: 'Open collection 官方榜单' });

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Play featured queue' })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open full player' }));
    const fullPlayer = await screen.findByTestId('music-full-player');

    fireEvent.click(
      within(fullPlayer).getByRole('button', { name: 'Save track to library' })
    );

    await waitFor(async () => {
      const favorites = await getAllMusicFavorites();

      expect(favorites['netease+9001']).toEqual(
        expect.objectContaining({
          track: expect.objectContaining({
            id: '9001',
          }),
        })
      );
    });
  });
});
