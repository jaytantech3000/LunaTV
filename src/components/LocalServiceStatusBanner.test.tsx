'use client';

import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

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
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders a persistent banner when the local service is online', async () => {
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

    expect(await screen.findByText('检测到本地服务在线')).toBeInTheDocument();
    expect(
      screen.getByText('http://127.0.0.1:8787 · 端口 8787')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '刷新启用加速' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '重新检测' })
    ).toBeInTheDocument();
  });

  it('collapses to a simpler status when local acceleration is already active', async () => {
    window.RUNTIME_CONFIG = {
      API_BASE_URL: 'http://127.0.0.1:8787',
    };
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
    expect(screen.getByText('当前页已走本机加速')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '刷新启用加速' })
    ).not.toBeInTheDocument();
  });

  it('stays hidden when the local service health endpoint is unavailable', async () => {
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

    expect(screen.queryByText('本地服务已连接')).not.toBeInTheDocument();
    expect(screen.queryByText('检测到本地服务在线')).not.toBeInTheDocument();
  });
});
