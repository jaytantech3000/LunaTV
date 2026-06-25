import {
  buildProfileLoginRedirectUrl,
  fetchProfileJson,
  fetchProfileResponse,
  isProfileRequestError,
  isUnauthorizedProfileRequestError,
  resolveProfileApiRequestUrl,
  wasProfileRequestRedirectedToLogin,
} from '@/lib/profile/session';

jest.mock('@/lib/transport/endpoint', () => ({
  buildApiUrl: jest.fn(
    (path: string) => `/api${path.startsWith('/') ? path : `/${path}`}`
  ),
}));

jest.mock('@/lib/download/session', () => ({
  purgeOfflineDownloads: jest.fn(),
}));

describe('profile session helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
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
  });
});
