import { clearDownloadCache } from './cache';
import { downloadClient } from './client';
import { clearDesktopDownloadEngineSnapshotCache } from './desktop-engine-sync';
import {
  clearDesktopDownloadEngineTasks,
  clearDesktopDownloadStoreSnapshot,
} from './desktop-runtime';
import { clearResourceIndexes } from './resource-index';
import {
  armDesktopDownloadOwnershipHandoff,
  purgeOfflineDownloads,
  syncDownloadOwner,
} from './session';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromBrowserCookie: jest.fn(),
}));

jest.mock('@/stores/downloadStore', () => ({
  useDownloadStore: {
    getState: jest.fn(),
    persist: {
      clearStorage: jest.fn(),
    },
  },
}));

jest.mock('./cache', () => ({
  clearDownloadCache: jest.fn(),
}));

jest.mock('./desktop-engine-sync', () => ({
  clearDesktopDownloadEngineSnapshotCache: jest.fn(),
}));

jest.mock('./desktop-runtime', () => ({
  clearDesktopDownloadEngineTasks: jest.fn(),
  clearDesktopDownloadStoreSnapshot: jest.fn(),
}));

jest.mock('./client', () => ({
  downloadClient: {
    abortAll: jest.fn(),
  },
}));

jest.mock('./resource-index', () => ({
  clearResourceIndexes: jest.fn(),
}));

describe('download session helpers', () => {
  const mockStoreState = {
    ownerUsername: null as string | null,
    resetDownloads: jest.fn(),
    setOwnerUsername: jest.fn((ownerUsername: string | null) => {
      mockStoreState.ownerUsername = ownerUsername;
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    mockStoreState.ownerUsername = null;

    const storeModule = jest.requireMock('@/stores/downloadStore') as {
      useDownloadStore: {
        getState: jest.Mock;
        persist: {
          clearStorage: jest.Mock;
        };
      };
    };

    storeModule.useDownloadStore.getState.mockReturnValue(mockStoreState);
    storeModule.useDownloadStore.persist.clearStorage.mockResolvedValue(
      undefined
    );

    (clearDownloadCache as jest.Mock).mockResolvedValue(undefined);
    (clearResourceIndexes as jest.Mock).mockResolvedValue(undefined);
    (clearDesktopDownloadEngineTasks as jest.Mock).mockResolvedValue(undefined);
    (clearDesktopDownloadStoreSnapshot as jest.Mock).mockResolvedValue(
      undefined
    );
  });

  it('purges cached download data and clears runtime task snapshots', async () => {
    const storeModule = jest.requireMock('@/stores/downloadStore') as {
      useDownloadStore: {
        persist: {
          clearStorage: jest.Mock;
        };
      };
    };

    await purgeOfflineDownloads();

    expect(downloadClient.abortAll).toHaveBeenCalledTimes(1);
    expect(clearDownloadCache).toHaveBeenCalledTimes(1);
    expect(clearResourceIndexes).toHaveBeenCalledTimes(1);
    expect(clearDesktopDownloadEngineTasks).toHaveBeenCalledTimes(1);
    expect(clearDesktopDownloadStoreSnapshot).toHaveBeenCalledTimes(1);
    expect(clearDesktopDownloadEngineSnapshotCache).toHaveBeenCalledTimes(1);
    expect(mockStoreState.resetDownloads).toHaveBeenCalledTimes(1);
    expect(
      storeModule.useDownloadStore.persist.clearStorage
    ).toHaveBeenCalledTimes(1);
  });

  it('still resets local state when runtime cleanup requests fail', async () => {
    const storeModule = jest.requireMock('@/stores/downloadStore') as {
      useDownloadStore: {
        persist: {
          clearStorage: jest.Mock;
        };
      };
    };

    (clearDesktopDownloadEngineTasks as jest.Mock).mockRejectedValue(
      new Error('clear runtime tasks failed')
    );
    (clearDesktopDownloadStoreSnapshot as jest.Mock).mockRejectedValue(
      new Error('clear store snapshot failed')
    );

    await expect(purgeOfflineDownloads()).resolves.toBeUndefined();

    expect(clearDesktopDownloadEngineSnapshotCache).toHaveBeenCalledTimes(1);
    expect(mockStoreState.resetDownloads).toHaveBeenCalledTimes(1);
    expect(
      storeModule.useDownloadStore.persist.clearStorage
    ).toHaveBeenCalledTimes(1);
  });

  it('rebinds ownership instead of purging downloads when a matching desktop handoff is armed', async () => {
    const authModule = jest.requireMock('@/lib/auth') as {
      getAuthInfoFromBrowserCookie: jest.Mock;
    };

    mockStoreState.ownerUsername = 'local-owner';
    authModule.getAuthInfoFromBrowserCookie.mockReturnValue({
      username: 'remote-owner',
    });

    armDesktopDownloadOwnershipHandoff({
      previousOwnerUsername: 'local-owner',
      nextOwnerUsername: 'remote-owner',
    });

    await syncDownloadOwner();

    expect(clearDownloadCache).not.toHaveBeenCalled();
    expect(clearResourceIndexes).not.toHaveBeenCalled();
    expect(clearDesktopDownloadEngineTasks).not.toHaveBeenCalled();
    expect(clearDesktopDownloadStoreSnapshot).not.toHaveBeenCalled();
    expect(mockStoreState.resetDownloads).not.toHaveBeenCalled();
    expect(mockStoreState.setOwnerUsername).toHaveBeenCalledWith(
      'remote-owner'
    );
  });
});
