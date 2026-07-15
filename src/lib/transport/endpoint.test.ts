import { apiFetch } from './api-client';
import { buildApiUrl, getApiBaseUrl } from './endpoint';
import { setDesktopAdminCapabilityForTests } from '../desktop/admin-capability';

describe('transport endpoint helpers', () => {
  const originalFetch = global.fetch;
  const originalApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalRuntimeConfig = window.RUNTIME_CONFIG;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    delete window.RUNTIME_CONFIG;
    jest.clearAllMocks();
    setDesktopAdminCapabilityForTests(null);
  });

  afterAll(() => {
    if (originalApiBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = originalApiBaseUrl;
    }

    if (originalRuntimeConfig === undefined) {
      delete window.RUNTIME_CONFIG;
    } else {
      window.RUNTIME_CONFIG = originalRuntimeConfig;
    }

    global.fetch = originalFetch;
  });

  it('builds same-origin api urls by default', () => {
    expect(getApiBaseUrl()).toBe('');
    expect(buildApiUrl('/playrecords')).toBe('/api/playrecords');
    expect(buildApiUrl('playrecords')).toBe('/api/playrecords');
    expect(buildApiUrl('/api/playrecords')).toBe('/api/playrecords');
    expect(
      buildApiUrl('/search', {
        wd: 'demo',
        page: 2,
        empty: '',
        disabled: undefined,
      })
    ).toBe('/api/search?wd=demo&page=2');
  });

  it('prefers runtime base url over env base url', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://env.example:7766/';
    window.RUNTIME_CONFIG = {
      API_BASE_URL: 'http://127.0.0.1:8787/',
    };

    expect(getApiBaseUrl()).toBe('http://127.0.0.1:8787');
    expect(buildApiUrl('/live/channels', { source: 'demo' })).toBe(
      'http://127.0.0.1:8787/api/live/channels?source=demo'
    );
  });

  it('apiFetch delegates to fetch with the normalized api url', async () => {
    window.RUNTIME_CONFIG = {
      API_BASE_URL: 'http://127.0.0.1:8787/',
    };

    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    global.fetch = fetchMock as typeof fetch;

    await apiFetch('/admin/site', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      searchParams: {
        scope: 'desktop',
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/api/admin/site?scope=desktop',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('adds the in-memory desktop admin capability to admin requests only', async () => {
    window.RUNTIME_CONFIG = {
      API_BASE_URL: 'http://127.0.0.1:8787/',
      APP_TARGET: 'desktop',
    };

    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    global.fetch = fetchMock as typeof fetch;

    setDesktopAdminCapabilityForTests('verified-capability');

    await apiFetch('/admin/site');
    await apiFetch('/live/channels');

    const adminHeaders = new Headers(fetchMock.mock.calls[0][1].headers);
    const publicHeaders = new Headers(fetchMock.mock.calls[1][1].headers);
    expect(adminHeaders.get('X-MoonTV-Admin-Capability')).toBe(
      'verified-capability'
    );
    expect(publicHeaders.get('X-MoonTV-Admin-Capability')).toBeNull();
  });
});
