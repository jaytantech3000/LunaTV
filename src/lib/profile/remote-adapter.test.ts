import {
  buildRemoteProfilePath,
  deleteRemoteProfileResource,
  fetchRemoteProfileJson,
  isUnauthorizedRemoteProfileRequestError,
  postRemoteProfilePayload,
  wasRemoteProfileRequestRedirectedToLogin,
} from '@/lib/profile/remote-adapter';
import { fetchProfileJson, fetchProfileResponse } from '@/lib/profile/session';

jest.mock('@/lib/profile/session', () => ({
  fetchProfileJson: jest.fn(),
  fetchProfileResponse: jest.fn(),
  isUnauthorizedProfileRequestError: jest.fn(
    (error: { status?: number }) => error?.status === 401
  ),
  wasProfileRequestRedirectedToLogin: jest.fn(
    (error: { redirectedToLogin?: boolean }) =>
      error?.redirectedToLogin === true
  ),
}));

describe('profile remote adapter helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds encoded remote profile paths with query params', () => {
    expect(
      buildRemoteProfilePath('/searchhistory', {
        keyword: 'demo value',
        page: 2,
      })
    ).toBe('/searchhistory?keyword=demo+value&page=2');
  });

  it('forwards JSON reads to the shared profile session layer', async () => {
    (fetchProfileJson as jest.Mock).mockResolvedValue({
      enabled: true,
    });

    await expect(
      fetchRemoteProfileJson<{ enabled: boolean }>('/profile-sync/status')
    ).resolves.toEqual({
      enabled: true,
    });
    expect(fetchProfileJson).toHaveBeenCalledWith(
      '/profile-sync/status',
      undefined
    );
  });

  it('posts JSON payloads through the shared profile session layer', async () => {
    (fetchProfileResponse as jest.Mock).mockResolvedValue({
      ok: true,
    });

    await postRemoteProfilePayload('/playrecords', {
      key: 'demo+1',
      record: {
        title: 'Demo',
      },
    });

    expect(fetchProfileResponse).toHaveBeenCalledWith('/playrecords', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key: 'demo+1',
        record: {
          title: 'Demo',
        },
      }),
    });
  });

  it('builds encoded delete requests through the shared profile session layer', async () => {
    (fetchProfileResponse as jest.Mock).mockResolvedValue({
      ok: true,
    });

    await deleteRemoteProfileResource('/favorites', {
      key: 'demo+1',
    });

    expect(fetchProfileResponse).toHaveBeenCalledWith(
      '/favorites?key=demo%2B1',
      {
        method: 'DELETE',
      }
    );
  });

  it('re-exports remote profile error classifiers', () => {
    expect(isUnauthorizedRemoteProfileRequestError({ status: 401 })).toBe(true);
    expect(
      wasRemoteProfileRequestRedirectedToLogin({ redirectedToLogin: true })
    ).toBe(true);
  });
});
