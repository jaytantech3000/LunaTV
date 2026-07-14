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
  clearAllPlayRecords,
  deletePlayRecord,
  getAllPlayRecords,
  getCachedPlayRecordsSnapshot,
  savePlayRecord,
} from '@/lib/profile/play-records-client';
import {
  deleteRemoteProfileResource,
  fetchRemoteProfileJson,
  postRemoteProfilePayload,
} from '@/lib/profile/remote-adapter';
import { shouldUseProfileApiStorage } from '@/lib/profile/runtime';
import { isDesktopLocalProfileRuntime } from '@/lib/profile/runtime';

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
  document.cookie = `auth-info=${encodeURIComponent(
    JSON.stringify({
      username,
      sessionMode: 'desktop-local',
    })
  )}; path=/`;
}

describe('play records client', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    document.cookie =
      'auth-info=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
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

  it('reads, writes, and clears play records in web local fallback mode', async () => {
    await savePlayRecord('demo', '1', {
      title: 'Demo',
      source_name: 'Demo Source',
      year: '2026',
      cover: 'cover.jpg',
      index: 1,
      total_episodes: 12,
      play_time: 30,
      total_time: 60,
      save_time: 1,
    });

    expect(getCachedPlayRecordsSnapshot()).toEqual({
      'demo+1': expect.objectContaining({
        title: 'Demo',
      }),
    });
    expect(await getAllPlayRecords()).toEqual({
      'demo+1': expect.objectContaining({
        title: 'Demo',
      }),
    });

    await deletePlayRecord('demo', '1');

    expect(await getAllPlayRecords()).toEqual({});

    await savePlayRecord('demo', '1', {
      title: 'Demo',
      source_name: 'Demo Source',
      year: '2026',
      cover: 'cover.jpg',
      index: 2,
      total_episodes: 12,
      play_time: 40,
      total_time: 60,
      save_time: 2,
    });

    await clearAllPlayRecords();

    expect(getCachedPlayRecordsSnapshot()).toEqual({});
    expect(await getAllPlayRecords()).toEqual({});
    expect(mockedPostRemoteProfilePayload).not.toHaveBeenCalled();
  });

  it('uses the local service API in desktop local mode', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();
    setDesktopBootstrapPayload();

    const remoteRecord = {
      title: 'Remote Demo',
      source_name: 'Demo Source',
      year: '2026',
      cover: 'cover.jpg',
      index: 1,
      total_episodes: 12,
      play_time: 30,
      total_time: 60,
      save_time: 1,
    };
    mockedFetchRemoteProfileJson.mockResolvedValue({
      'demo+1': remoteRecord,
    });

    await savePlayRecord('demo', '1', remoteRecord);

    expect(mockedPostRemoteProfilePayload).toHaveBeenCalledWith(
      '/playrecords',
      {
        key: 'demo+1',
        record: remoteRecord,
      }
    );
    expect(getCachedPlayRecordsSnapshot()).toEqual({
      'demo+1': expect.objectContaining({
        title: 'Remote Demo',
      }),
    });
    await expect(getAllPlayRecords()).resolves.toEqual({
      'demo+1': expect.objectContaining({
        title: 'Remote Demo',
      }),
    });
    expect(mockedFetchRemoteProfileJson).not.toHaveBeenCalled();

    await clearAllPlayRecords();

    expect(mockedDeleteRemoteProfileResource).toHaveBeenLastCalledWith(
      '/playrecords'
    );
    expect(getCachedPlayRecordsSnapshot()).toEqual({});
  });

  it('waits for desktop bootstrap readiness before reading play records', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();

    const readPromise = getAllPlayRecords();

    await Promise.resolve();
    expect(mockedFetchRemoteProfileJson).not.toHaveBeenCalled();

    setDesktopBootstrapPayload();
    window.dispatchEvent(new Event(DESKTOP_RUNTIME_UPDATED_EVENT));

    await expect(readPromise).resolves.toEqual({});
    expect(mockedFetchRemoteProfileJson).toHaveBeenCalledWith('/playrecords', {
      redirectOnUnauthorized: false,
    });
  });

  it('skips play record api reads while desktop local auth is still pending', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);

    await expect(getAllPlayRecords()).resolves.toEqual({});

    expect(mockedFetchRemoteProfileJson).not.toHaveBeenCalled();
  });

  it('skips play record api reads while profile auth is still pending in remote mode', async () => {
    mockedShouldUseProfileApiStorage.mockReturnValue(true);

    await expect(getAllPlayRecords()).resolves.toEqual({});

    expect(mockedFetchRemoteProfileJson).not.toHaveBeenCalled();
  });

  it('migrates legacy desktop local play records before reading from the API', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();
    setDesktopBootstrapPayload();

    const legacyRecord = {
      title: 'Legacy Demo',
      source_name: 'Demo Source',
      year: '2026',
      cover: 'cover.jpg',
      index: 3,
      total_episodes: 24,
      play_time: 90,
      total_time: 180,
      save_time: 10,
    };
    localStorage.setItem(
      'moontv_play_records',
      JSON.stringify({
        'demo+1': legacyRecord,
      })
    );

    let playRecordsFetchCount = 0;
    mockedFetchRemoteProfileJson.mockImplementation(async (path) => {
      if (path === '/playrecords') {
        playRecordsFetchCount += 1;
        return playRecordsFetchCount === 1
          ? {}
          : {
              'demo+1': legacyRecord,
            };
      }

      return {};
    });

    await expect(getAllPlayRecords()).resolves.toEqual({
      'demo+1': expect.objectContaining({
        title: 'Legacy Demo',
      }),
    });

    expect(mockedPostRemoteProfilePayload).toHaveBeenCalledWith(
      '/playrecords',
      {
        key: 'demo+1',
        record: legacyRecord,
      },
      {
        redirectOnUnauthorized: false,
      }
    );
    expect(localStorage.getItem('moontv_play_records')).toBeNull();
  });

  it('shares an in-flight cold play-record read', async () => {
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie('remote-owner');

    let resolveFetch: ((records: Record<string, unknown>) => void) | undefined;
    mockedFetchRemoteProfileJson.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const firstRead = getAllPlayRecords();
    const secondRead = getAllPlayRecords();

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(mockedFetchRemoteProfileJson).toHaveBeenCalledTimes(1);

    resolveFetch?.({});

    await expect(Promise.all([firstRead, secondRead])).resolves.toEqual([
      {},
      {},
    ]);
  });

  it('does not let an older play-record read overwrite a mutation snapshot', async () => {
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie('remote-owner');

    const record = {
      title: 'Newer Demo',
      source_name: 'Demo Source',
      year: '2026',
      cover: 'cover.jpg',
      index: 1,
      total_episodes: 12,
      play_time: 30,
      total_time: 60,
      save_time: 2,
    };
    let resolveFetch: ((records: Record<string, unknown>) => void) | undefined;
    mockedFetchRemoteProfileJson.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const readPromise = getAllPlayRecords();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await savePlayRecord('demo', '1', record);

    resolveFetch?.({});
    await expect(readPromise).resolves.toEqual({});
    expect(getCachedPlayRecordsSnapshot()).toEqual({
      'demo+1': expect.objectContaining({ title: 'Newer Demo' }),
    });
  });
});
