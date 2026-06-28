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
  createLiveMusicFetchMock,
  mockMediaElementPlayback,
  resetLiveMusicStores,
} from './live-music-test-utils';
import MusicPageShell from '../app/MusicPageShell';
import MusicPlayerRoot from '../components/MusicPlayerRoot';

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid='page-layout'>{children}</div>
  ),
}));

describe('music big-bang smoke', () => {
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

  it('runs the rebuilt /music flow end to end with live netease data', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    const collectionButton = await screen.findByRole('button', {
      name: 'Open collection 官方榜单',
    });

    fireEvent.click(collectionButton);
    expect(
      await screen.findByRole('heading', { name: '官方榜单详情' })
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search music'), {
      target: { value: 'hello' },
    });
    fireEvent.submit(screen.getByTestId('music-search-form'));
    expect(
      await screen.findByText('Search results for hello')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Navigate 发现首页',
      })
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Play featured queue' })
    );
    expect(await screen.findByTestId('music-mini-player')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('music-mini-player')).getByText(
        'Playable Track'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open full player' }));
    expect(await screen.findByTestId('music-full-player')).toBeInTheDocument();
    expect(screen.getByTestId('music-lyrics-panel')).toBeInTheDocument();
    expect(screen.getByText('第一句')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close full player' }));
    await waitFor(() => {
      expect(screen.queryByTestId('music-full-player')).not.toBeInTheDocument();
    });
  });

  it('surfaces continue listening, recent plays, and saved tracks in the rebuilt library tab', async () => {
    const { container } = render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', {
      name: 'Open collection 官方榜单',
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Play featured queue' })
      );
    });
    await screen.findByTestId('music-mini-player');
    fireEvent.click(screen.getByRole('button', { name: 'Open full player' }));

    const fullPlayer = await screen.findByTestId('music-full-player');
    fireEvent.click(
      within(fullPlayer).getByRole('button', { name: 'Save track to library' })
    );

    const audio = container.querySelector('audio');

    act(() => {
      if (audio) {
        Object.defineProperty(audio, 'duration', {
          configurable: true,
          value: 215,
        });
        audio.currentTime = 64;
        audio.dispatchEvent(new Event('pause'));
      }
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Navigate 音乐资料库' })
    );

    expect(
      await screen.findByRole('heading', { name: 'Continue listening' })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Saved tracks' })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Recently played' })
    ).toBeInTheDocument();
    expect(await screen.findAllByText('Playable Track')).not.toHaveLength(0);
  });
});
