import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
  connectNeteaseSessionFromCookieFallback,
  createLiveMusicFetchMock,
  mockMediaElementPlayback,
  resetLiveMusicStores,
} from './live-music-test-utils';
import MusicPageShell from '../app/MusicPageShell';
import MusicPlayerRoot from '../components/MusicPlayerRoot';
import type { MusicTrackEntity } from '../domain/entities';
import { useMusicLibraryStore } from '../state/music-library-store';

const SETTINGS_TRACK: MusicTrackEntity = {
  id: 'settings-track',
  source: 'netease',
  title: 'Settings Track',
  artists: ['Settings Artist'],
  album: 'Settings Album',
  coverUrl: 'https://cdn.music.test/settings-track.jpg',
  durationMs: 199000,
  stream: '',
  playable: true,
};

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid='page-layout'>{children}</div>
  ),
}));

const originalFetch = global.fetch;

describe('music phase 2 live ui', () => {
  let mediaPlaybackMocks: ReturnType<typeof mockMediaElementPlayback>;

  beforeEach(() => {
    resetLiveMusicStores();
    global.fetch = createLiveMusicFetchMock();
    mediaPlaybackMocks = mockMediaElementPlayback();
    window.history.replaceState({}, '', '/music');
  });

  afterEach(() => {
    mediaPlaybackMocks.pauseSpy.mockRestore();
    mediaPlaybackMocks.playSpy.mockRestore();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('loads the live home view, search results, and collection details', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    const collectionButton = await screen.findByRole('button', {
      name: 'Open collection 官方榜单',
    });
    expect(
      screen.getByRole('button', { name: 'Navigate 官方榜单' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Explore')).not.toBeInTheDocument();
    expect(screen.queryByText('Library')).not.toBeInTheDocument();

    fireEvent.click(collectionButton);
    expect(
      await screen.findByRole('heading', { name: '官方榜单详情' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open collection 官方榜单' })
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search music'), {
      target: { value: 'hello' },
    });
    fireEvent.submit(screen.getByTestId('music-search-form'));

    expect(
      await screen.findByText('Search results for hello')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Play search track Search Track',
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: '官方榜单详情' })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open search collection Search Playlist',
      })
    );
    expect(
      await screen.findByRole('heading', { name: 'Search Playlist' })
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Search results for hello')
    ).not.toBeInTheDocument();
  });

  it('restores the search surface from the music url state on first load', async () => {
    window.history.replaceState({}, '', '/music?section=search&q=hello');

    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    expect(
      await screen.findByText('Search results for hello')
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search music')).toHaveValue('hello');
    expect(
      screen.queryByRole('button', { name: 'Play featured queue' })
    ).not.toBeInTheDocument();
  });

  it('restores the collection surface from the music url state on first load', async () => {
    window.history.replaceState(
      {},
      '',
      '/music?section=rank&collection=19723756'
    );

    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    expect(
      await screen.findByRole('heading', { name: '官方榜单详情' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Play featured queue' })
    ).not.toBeInTheDocument();
  });

  it('restores the artist collection surface from the music url state on first load', async () => {
    window.history.replaceState(
      {},
      '',
      '/music?section=artist&collection=6452'
    );

    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    expect(
      await screen.findByRole('heading', { name: '周杰伦' })
    ).toBeInTheDocument();
    expect(screen.getByText('热门专辑')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open related collection 即兴曲' })
    ).toBeInTheDocument();
  });

  it('restores the settings surface from the music url state on first load', async () => {
    window.history.replaceState({}, '', '/music?section=settings');

    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    expect(
      await screen.findByRole('heading', { name: 'Music settings' })
    ).toBeInTheDocument();
    expect(screen.getByText('Playback preferences')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Play featured queue' })
    ).not.toBeInTheDocument();
  });

  it('opens an album collection from discovery and syncs the album url state', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open collection 最新专辑' })
    );

    expect(
      await screen.findByRole('heading', { name: '最新专辑详情' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Play collection track Hello' })
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/music');
    expect(window.location.search).toBe('?section=album&collection=3190201');
  });

  it('shows mixed search collections and opens an album result from search', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', {
      name: 'Open collection 官方榜单',
    });

    fireEvent.change(screen.getByPlaceholderText('Search music'), {
      target: { value: 'hello' },
    });
    fireEvent.submit(screen.getByTestId('music-search-form'));

    expect(
      await screen.findByText('Search results for hello')
    ).toBeInTheDocument();
    expect(screen.getByText('2 collections')).toBeInTheDocument();
    expect(screen.getByText('Collection matches')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open search collection Search Album Result',
      })
    );

    expect(
      await screen.findByRole('heading', { name: '最新专辑详情' })
    ).toBeInTheDocument();
    expect(window.location.search).toBe('?section=album&collection=3190201');
  });

  it('opens an artist toplist from search and renders hot songs with hot albums', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', {
      name: 'Open collection 官方榜单',
    });

    fireEvent.change(screen.getByPlaceholderText('Search music'), {
      target: { value: 'jay' },
    });
    fireEvent.submit(screen.getByTestId('music-search-form'));

    expect(
      await screen.findByRole('button', {
        name: 'Open search collection 周杰伦',
      })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Open search collection 周杰伦' })
    );

    expect(
      await screen.findByRole('heading', { name: '周杰伦' })
    ).toBeInTheDocument();
    expect(screen.getByText('热门专辑')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Play collection track 布拉格广场' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open related collection 即兴曲' })
    ).toBeInTheDocument();
    expect(window.location.search).toBe('?section=artist&collection=6452');
  });

  it('refreshes the home view with daily recommendations after connecting a netease session', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', {
      name: 'Open collection 官方榜单',
    });

    await connectNeteaseSessionFromCookieFallback();

    expect(
      await screen.findByRole('button', { name: 'Navigate 每日推荐' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Navigate 私人 FM' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Navigate 每日推荐' }));
    expect(
      await screen.findByRole('button', {
        name: 'Play discovery track Daily Session Track',
      })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Play discovery track Daily Session Track',
      })
    );
    expect(await screen.findByTestId('music-mini-player')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('music-mini-player')).getByText(
        'Daily Session Track'
      )
    ).toBeInTheDocument();
  });

  it('updates settings, uses high quality playback, clears library data, and disconnects the netease session', async () => {
    useMusicLibraryStore.setState({
      hydrated: true,
      loading: false,
      error: null,
      savedCollections: [
        {
          summary: {
            id: '19723756',
            source: 'netease',
            kind: 'rank',
            title: '官方榜单详情',
            coverUrl: 'https://cdn.music.test/toplist.jpg',
            description: 'Toplist Detail',
            trackCount: 10,
            accentColor: '#ff5f6d',
          },
          savedAt: 1111,
        },
      ],
      favoriteTracks: [
        {
          track: SETTINGS_TRACK,
          savedAt: 2222,
        },
      ],
      recentTracks: [
        {
          track: SETTINGS_TRACK,
          playedAt: 3333,
        },
      ],
      resumeTracks: [
        {
          track: SETTINGS_TRACK,
          playedAt: 4444,
          playTimeMs: 32000,
          durationMs: 199000,
          completed: false,
        },
      ],
      savedCollectionKeys: ['netease+19723756'],
      favoriteTrackKeys: ['netease+settings-track'],
    });

    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', { name: 'Open collection 官方榜单' });

    await connectNeteaseSessionFromCookieFallback();

    await screen.findByRole('button', { name: 'Navigate 私人 FM' });
    fireEvent.click(screen.getByRole('button', { name: 'Navigate 设置' }));

    expect(
      await screen.findByRole('heading', { name: 'Music settings' })
    ).toBeInTheDocument();
    expect(screen.getByText('Saved collections')).toBeInTheDocument();
    expect(screen.getByText('Connected as Luna Session')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Use high playback quality' })
    );
    expect(
      screen.getByRole('button', { name: 'Use high playback quality' })
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Use sunset theme' }));
    expect(
      screen.getByRole('button', { name: 'Use sunset theme' })
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(
      screen.getByRole('button', { name: 'Use manual lyric follow' })
    );
    expect(
      screen.getByRole('button', { name: 'Use manual lyric follow' })
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Navigate 发现首页',
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Play featured queue' })
    );
    expect(await screen.findByTestId('music-mini-player')).toBeInTheDocument();

    const trackRequests = (global.fetch as jest.Mock).mock.calls
      .map(([input]) =>
        input instanceof Request
          ? new URL(input.url)
          : new URL(String(input), 'http://localhost')
      )
      .filter((url) => url.pathname === '/api/music/track');

    expect(
      trackRequests.some((url) => url.searchParams.get('quality') === 'high')
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Navigate 设置' }));
    await screen.findByRole('heading', { name: 'Music settings' });

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear saved collections' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved tracks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear recent plays' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Clear continue listening' })
    );

    expect(await screen.findByText('0 saved collections')).toBeInTheDocument();
    expect(screen.getByText('0 saved tracks')).toBeInTheDocument();
    expect(screen.getByText('0 recent plays')).toBeInTheDocument();
    expect(screen.getByText('0 continue listening')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Disconnect Netease session' })
    );

    expect(
      await screen.findByText('No Netease session connected')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Navigate 每日推荐' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Navigate 私人 FM' })
    ).not.toBeInTheDocument();
  });

  it('plays a real netease spotlight track and shows live lyrics', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', {
      name: 'Open collection 官方榜单',
    });

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
    expect(screen.getByText('第一句')).toBeInTheDocument();
  });

  it('plays collection and search tracks from live result lists', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open collection 官方榜单' })
    );
    expect(
      await screen.findByRole('heading', { name: '官方榜单详情' })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Play collection track Second Collection Track',
      })
    );
    expect(await screen.findByTestId('music-mini-player')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('music-mini-player')).getByText(
        'Second Collection Track'
      )
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search music'), {
      target: { value: 'hello' },
    });
    fireEvent.submit(screen.getByTestId('music-search-form'));
    expect(
      await screen.findByText('Search results for hello')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Play search track Search Track Two' })
    );
    expect(
      await within(screen.getByTestId('music-mini-player')).findByText(
        'Search Track Two'
      )
    ).toBeInTheDocument();
  });

  it('plays the full collection and marks the active collection track', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open collection 官方榜单' })
    );
    expect(
      await screen.findByRole('heading', { name: '官方榜单详情' })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Play collection queue' })
    );
    expect(await screen.findByTestId('music-mini-player')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('music-mini-player')).getByText(
        'Playable Track'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Play collection track Playable Track',
      })
    ).toHaveAttribute('aria-current', 'true');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Play collection track Second Collection Track',
      })
    );
    expect(
      await within(screen.getByTestId('music-mini-player')).findByText(
        'Second Collection Track'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Play collection track Second Collection Track',
      })
    ).toHaveAttribute('aria-current', 'true');
  });

  it('plays home discovery tracks from track-list sections', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', {
      name: 'Open collection 官方榜单',
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Play discovery track Discovery Cut Two',
      })
    );

    const miniPlayer = await screen.findByTestId('music-mini-player');
    expect(
      within(miniPlayer).getByText('Discovery Cut Two')
    ).toBeInTheDocument();
  });

  it('plays and highlights the top search hit from the search surface', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', {
      name: 'Open collection 官方榜单',
    });

    fireEvent.change(screen.getByPlaceholderText('Search music'), {
      target: { value: 'hello' },
    });
    fireEvent.submit(screen.getByTestId('music-search-form'));

    expect(
      await screen.findByText('Search results for hello')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Play top search track',
      })
    );

    const miniPlayer = await screen.findByTestId('music-mini-player');
    expect(within(miniPlayer).getByText('Search Track')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Play search track Search Track',
      })
    ).toHaveAttribute('aria-current', 'true');
  });

  it('shows recent searches, replays them, and clears music search history', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', {
      name: 'Open collection 官方榜单',
    });

    const searchInput = screen.getByPlaceholderText('Search music');
    const searchForm = screen.getByTestId('music-search-form');

    fireEvent.change(searchInput, {
      target: { value: 'hello' },
    });
    fireEvent.submit(searchForm);

    expect(
      await screen.findByRole('button', {
        name: 'Run recent search hello',
      })
    ).toBeInTheDocument();

    fireEvent.change(searchInput, {
      target: { value: 'summer' },
    });
    fireEvent.submit(searchForm);

    expect(
      await screen.findByRole('button', {
        name: 'Run recent search summer',
      })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Run recent search hello',
      })
    );

    expect(
      await screen.findByText('Search results for hello')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Clear recent searches',
      })
    );

    expect(
      screen.queryByRole('button', {
        name: 'Run recent search hello',
      })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Run recent search summer',
      })
    ).not.toBeInTheDocument();
  });

  it('saves a collection into the library and reopens it from saved collections', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open collection 官方榜单' })
    );
    expect(
      await screen.findByRole('heading', { name: '官方榜单详情' })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Save collection to library' })
    );

    expect(
      await screen.findByRole('button', {
        name: 'Remove collection from library',
      })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', {
        name: 'Open saved collection 官方榜单详情',
      })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Navigate 音乐资料库',
      })
    );

    const savedCollectionButtons = await screen.findAllByRole('button', {
      name: 'Open saved collection 官方榜单详情',
    });
    expect(savedCollectionButtons).toHaveLength(2);

    fireEvent.click(savedCollectionButtons[1]);

    expect(
      await screen.findByRole('button', {
        name: 'Remove collection from library',
      })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Navigate 发现首页',
      })
    );
    expect(
      screen.queryByRole('heading', { name: '官方榜单详情' })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open saved collection 官方榜单详情',
      })
    );

    expect(
      await screen.findByRole('heading', { name: '官方榜单详情' })
    ).toBeInTheDocument();
  });

  it('syncs music url state as the shell changes surfaces', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open collection 官方榜单' })
    );
    await screen.findByRole('heading', { name: '官方榜单详情' });

    expect(window.location.pathname).toBe('/music');
    expect(window.location.search).toBe('?section=rank&collection=19723756');

    fireEvent.change(screen.getByPlaceholderText('Search music'), {
      target: { value: 'hello' },
    });
    fireEvent.submit(screen.getByTestId('music-search-form'));
    await screen.findByText('Search results for hello');

    expect(window.location.search).toBe('?section=search&q=hello');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Navigate 发现首页',
      })
    );

    expect(window.location.pathname).toBe('/music');
    expect(window.location.search).toBe('');
  });

  it('responds to browser popstate navigation across music surfaces', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open collection 官方榜单' })
    );
    expect(
      await screen.findByRole('heading', { name: '官方榜单详情' })
    ).toBeInTheDocument();

    window.history.pushState({}, '', '/music?section=search&q=hello');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(
      await screen.findByText('Search results for hello')
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search music')).toHaveValue('hello');

    window.history.pushState({}, '', '/music?section=rank&collection=19723756');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(
      await screen.findByRole('heading', { name: '官方榜单详情' })
    ).toBeInTheDocument();

    window.history.pushState({}, '', '/music');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(
      await screen.findByRole('button', { name: 'Play featured queue' })
    ).toBeInTheDocument();
  });

  it('collapses the sidebar into a compact rail', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    await screen.findByRole('button', {
      name: 'Open collection 官方榜单',
    });

    expect(screen.getByText('Browse')).toBeInTheDocument();
    expect(screen.getByText('Now spinning')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Collapse music sidebar',
      })
    );

    expect(
      screen.getByRole('button', {
        name: 'Expand music sidebar',
      })
    ).toBeInTheDocument();
    expect(screen.queryByText('Browse')).not.toBeInTheDocument();
    expect(screen.queryByText('Now spinning')).not.toBeInTheDocument();
  });
});
