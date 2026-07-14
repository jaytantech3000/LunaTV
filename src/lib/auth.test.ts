import {
  DESKTOP_AUTH_STORAGE_KEY,
  getAuthInfoFromBrowserCookie,
  setAuthInfoInBrowser,
} from '@/lib/auth';

describe('browser auth helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
    };
  });

  afterEach(() => {
    delete window.RUNTIME_CONFIG;
    localStorage.clear();
    document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('does not persist desktop profile sync passwords in browser storage or cookies', () => {
    setAuthInfoInBrowser({
      username: 'cloud-owner',
      role: 'owner',
      password: 'secret',
      sessionMode: 'desktop-profile-sync',
    });

    const storedPayload = JSON.parse(
      localStorage.getItem(DESKTOP_AUTH_STORAGE_KEY) || 'null'
    ) as {
      password?: string;
    } | null;
    const authCookie = document.cookie
      .split(';')
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith('auth='));
    const cookiePayload = JSON.parse(
      decodeURIComponent(authCookie?.slice('auth='.length) || 'null')
    ) as {
      password?: string;
    } | null;

    expect(storedPayload?.password).toBeUndefined();
    expect(cookiePayload?.password).toBeUndefined();
    expect(getAuthInfoFromBrowserCookie()).toEqual({
      username: 'cloud-owner',
      role: 'owner',
      sessionMode: 'desktop-profile-sync',
    });
  });
});
