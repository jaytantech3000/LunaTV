'use client';

import { fireEvent, render, screen } from '@testing-library/react';
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

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) arm64',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent,
    });
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
            configuredPlatforms: ['mac-arm64', 'mac-x64', 'linux-x64'],
            displayName:
              'LunaTV Local Service (local-service-nova-2026-06-16.3)',
            publishedAt: '2026-06-16T03:00:00.000Z',
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
      screen.getByRole('button', { name: 'macOS Apple Silicon 下载' })
    ).toBeEnabled();
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
            configuredPlatforms: ['mac-arm64', 'mac-x64', 'linux-x64'],
            displayName:
              'LunaTV Local Service (local-service-nova-2026-06-16.3)',
            publishedAt: '2026-06-16T03:00:00.000Z',
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
});
