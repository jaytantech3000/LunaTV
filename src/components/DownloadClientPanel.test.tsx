'use client';

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';

jest.mock('@/lib/scroll-lock', () => ({
  acquireScrollLock: jest.fn(() => jest.fn()),
}));

import DownloadClientPanel from './DownloadClientPanel';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

describe('DownloadClientPanel', () => {
  const originalFetch = global.fetch;
  const originalUserAgent = navigator.userAgent;
  const originalUserAgentDataDescriptor = Object.getOwnPropertyDescriptor(
    window.navigator,
    'userAgentData'
  );

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });
    Object.defineProperty(window.navigator, 'userAgentData', {
      configurable: true,
      value: {
        getHighEntropyValues: jest.fn().mockResolvedValue({
          architecture: 'arm',
          bitness: '64',
          platform: 'macOS',
        }),
        platform: 'macOS',
      },
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent,
    });

    if (originalUserAgentDataDescriptor) {
      Object.defineProperty(
        window.navigator,
        'userAgentData',
        originalUserAgentDataDescriptor
      );
    } else {
      delete (window.navigator as Navigator & { userAgentData?: unknown })
        .userAgentData;
    }
  });

  it('loads desktop release data and disables unavailable targets', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/desktop-release') {
        return Promise.resolve(
          jsonResponse({
            assets: [
              {
                downloadPath:
                  '/api/client-download?kind=desktop&releaseId=39&assetId=401&expires=1&sig=demo',
                key: 'mac-arm64',
                label: 'macOS Apple Silicon',
                name: 'LunaTV-aarch64.dmg',
                size: 1024 * 1024,
              },
            ],
            missingAssetKeys: ['mac-x64', 'win-x64-setup', 'win-x64-portable'],
            publishedAt: '2026-06-15T00:00:00.000Z',
            releaseId: 39,
            version: 'Desktop Internal #39',
          })
        );
      }

      if (url === '/api/local-service-release') {
        return Promise.resolve(
          jsonResponse({
            availablePlatforms: ['mac-arm64', 'mac-x64', 'linux-x64'],
            configuredPlatforms: ['mac-arm64', 'mac-x64', 'linux-x64'],
            displayName:
              'LunaTV Local Service (local-service-nova-2026-06-16.3)',
            installerPlatforms: ['mac-arm64', 'mac-x64'],
            publishedAt: '2026-06-16T03:00:00.000Z',
            releaseStatus: 'release',
            version: 'local-service-nova-2026-06-16.3',
          })
        );
      }

      return Promise.resolve(new Response(null, { status: 503 }));
    }) as typeof fetch;

    render(<DownloadClientPanel isOpen onClose={jest.fn()} />);

    expect(await screen.findByText('Desktop Internal #39')).toBeInTheDocument();
    expect(
      screen.getByText('local-service-nova-2026-06-16.3')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'macOS Apple Silicon 安装包下载' })
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'macOS Apple Silicon 停止脚本下载' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'macOS Apple Silicon 卸载脚本下载' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'macOS Intel 下载' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Windows x64 脚本下载' })
    ).toBeDisabled();
  });

  it('shows a retry path when desktop release loading fails', async () => {
    let desktopCalls = 0;

    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/desktop-release') {
        desktopCalls += 1;
        if (desktopCalls === 1) {
          return Promise.resolve(
            jsonResponse(
              { error: 'Desktop release is temporarily unavailable' },
              { status: 503 }
            )
          );
        }

        return Promise.resolve(
          jsonResponse({
            assets: [],
            missingAssetKeys: [
              'mac-arm64',
              'mac-x64',
              'win-x64-setup',
              'win-x64-portable',
            ],
            publishedAt: '2026-06-15T00:00:00.000Z',
            releaseId: 39,
            version: 'Desktop Internal #40',
          })
        );
      }

      if (url === '/api/local-service-release') {
        return Promise.resolve(
          jsonResponse({
            availablePlatforms: ['mac-arm64', 'mac-x64', 'linux-x64'],
            configuredPlatforms: ['mac-arm64', 'mac-x64', 'linux-x64'],
            displayName:
              'LunaTV Local Service (local-service-nova-2026-06-16.3)',
            installerPlatforms: ['mac-arm64', 'mac-x64'],
            publishedAt: '2026-06-16T03:00:00.000Z',
            releaseStatus: 'release',
            version: 'local-service-nova-2026-06-16.3',
          })
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    }) as typeof fetch;

    render(<DownloadClientPanel isOpen onClose={jest.fn()} />);

    expect(
      await screen.findByText('Desktop release is temporarily unavailable')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByText('Desktop Internal #40')).toBeInTheDocument();
  });

  it('detects Apple Silicon from userAgentData when the Mac user agent is reduced', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });
    Object.defineProperty(window.navigator, 'userAgentData', {
      configurable: true,
      value: {
        platform: 'macOS',
        getHighEntropyValues: jest.fn().mockResolvedValue({
          architecture: 'arm',
          bitness: '64',
          platform: 'macOS',
        }),
      },
    });

    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/desktop-release') {
        return Promise.resolve(
          jsonResponse({
            assets: [
              {
                downloadPath:
                  '/api/client-download?kind=desktop&releaseId=39&assetId=401&expires=1&sig=demo',
                key: 'mac-arm64',
                label: 'macOS Apple Silicon',
                name: 'LunaTV-aarch64.dmg',
                size: 1024 * 1024,
              },
              {
                downloadPath:
                  '/api/client-download?kind=desktop&releaseId=39&assetId=402&expires=1&sig=demo',
                key: 'mac-x64',
                label: 'macOS Intel',
                name: 'LunaTV-x64.dmg',
                size: 1024 * 1024,
              },
            ],
            missingAssetKeys: ['win-x64-setup', 'win-x64-portable'],
            publishedAt: '2026-06-15T00:00:00.000Z',
            releaseId: 39,
            version: 'Desktop Internal #39',
          })
        );
      }

      if (url === '/api/local-service-release') {
        return Promise.resolve(
          jsonResponse({
            availablePlatforms: ['mac-arm64', 'mac-x64'],
            configuredPlatforms: ['mac-arm64', 'mac-x64'],
            displayName:
              'LunaTV Local Service (local-service-nova-2026-06-16.3)',
            installerPlatforms: ['mac-arm64', 'mac-x64'],
            publishedAt: '2026-06-16T03:00:00.000Z',
            releaseStatus: 'release',
            version: 'local-service-nova-2026-06-16.3',
          })
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    }) as typeof fetch;

    render(<DownloadClientPanel isOpen onClose={jest.fn()} />);

    expect(await screen.findByText('Desktop Internal #39')).toBeInTheDocument();

    await waitFor(() => {
      const desktopArmRow = screen.getByRole('button', {
        name: 'macOS Apple Silicon 下载',
      }).parentElement as HTMLElement;
      const desktopIntelRow = screen.getByRole('button', {
        name: 'macOS Intel 下载',
      }).parentElement as HTMLElement;
      const localServiceArmRow = screen.getByRole('button', {
        name: 'macOS Apple Silicon 安装包下载',
      }).parentElement?.parentElement as HTMLElement;
      const localServiceIntelRow = screen.getByRole('button', {
        name: 'macOS Intel 安装包下载',
      }).parentElement?.parentElement as HTMLElement;

      expect(within(desktopArmRow).getByText('当前设备')).toBeInTheDocument();
      expect(within(desktopIntelRow).queryByText('当前设备')).toBeNull();
      expect(
        within(localServiceArmRow).getByText('当前设备')
      ).toBeInTheDocument();
      expect(within(localServiceIntelRow).queryByText('当前设备')).toBeNull();
    });
  });

  it('shows a missing-release warning and disables unavailable local-service downloads', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/desktop-release') {
        return Promise.resolve(
          jsonResponse({
            assets: [],
            missingAssetKeys: [
              'mac-arm64',
              'mac-x64',
              'win-x64-setup',
              'win-x64-portable',
            ],
            publishedAt: '2026-06-15T00:00:00.000Z',
            releaseId: 39,
            version: 'Desktop Internal #39',
          })
        );
      }

      if (url === '/api/local-service-release') {
        return Promise.resolve(
          jsonResponse({
            availablePlatforms: [],
            configuredPlatforms: [
              'linux-arm64',
              'linux-x64',
              'mac-arm64',
              'mac-x64',
              'win-x64',
            ],
            displayName: null,
            installerPlatforms: [],
            publishedAt: null,
            releaseStatus: 'missing',
            version: 'local-service-luna-latest',
          })
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    }) as typeof fetch;

    render(<DownloadClientPanel isOpen onClose={jest.fn()} />);

    expect(await screen.findByText('Desktop Internal #39')).toBeInTheDocument();
    expect(
      screen.getByText(
        '当前发布通道暂未找到可下载的本地服务产物，安装入口已禁用。请先发布对应的 local-service release，再刷新此面板。'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'macOS Apple Silicon 脚本下载' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Windows x64 脚本下载' })
    ).toBeDisabled();
  });

  it('prefers the Windows installer button when the release includes a packaged exe', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });
    Object.defineProperty(window.navigator, 'userAgentData', {
      configurable: true,
      value: undefined,
    });

    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/desktop-release') {
        return Promise.resolve(
          jsonResponse({
            assets: [],
            missingAssetKeys: [
              'mac-arm64',
              'mac-x64',
              'win-x64-setup',
              'win-x64-portable',
            ],
            publishedAt: '2026-06-15T00:00:00.000Z',
            releaseId: 39,
            version: 'Desktop Internal #39',
          })
        );
      }

      if (url === '/api/local-service-release') {
        return Promise.resolve(
          jsonResponse({
            availablePlatforms: ['win-x64'],
            configuredPlatforms: ['win-x64'],
            displayName:
              'LunaTV Local Service (local-service-nova-2026-06-17.1)',
            installerPlatforms: ['win-x64'],
            publishedAt: '2026-06-17T03:00:00.000Z',
            releaseStatus: 'release',
            version: 'local-service-nova-2026-06-17.1',
          })
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    }) as typeof fetch;

    render(<DownloadClientPanel isOpen onClose={jest.fn()} />);

    expect(
      await screen.findByText('local-service-nova-2026-06-17.1')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Windows x64 安装包下载' })
    ).toBeEnabled();
    expect(
      screen.getByText('下载 Windows 安装包 (.exe)，双击即可安装并自动启动')
    ).toBeInTheDocument();
  });

  it('shows a Linux .deb installer while keeping the script fallback visible', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });
    Object.defineProperty(window.navigator, 'userAgentData', {
      configurable: true,
      value: undefined,
    });

    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/desktop-release') {
        return Promise.resolve(
          jsonResponse({
            assets: [],
            missingAssetKeys: [
              'mac-arm64',
              'mac-x64',
              'win-x64-setup',
              'win-x64-portable',
            ],
            publishedAt: '2026-06-15T00:00:00.000Z',
            releaseId: 39,
            version: 'Desktop Internal #39',
          })
        );
      }

      if (url === '/api/local-service-release') {
        return Promise.resolve(
          jsonResponse({
            availablePlatforms: ['linux-x64'],
            configuredPlatforms: ['linux-x64'],
            displayName:
              'LunaTV Local Service (local-service-nova-2026-06-17.2)',
            installerPlatforms: ['linux-x64'],
            publishedAt: '2026-06-17T04:00:00.000Z',
            releaseStatus: 'release',
            version: 'local-service-nova-2026-06-17.2',
          })
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    }) as typeof fetch;

    render(<DownloadClientPanel isOpen onClose={jest.fn()} />);

    expect(
      await screen.findByText('local-service-nova-2026-06-17.2')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Linux x64 安装包下载' })
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Linux x64 脚本下载' })
    ).toBeEnabled();
    expect(
      screen.getByText(
        '下载 Debian / Ubuntu 安装包 (.deb)，安装后自动注册 systemd 服务；其他发行版仍可改用脚本'
      )
    ).toBeInTheDocument();
  });
});
