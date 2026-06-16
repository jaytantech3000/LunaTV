'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { LOCAL_SERVICE_ACCELERATION_STORAGE_KEY } from '@/lib/local-service-runtime';

import { LocalServiceStatusBanner } from './LocalServiceStatusBanner';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

describe('LocalServiceStatusBanner', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    window.RUNTIME_CONFIG = {};
    window.localStorage.clear();
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

    render(<LocalServiceStatusBanner />);

    expect(await screen.findByText('本地服务已就绪')).toBeInTheDocument();
    expect(screen.getByText('127.0.0.1:8787')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '启用加速' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新检测' })).toBeInTheDocument();
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

      render(<LocalServiceStatusBanner />);

      fireEvent.click(await screen.findByRole('button', { name: '启用加速' }));

      expect(
        screen.getByRole('button', { name: '正在切换...' })
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

    render(<LocalServiceStatusBanner />);

    fireEvent.click(await screen.findByRole('button', { name: '重新检测' }));

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
      expect(
        screen.getByRole('button', { name: '重新检测' })
      ).toBeInTheDocument();
    });
  });

  it('collapses to a compact pill when local acceleration is already active', async () => {
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

    render(<LocalServiceStatusBanner />);

    expect(await screen.findByText('本机加速已启用')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '启用加速' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停用' })).toBeInTheDocument();
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

      render(<LocalServiceStatusBanner />);

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

  it('shows a recovery popover when a persisted local override exists but the service is unavailable', async () => {
    window.localStorage.setItem(
      LOCAL_SERVICE_ACCELERATION_STORAGE_KEY,
      'http://127.0.0.1:8787'
    );
    global.fetch = jest.fn(() =>
      Promise.reject(new Error('offline'))
    ) as typeof fetch;

    render(<LocalServiceStatusBanner />);

    expect(await screen.findByText('本机加速暂不可用')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '恢复默认' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新检测' })).toBeInTheDocument();
  });

  it('stays hidden when the health endpoint is unavailable and no override is active', async () => {
    global.fetch = jest.fn(() =>
      Promise.reject(new Error('offline'))
    ) as typeof fetch;

    render(<LocalServiceStatusBanner />);

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
