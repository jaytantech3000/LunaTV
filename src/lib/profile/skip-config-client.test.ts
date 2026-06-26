jest.mock('@/lib/profile/runtime', () => ({
  isDesktopLocalProfileRuntime: jest.fn(() => false),
  shouldUseProfileApiStorage: jest.fn(() => false),
}));

jest.mock('@/lib/profile/remote-adapter', () => ({
  deleteRemoteProfileResource: jest.fn(),
  fetchRemoteProfileJson: jest.fn(),
  isUnauthorizedRemoteProfileRequestError: jest.fn(() => false),
  postRemoteProfilePayload: jest.fn(),
  wasRemoteProfileRequestRedirectedToLogin: jest.fn(() => false),
}));

import {
  deleteRemoteProfileResource,
  fetchRemoteProfileJson,
  postRemoteProfilePayload,
} from '@/lib/profile/remote-adapter';
import { shouldUseProfileApiStorage } from '@/lib/profile/runtime';
import { isDesktopLocalProfileRuntime } from '@/lib/profile/runtime';
import {
  deleteSkipConfig,
  getAllSkipConfigs,
  getSkipConfig,
  saveSkipConfig,
} from '@/lib/profile/skip-config-client';

const mockedIsDesktopLocalProfileRuntime =
  isDesktopLocalProfileRuntime as jest.MockedFunction<
    typeof isDesktopLocalProfileRuntime
  >;
const mockedShouldUseProfileApiStorage =
  shouldUseProfileApiStorage as jest.MockedFunction<
    typeof shouldUseProfileApiStorage
  >;
const mockedDeleteRemoteProfileResource =
  deleteRemoteProfileResource as jest.MockedFunction<
    typeof deleteRemoteProfileResource
  >;
const mockedFetchRemoteProfileJson =
  fetchRemoteProfileJson as jest.MockedFunction<typeof fetchRemoteProfileJson>;
const mockedPostRemoteProfilePayload =
  postRemoteProfilePayload as jest.MockedFunction<
    typeof postRemoteProfilePayload
  >;

function setDesktopAuthCookie(username = 'desktop-owner') {
  document.cookie = `auth=${encodeURIComponent(
    JSON.stringify({
      username,
      sessionMode: 'desktop-local',
    })
  )}; path=/`;
}

describe('skip config client', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    jest.clearAllMocks();
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(false);
    mockedShouldUseProfileApiStorage.mockReturnValue(false);
    mockedFetchRemoteProfileJson.mockResolvedValue({});
    mockedPostRemoteProfilePayload.mockResolvedValue({ ok: true } as Response);
    mockedDeleteRemoteProfileResource.mockResolvedValue({
      ok: true,
    } as Response);
  });

  it('reads, writes, and deletes skip configs in web local fallback mode', async () => {
    await saveSkipConfig('demo', '1', {
      enable: true,
      intro_time: 12,
      outro_time: 34,
    });

    expect(await getSkipConfig('demo', '1')).toEqual({
      enable: true,
      intro_time: 12,
      outro_time: 34,
    });
    expect(await getAllSkipConfigs()).toEqual({
      'demo+1': {
        enable: true,
        intro_time: 12,
        outro_time: 34,
      },
    });

    await deleteSkipConfig('demo', '1');

    expect(await getSkipConfig('demo', '1')).toBeNull();
    expect(await getAllSkipConfigs()).toEqual({});
    expect(mockedPostRemoteProfilePayload).not.toHaveBeenCalled();
  });

  it('uses the local service API in desktop local mode', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();

    const remoteConfig = {
      enable: true,
      intro_time: 12,
      outro_time: 34,
    };
    mockedFetchRemoteProfileJson.mockResolvedValue({
      'demo+1': remoteConfig,
    });

    await saveSkipConfig('demo', '1', remoteConfig);

    expect(mockedPostRemoteProfilePayload).toHaveBeenCalledWith(
      '/skipconfigs',
      {
        key: 'demo+1',
        config: remoteConfig,
      }
    );
    await expect(getSkipConfig('demo', '1')).resolves.toEqual(remoteConfig);
    await expect(getAllSkipConfigs()).resolves.toEqual({
      'demo+1': remoteConfig,
    });
    expect(mockedFetchRemoteProfileJson).toHaveBeenCalledWith('/skipconfigs', {
      redirectOnUnauthorized: false,
    });

    await deleteSkipConfig('demo', '1');

    expect(mockedDeleteRemoteProfileResource).toHaveBeenLastCalledWith(
      '/skipconfigs',
      {
        key: 'demo+1',
      }
    );
  });

  it('skips skip-config api reads while desktop local auth is still pending', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);

    await expect(getSkipConfig('demo', '1')).resolves.toBeNull();
    await expect(getAllSkipConfigs()).resolves.toEqual({});

    expect(mockedFetchRemoteProfileJson).not.toHaveBeenCalled();
  });
});
