'use client';

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

const mockRouter = {
  back: jest.fn(),
  forward: jest.fn(),
  prefetch: jest.fn(),
  push: jest.fn(),
  refresh: jest.fn(),
  replace: jest.fn(),
};

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => mockRouter),
  useSearchParams: jest.fn(() => new URLSearchParams('redirect=%2Fdownloads')),
}));

jest.mock('@/components/SiteProvider', () => ({
  useSite: jest.fn(() => ({
    siteName: 'LunaTV',
  })),
}));

jest.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <div>ThemeToggle</div>,
}));

jest.mock('@/lib/version_check', () => ({
  UpdateStatus: {
    FETCH_FAILED: 'fetch_failed',
    HAS_UPDATE: 'has_update',
    NO_UPDATE: 'no_update',
  },
  checkForUpdates: jest.fn(() => new Promise((_resolve) => undefined)),
}));

import { LoginPageClient } from './LoginPageClient';

describe('LoginPageClient', () => {
  const originalFetch = global.fetch;
  let resolveLoginResponse: ((value: Response) => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/login') {
        return new Promise((resolve) => {
          resolveLoginResponse = resolve;
        });
      }

      return Promise.resolve(new Response('0.1.0', { status: 200 }));
    }) as typeof fetch;
    (
      window as Window & { RUNTIME_CONFIG?: Record<string, unknown> }
    ).RUNTIME_CONFIG = {
      STORAGE_TYPE: 'localstorage',
    };
  });

  afterEach(() => {
    document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    global.fetch = originalFetch;
  });

  it('shows transition feedback immediately after a successful login', async () => {
    render(<LoginPageClient />);

    expect(mockRouter.prefetch).toHaveBeenCalledWith('/downloads');

    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'demo-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('正在验证身份')).toBeInTheDocument();
    expect(screen.getByText('请稍候，正在完成登录校验...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '正在验证...' })).toBeDisabled();

    await act(async () => {
      document.cookie = `auth=${encodeURIComponent(
        JSON.stringify({ role: 'owner', username: 'owner' })
      )}; path=/`;
      resolveLoginResponse?.(new Response(null, { status: 200 }));
    });

    expect(await screen.findByText('登录成功')).toBeInTheDocument();
    expect(screen.getByText('正在进入内容页...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '正在进入...' })).toBeDisabled();

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/downloads');
    });
  });

  it('shows a domain-sync error when login succeeds but the auth cookie is missing', async () => {
    render(<LoginPageClient />);

    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'demo-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await act(async () => {
      resolveLoginResponse?.(new Response(null, { status: 200 }));
    });

    expect(
      await screen.findByText(
        '登录状态未写入当前域名，请刷新后重试',
        undefined,
        {
          timeout: 2000,
        }
      )
    ).toBeInTheDocument();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('surfaces server-side 401 messages instead of always showing a password error', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/login') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: '用户名或密码错误' }), {
            headers: {
              'Content-Type': 'application/json',
            },
            status: 401,
          })
        );
      }

      return Promise.resolve(new Response('0.1.0', { status: 200 }));
    }) as typeof fetch;
    (
      window as Window & { RUNTIME_CONFIG?: Record<string, unknown> }
    ).RUNTIME_CONFIG = {
      STORAGE_TYPE: 'redis',
    };

    render(<LoginPageClient />);

    fireEvent.change(screen.getByLabelText('用户名'), {
      target: { value: 'demo-user' },
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'bad-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('用户名或密码错误')).toBeInTheDocument();
  });
});
