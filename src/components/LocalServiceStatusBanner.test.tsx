'use client';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { LOCAL_SERVICE_ACCELERATION_STORAGE_KEY } from '@/lib/local-service-runtime';

import {
  LocalServiceStatusBanner,
  LocalServiceStatusProvider,
  LocalServiceStatusSidebarPill,
} from './LocalServiceStatusBanner';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

async function renderWithStatus(children: React.ReactNode) {
  let view:
    | ReturnType<typeof render>
    | undefined;

  await act(async () => {
    view = render(
      <LocalServiceStatusProvider>{children}</LocalServiceStatusProvider>
    );
  });

  if (!view) {
    throw new Error('expected local service status render to complete');
  }

  return view;
}

describe('LocalServiceStatusBanner', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    window.RUNTIME_CONFIG = {};
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders a compact activation popover when the local service is online', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        jsonResponse({
          base_url: 'http://127.0.0.1:8787',
          port: 8787,
          status: 'ok',
        })
      )
    ) as typeof fetch;

    await renderWithStatus(<LocalServiceStatusBanner />);

    expect(await screen.findByText('本地服务已就绪')).toBeInTheDocument();
    expect(screen.getByText('127.0.0.1:8787')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启动' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检测' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '最小化本地服务提示' })
    ).toBeInTheDocument();
  });

  it('can minimize and restore the local service popover', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        jsonResponse({
          base_url: 'http://127.0.0.1:8787',
          port: 8787,
          status: 'ok',
        })
      )
    ) as typeof fetch;

    await renderWithStatus(<LocalServiceStatusBanner />);

    fireEvent.click(
      await screen.findByRole('button', { name: '最小化本地服务提示' })
    );

    expect(screen.queryByText('本地服务已就绪')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '展开本地服务提示' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开本地服务提示' }));

    expect(await screen.findByText('本地服务已就绪')).toBeInTheDocument();
  });

  it('shows activation feedback and stores the media proxy override before reload', async () => {
    jest.useFakeTimers();

    try {
      global.fetch = jest.fn(() =>
        Promise.resolve(
          jsonResponse({
            base_url: 'http://127.0.0.1:8787',
            port: 8787,
            status: 'ok',
          })
        )
      ) as typeof fetch;

      await renderWithStatus(<LocalServiceStatusBanner />);

      fireEvent.click(await screen.findByRole('button', { name: '启动' }));

      expect(
        screen.getByRole('button', { name: '启动中...' })
      ).toBeDisabled();
      expect(
        window.localStorage.getItem(LOCAL_SERVICE_ACCELERATION_STORAGE_KEY)
      ).toBe('http://127.0.0.1:8787');
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('shows checking feedback while re-detecting the local service', async () => {
    let resolveSecondProbe: ((value: Response) => void) | undefined;

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          base_url: 'http://127.0.0.1:8787',
          port: 8787,
          status: 'ok',
        })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveSecondProbe = resolve;
          })
      ) as typeof fetch;

    await renderWithStatus(<LocalServiceStatusBanner />);

    fireEvent.click(await screen.findByRole('button', { name: '检测' }));

    expect(
      await screen.findByRole('button', { name: '检测中...' })
    ).toBeDisabled();

    if (!resolveSecondProbe) {
      throw new Error('expected second probe to be pending');
    }

    resolveSecondProbe(
      jsonResponse({
        base_url: 'http://127.0.0.1:8787',
        port: 8787,
        status: 'ok',
      })
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '检测' })).toBeInTheDocument();
    });
  });

  it('shows a recovery popover when a persisted local override exists but the service is unavailable', async () => {
    window.localStorage.setItem(
      LOCAL_SERVICE_ACCELERATION_STORAGE_KEY,
      'http://127.0.0.1:8787'
    );
    global.fetch = jest.fn(() =>
      Promise.reject(new Error('offline'))
    ) as typeof fetch;

    await renderWithStatus(<LocalServiceStatusBanner />);

    expect(await screen.findByText('本机加速暂不可用')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '恢复默认' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检测' })).toBeInTheDocument();
  });

  it('stays hidden when the health endpoint is unavailable and no override is active', async () => {
    global.fetch = jest.fn(() =>
      Promise.reject(new Error('offline'))
    ) as typeof fetch;

    await renderWithStatus(<LocalServiceStatusBanner />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8787/health',
        expect.objectContaining({
          cache: 'no-store',
          mode: 'cors',
        })
      );
    });

    expect(screen.queryByText('本地服务已就绪')).not.toBeInTheDocument();
    expect(screen.queryByText('本机加速暂不可用')).not.toBeInTheDocument();
  });
});

describe('LocalServiceStatusSidebarPill', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    window.RUNTIME_CONFIG = {};
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders the ready pill in the sidebar when the local service is online', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        jsonResponse({
          base_url: 'http://127.0.0.1:8787',
          port: 8787,
          status: 'ok',
        })
      )
    ) as typeof fetch;

    await renderWithStatus(<LocalServiceStatusSidebarPill />);

    expect(await screen.findByText('检测到本地服务')).toBeInTheDocument();
    expect(screen.getByText('127.0.0.1:8787')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启动' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检测' })).toBeInTheDocument();
  });

  it('renders the active pill in the sidebar when local acceleration is enabled', async () => {
    window.RUNTIME_CONFIG = {
      MEDIA_PROXY_BASE_URL: 'http://127.0.0.1:8787',
    };
    window.localStorage.setItem(
      LOCAL_SERVICE_ACCELERATION_STORAGE_KEY,
      'http://127.0.0.1:8787'
    );
    global.fetch = jest.fn(() =>
      Promise.resolve(
        jsonResponse({
          base_url: 'http://127.0.0.1:8787',
          port: 8787,
          status: 'ok',
        })
      )
    ) as typeof fetch;

    await renderWithStatus(<LocalServiceStatusSidebarPill />);

    expect(await screen.findByText('本地服务启动')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停用' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '启动' })).not.toBeInTheDocument();
  });

  it('keeps the active pill while the initial health probe is still pending', async () => {
    window.RUNTIME_CONFIG = {
      MEDIA_PROXY_BASE_URL: 'http://127.0.0.1:8787',
    };
    window.localStorage.setItem(
      LOCAL_SERVICE_ACCELERATION_STORAGE_KEY,
      'http://127.0.0.1:8787'
    );
    global.fetch = jest.fn(
      () =>
        new Promise<Response>(() => {
          // Keep the initial probe unresolved to emulate a route transition.
        })
    ) as typeof fetch;

    await renderWithStatus(<LocalServiceStatusSidebarPill />);

    expect(await screen.findByText('本地服务启动')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停用' })).toBeInTheDocument();
    expect(
      screen.queryByText('本机加速暂不可用')
    ).not.toBeInTheDocument();
  });

  it('allows disabling local acceleration from the active pill', async () => {
    jest.useFakeTimers();

    try {
      window.RUNTIME_CONFIG = {
        MEDIA_PROXY_BASE_URL: 'http://127.0.0.1:8787',
      };
      window.localStorage.setItem(
        LOCAL_SERVICE_ACCELERATION_STORAGE_KEY,
        'http://127.0.0.1:8787'
      );
      global.fetch = jest.fn(() =>
        Promise.resolve(
          jsonResponse({
            base_url: 'http://127.0.0.1:8787',
            port: 8787,
            status: 'ok',
          })
        )
      ) as typeof fetch;

      await renderWithStatus(<LocalServiceStatusSidebarPill />);

      fireEvent.click(await screen.findByRole('button', { name: '停用' }));

      expect(
        screen.getByRole('button', { name: '停用中...' })
      ).toBeDisabled();
      expect(
        window.localStorage.getItem(LOCAL_SERVICE_ACCELERATION_STORAGE_KEY)
      ).toBeNull();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});
