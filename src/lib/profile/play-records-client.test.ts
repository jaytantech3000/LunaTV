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

function setDesktopAuthCookie(username = 'desktop-owner') {
  document.cookie = `auth=${encodeURIComponent(
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
    jest.clearAllMocks();
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
    expect(mockedFetchRemoteProfileJson).toHaveBeenCalledWith('/playrecords');

    await clearAllPlayRecords();

    expect(mockedDeleteRemoteProfileResource).toHaveBeenLastCalledWith(
      '/playrecords'
    );
    expect(getCachedPlayRecordsSnapshot()).toEqual({});
  });

  it('migrates legacy desktop local play records before reading from the API', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();

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
});
