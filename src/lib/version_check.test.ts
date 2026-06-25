jest.mock('@/lib/desktop/tauri-client', () => ({
  fetchLatestRemoteVersionFromDesktop: jest.fn(),
}));

jest.mock('@/lib/release-urls', () => ({
  getVersionFileUrl: jest.fn(() => 'https://example.com/VERSION.txt'),
  getDesktopUpdaterVersionProxyUrl: jest.fn(
    () => 'https://proxy.example.com/api/desktop/updater/version'
  ),
}));

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: jest.fn(),
}));

jest.mock('@/lib/version', () => ({
  CURRENT_VERSION: '200.0.0',
}));

import { fetchLatestRemoteVersionFromDesktop } from '@/lib/desktop/tauri-client';
import { getRuntimeConfig } from '@/lib/runtime-config';

import {
  checkForUpdates,
  fetchLatestRemoteVersion,
  UpdateStatus,
} from './version_check';

function createTextResponse(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

describe('version_check', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (
      fetchLatestRemoteVersionFromDesktop as jest.MockedFunction<
        typeof fetchLatestRemoteVersionFromDesktop
      >
    ).mockReset();
    (
      getRuntimeConfig as jest.MockedFunction<typeof getRuntimeConfig>
    ).mockReset();
    (
      getRuntimeConfig as jest.MockedFunction<typeof getRuntimeConfig>
    ).mockReturnValue({
      APP_TARGET: 'web',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).fetch;
  });

  it('uses the desktop shell for version checks in desktop mode', async () => {
    (
      getRuntimeConfig as jest.MockedFunction<typeof getRuntimeConfig>
    ).mockReturnValue({
      APP_TARGET: 'desktop',
    });
    (
      fetchLatestRemoteVersionFromDesktop as jest.MockedFunction<
        typeof fetchLatestRemoteVersionFromDesktop
      >
    ).mockResolvedValue('200.0.2');

    await expect(fetchLatestRemoteVersion()).resolves.toBe('200.0.2');

    expect(fetchLatestRemoteVersionFromDesktop).toHaveBeenCalledWith([
      'https://example.com/VERSION.txt',
      'https://proxy.example.com/api/desktop/updater/version',
    ]);
  });

  it('falls back to browser fetches when the desktop shell request fails', async () => {
    (
      getRuntimeConfig as jest.MockedFunction<typeof getRuntimeConfig>
    ).mockReturnValue({
      APP_TARGET: 'desktop',
    });
    (
      fetchLatestRemoteVersionFromDesktop as jest.MockedFunction<
        typeof fetchLatestRemoteVersionFromDesktop
      >
    ).mockRejectedValue(new Error('Desktop IPC is unavailable.'));

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(createTextResponse('', 500))
      .mockResolvedValueOnce(createTextResponse('200.0.3'));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchLatestRemoteVersion()).resolves.toBe('200.0.3');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^https:\/\/example\.com\/VERSION\.txt\?_t=\d+$/),
      expect.objectContaining({
        method: 'GET',
        headers: {
          'Content-Type': 'text/plain',
        },
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(
        /^https:\/\/proxy\.example\.com\/api\/desktop\/updater\/version\?_t=\d+$/
      ),
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('returns has_update when a newer desktop-shell version is found', async () => {
    (
      getRuntimeConfig as jest.MockedFunction<typeof getRuntimeConfig>
    ).mockReturnValue({
      APP_TARGET: 'desktop',
    });
    (
      fetchLatestRemoteVersionFromDesktop as jest.MockedFunction<
        typeof fetchLatestRemoteVersionFromDesktop
      >
    ).mockResolvedValue('200.0.2');

    await expect(checkForUpdates()).resolves.toBe(UpdateStatus.HAS_UPDATE);
  });
});
