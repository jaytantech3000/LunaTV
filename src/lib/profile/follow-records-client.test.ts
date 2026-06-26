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

import { DESKTOP_RUNTIME_UPDATED_EVENT } from '@/lib/desktop/runtime-config';
import {
  deleteFollowRecord,
  getAllFollowRecords,
  getCachedFollowRecordsSnapshot,
  getFollowRecord,
  saveFollowRecord,
} from '@/lib/profile/follow-records-client';
import {
  deleteRemoteProfileResource,
  fetchRemoteProfileJson,
  postRemoteProfilePayload,
} from '@/lib/profile/remote-adapter';
import {
  isDesktopLocalProfileRuntime,
  shouldUseProfileApiStorage,
} from '@/lib/profile/runtime';

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

function setDesktopBootstrapPayload(
  payload: Window['__DESKTOP_PROFILE_BOOTSTRAP__'] = {
    appTarget: 'desktop',
  } as Window['__DESKTOP_PROFILE_BOOTSTRAP__']
) {
  (
    window as Window & {
      __DESKTOP_PROFILE_BOOTSTRAP__?: Window['__DESKTOP_PROFILE_BOOTSTRAP__'];
    }
  ).__DESKTOP_PROFILE_BOOTSTRAP__ = payload;
}

function clearDesktopBootstrapPayload() {
  delete (
    window as Window & {
      __DESKTOP_PROFILE_BOOTSTRAP__?: Window['__DESKTOP_PROFILE_BOOTSTRAP__'];
    }
  ).__DESKTOP_PROFILE_BOOTSTRAP__;
}

function setDesktopAuthCookie(username = 'desktop-owner') {
  document.cookie = `auth=${encodeURIComponent(
    JSON.stringify({
      username,
      sessionMode: 'desktop-local',
    })
  )}; path=/`;
}

describe('follow records client', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    jest.clearAllMocks();
    clearDesktopBootstrapPayload();
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(false);
    mockedShouldUseProfileApiStorage.mockReturnValue(false);
    mockedFetchRemoteProfileJson.mockResolvedValue({});
    mockedPostRemoteProfilePayload.mockResolvedValue({ ok: true } as Response);
    mockedDeleteRemoteProfileResource.mockResolvedValue({
      ok: true,
    } as Response);
  });

  it('reads, writes, and deletes follow records in web local fallback mode', async () => {
    await saveFollowRecord('demo', '1', {
      title: 'Demo',
      source_name: 'Demo Source',
      year: '2026',
      cover: 'cover.jpg',
      followed_at: 1,
      followed_episode_count: 1,
      acknowledged_episode_count: 1,
      latest_episode_count: 2,
      last_checked_at: 3,
    });

    expect(getCachedFollowRecordsSnapshot()).toEqual({
      'demo+1': expect.objectContaining({
        title: 'Demo',
      }),
    });
    expect(await getFollowRecord('demo', '1')).toEqual(
      expect.objectContaining({
        title: 'Demo',
      })
    );
    expect(await getAllFollowRecords()).toEqual({
      'demo+1': expect.objectContaining({
        title: 'Demo',
      }),
    });

    await deleteFollowRecord('demo', '1');

    expect(getCachedFollowRecordsSnapshot()).toEqual({});
    expect(await getFollowRecord('demo', '1')).toBeNull();
    expect(await getAllFollowRecords()).toEqual({});
    expect(mockedPostRemoteProfilePayload).not.toHaveBeenCalled();
  });

  it('uses the local service API in desktop local mode', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();
    setDesktopBootstrapPayload();

    const remoteFollow = {
      title: 'Remote Follow',
      source_name: 'Demo Source',
      year: '2026',
      cover: 'cover.jpg',
      followed_at: 1,
      followed_episode_count: 1,
      acknowledged_episode_count: 1,
      latest_episode_count: 2,
      last_checked_at: 3,
    };
    mockedFetchRemoteProfileJson.mockResolvedValue({
      'demo+1': remoteFollow,
    });

    await saveFollowRecord('demo', '1', remoteFollow);

    expect(mockedPostRemoteProfilePayload).toHaveBeenCalledWith('/follows', {
      key: 'demo+1',
      follow: remoteFollow,
    });
    expect(getCachedFollowRecordsSnapshot()).toEqual({
      'demo+1': expect.objectContaining({
        title: 'Remote Follow',
      }),
    });
    await expect(getFollowRecord('demo', '1')).resolves.toEqual(
      expect.objectContaining({
        title: 'Remote Follow',
      })
    );
    expect(mockedFetchRemoteProfileJson).toHaveBeenCalledWith('/follows', {
      redirectOnUnauthorized: false,
    });

    await deleteFollowRecord('demo', '1');

    expect(mockedDeleteRemoteProfileResource).toHaveBeenLastCalledWith(
      '/follows',
      {
        key: 'demo+1',
      }
    );
    expect(getCachedFollowRecordsSnapshot()).toEqual({});
  });

  it('waits for desktop bootstrap readiness before reading follow records', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();

    const readPromise = getAllFollowRecords();

    await Promise.resolve();
    expect(mockedFetchRemoteProfileJson).not.toHaveBeenCalled();

    setDesktopBootstrapPayload();
    window.dispatchEvent(new Event(DESKTOP_RUNTIME_UPDATED_EVENT));

    await expect(readPromise).resolves.toEqual({});
    expect(mockedFetchRemoteProfileJson).toHaveBeenCalledWith('/follows', {
      redirectOnUnauthorized: false,
    });
  });

  it('skips follow record api reads while desktop local auth is still pending', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);

    await expect(getAllFollowRecords()).resolves.toEqual({});

    expect(mockedFetchRemoteProfileJson).not.toHaveBeenCalled();
  });
});
