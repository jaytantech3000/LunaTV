import { fireEvent, render, screen, within } from '@testing-library/react';
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

const originalFetch = global.fetch;

describe('music phase 2 smoke', () => {
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

  it('runs the rebuilt /music flow with live netease data', async () => {
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
  });
});
