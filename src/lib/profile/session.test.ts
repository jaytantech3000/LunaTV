import { act } from '@testing-library/react';

import { clearAuthInfoInBrowser } from '@/lib/auth';
import { purgeOfflineDownloads } from '@/lib/download/session';
import { isDesktopLocalProfileRuntime } from '@/lib/profile/runtime';
import {
  buildProfileLoginRedirectUrl,
  fetchProfileJson,
  fetchProfileResponse,
  isProfileRequestError,
  isUnauthorizedProfileRequestError,
  resolveProfileApiRequestUrl,
  wasProfileRequestRedirectedToLogin,
} from '@/lib/profile/session';

const originalWindowLocation = window.location;

jest.mock('@/lib/auth', () => ({
  clearAuthInfoInBrowser: jest.fn(),
}));

jest.mock('@/lib/transport/endpoint', () => ({
  buildApiUrl: jest.fn(
    (path: string) => `/api${path.startsWith('/') ? path : `/${path}`}`
  ),
}));

jest.mock('@/lib/download/session', () => ({
  purgeOfflineDownloads: jest.fn(),
}));

jest.mock('@/lib/profile/runtime', () => ({
  isDesktopLocalProfileRuntime: jest.fn(() => false),
}));

describe('profile session helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    (isDesktopLocalProfileRuntime as jest.Mock).mockReturnValue(false);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: 'http://localhost/follow-updates?filter=new',
        origin: 'http://localhost',
        pathname: '/follow-updates',
        search: '?filter=new',
      } as Location,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalWindowLocation,
    });
  });

  it('normalizes relative profile api urls', () => {
    expect(resolveProfileApiRequestUrl('/favorites')).toBe('/api/favorites');
    expect(resolveProfileApiRequestUrl('https://example.com/data')).toBe(
      'https://example.com/data'
    );
  });

  it('builds login redirect urls with the current path', () => {
    expect(
      buildProfileLoginRedirectUrl(
        '/follow-updates?filter=new',
        'http://localhost'
      )
    ).toBe('http://localhost/login?redirect=%2Ffollow-updates%3Ffilter%3Dnew');
  });

  it('fetches typed profile json with same-origin credentials by default', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        enabled: true,
      }),
    });

    await expect(
      fetchProfileJson<{ enabled: boolean }>('/profile-sync/status')
    ).resolves.toEqual({
      enabled: true,
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/profile-sync/status', {
      credentials: 'same-origin',
    });
  });

  it('retries transient desktop local fetch failures before succeeding', async () => {
    (isDesktopLocalProfileRuntime as jest.Mock).mockReturnValue(true);
    const setTimeoutSpy = jest.spyOn(window, 'setTimeout').mockImplementation(((
      callback: TimerHandler
    ) => {
      if (typeof callback === 'function') {
        callback();
      }
      return 0 as unknown as ReturnType<typeof window.setTimeout>;
    }) as unknown as typeof window.setTimeout);
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          enabled: true,
        }),
      });

    const fetchPromise = fetchProfileJson<{ enabled: boolean }>(
      '/profile-sync/status'
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await expect(fetchPromise).resolves.toEqual({
      enabled: true,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 300);

    setTimeoutSpy.mockRestore();
  });

  it('surfaces unauthorized errors without redirect when explicitly requested', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
    });

    const error = await fetchProfileResponse('/favorites', {
      redirectOnUnauthorized: false,
    }).catch((caughtError) => caughtError);

    expect(isProfileRequestError(error)).toBe(true);
    expect(isUnauthorizedProfileRequestError(error)).toBe(true);
    expect(wasProfileRequestRedirectedToLogin(error)).toBe(false);
    expect(clearAuthInfoInBrowser).not.toHaveBeenCalled();
  });

  it('clears browser auth and redirects to login after a 401 response', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

    const error = await fetchProfileResponse('/favorites').catch(
      (caughtError) => caughtError
    );

    expect(isProfileRequestError(error)).toBe(true);
    expect(isUnauthorizedProfileRequestError(error)).toBe(true);
    expect(wasProfileRequestRedirectedToLogin(error)).toBe(true);
    expect(clearAuthInfoInBrowser).toHaveBeenCalledTimes(1);
    expect(purgeOfflineDownloads).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/favorites', {
      credentials: 'same-origin',
    });
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    expect(window.location.href).toBe(
      'http://localhost/login?redirect=%2Ffollow-updates%3Ffilter%3Dnew'
    );
  });
});
