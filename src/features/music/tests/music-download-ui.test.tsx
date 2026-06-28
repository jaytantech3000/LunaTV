import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
  createLiveMusicFetchMock,
  mockMediaElementPlayback,
  resetLiveMusicStores,
} from './live-music-test-utils';
import MusicPageShell from '../app/MusicPageShell';
import MusicPlayerRoot from '../components/MusicPlayerRoot';

const mockDeleteMusicDownload = jest.fn();
const mockDownloadMusicTrack = jest.fn();
let mockDownloadFeatureEnabled = true;
const mockListMusicDownloads = jest.fn();

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid='page-layout'>{children}</div>
  ),
}));

jest.mock('../services/music-downloads', () => ({
  deleteMusicDownload: (...args: unknown[]) => mockDeleteMusicDownload(...args),
  downloadMusicTrack: (...args: unknown[]) => mockDownloadMusicTrack(...args),
  isMusicDownloadBridgeAvailable: jest.fn(() => true),
  isMusicDownloadFeatureEnabled: jest.fn(() => mockDownloadFeatureEnabled),
  listMusicDownloads: (...args: unknown[]) => mockListMusicDownloads(...args),
  resolveDownloadedMusicTrackPlaybackUrl: jest.fn(() => Promise.resolve(null)),
}));

describe('music download ui', () => {
  const originalFetch = global.fetch;
  let mediaPlaybackMocks: ReturnType<typeof mockMediaElementPlayback>;

  beforeEach(() => {
    resetLiveMusicStores();
    mockDownloadFeatureEnabled = true;
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
    };
    global.fetch = createLiveMusicFetchMock();
    mediaPlaybackMocks = mockMediaElementPlayback();
    mockDeleteMusicDownload.mockReset();
    mockDeleteMusicDownload.mockResolvedValue(undefined);
    mockListMusicDownloads.mockReset();
    mockListMusicDownloads.mockResolvedValue([]);
    mockDownloadMusicTrack.mockReset();
    mockDownloadMusicTrack.mockResolvedValue({
      downloadId: 'netease+9001',
      track: {
        id: '9001',
        source: 'netease',
        title: 'Playable Track',
        artists: ['Artist A'],
        album: 'Album A',
        coverUrl: 'https://cdn.music.test/album-a.jpg',
        durationMs: 215000,
        stream: '',
        playable: true,
      },
      quality: 'standard',
      status: 'downloaded',
      progressPercent: 100,
      downloadedBytes: 1024,
      totalBytes: 1024,
      localFilePath: '/tmp/music/9001.mp3',
      errorMessage: null,
      downloadedAt: 1000,
      updatedAt: 1000,
    });
  });

  afterEach(() => {
    mediaPlaybackMocks.pauseSpy.mockRestore();
    mediaPlaybackMocks.playSpy.mockRestore();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('shows download entry points in collection, full player, and offline library', async () => {
    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Open collection 官方榜单',
      })
    );

    expect(
      await screen.findByRole('button', { name: 'Download all tracks' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Download collection track Playable Track',
      })
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Navigate 发现首页' })
      );
    });

    await act(async () => {
      fireEvent.click(
        await screen.findByRole('button', { name: 'Play featured queue' })
      );
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Open full player' }));
    const fullPlayer = await screen.findByTestId('music-full-player');

    await act(async () => {
      fireEvent.click(
        within(fullPlayer).getByRole('button', {
          name: 'Download current track',
        })
      );
    });

    expect(mockDownloadMusicTrack).toHaveBeenCalled();
    expect(
      await within(fullPlayer).findByRole('button', {
        name: 'Delete downloaded track',
      })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Navigate 音乐资料库' })
    );

    expect(
      await screen.findByRole('heading', { name: 'Offline downloads' })
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText('Playable Track').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Navigate 设置' }));

    expect(
      await screen.findByRole('heading', { name: 'Music settings' })
    ).toBeInTheDocument();
    expect(screen.getByText('Offline downloads')).toBeInTheDocument();
    expect(screen.getByText('1 offline download')).toBeInTheDocument();
  });

  it('shows explicit desktop-only download guidance outside the desktop target', async () => {
    mockDownloadFeatureEnabled = false;
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'web',
    };

    render(
      <>
        <MusicPageShell />
        <MusicPlayerRoot />
      </>
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Open collection 官方榜单',
      })
    );

    expect(
      screen.queryByRole('button', { name: 'Download all tracks' })
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText('Downloads are available in the desktop app.')
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Navigate 发现首页' })
      );
    });

    await act(async () => {
      fireEvent.click(
        await screen.findByRole('button', { name: 'Play featured queue' })
      );
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open full player' })
    );
    const fullPlayer = await screen.findByTestId('music-full-player');

    expect(
      within(fullPlayer).queryByRole('button', {
        name: 'Download current track',
      })
    ).not.toBeInTheDocument();
    expect(
      within(fullPlayer).getByText('Downloads are available in the desktop app.')
    ).toBeInTheDocument();
    fireEvent.click(
      within(fullPlayer).getByRole('button', { name: 'Close full player' })
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Navigate 音乐资料库' })
    );

    expect(
      await screen.findByRole('heading', { name: 'Offline downloads' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Downloads are available in the desktop app.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Navigate 设置' }));

    expect(
      await screen.findByRole('heading', { name: 'Music settings' })
    ).toBeInTheDocument();
    expect(screen.getByText('Offline downloads')).toBeInTheDocument();
    expect(screen.getByText('Desktop app only')).toBeInTheDocument();
  });
});
