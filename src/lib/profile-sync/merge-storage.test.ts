import { DbManager } from '@/lib/db';
import type { IStorage } from '@/lib/types';

import type {
  ProfileSyncCommitRequest,
  ProfileSyncCommitResult,
} from './merge-storage';

function createCommitRequest(): ProfileSyncCommitRequest {
  return {
    username: 'alice',
    expectedRevision: '9007199254740993',
    domains: ['favorites'],
    mergedSnapshot: {
      playRecords: {},
      favorites: {},
      follows: {},
      searchHistory: [],
      skipConfigs: {},
    },
  };
}

function createDbManager(storage: IStorage): DbManager {
  const manager = new DbManager();
  (manager as unknown as { storage: IStorage }).storage = storage;
  return manager;
}

describe('profile sync merge storage contract', () => {
  it('forwards revision reads and successful commits unchanged', async () => {
    const request = createCommitRequest();
    const result: ProfileSyncCommitResult = {
      revision: '9007199254740994',
    };
    const storage = {
      getProfileSyncRevision: jest
        .fn()
        .mockResolvedValue(request.expectedRevision),
      commitProfileSyncMerge: jest.fn().mockResolvedValue(result),
    } as unknown as IStorage;
    const manager = createDbManager(storage);

    await expect(
      manager.getProfileSyncRevision(request.username)
    ).resolves.toBe(request.expectedRevision);
    await expect(manager.commitProfileSyncMerge(request)).resolves.toBe(result);
    expect(storage.getProfileSyncRevision).toHaveBeenCalledWith(
      request.username
    );
    expect(storage.commitProfileSyncMerge).toHaveBeenCalledWith(request);
  });

  it('forwards a commit conflict as null', async () => {
    const request = createCommitRequest();
    const storage = {
      commitProfileSyncMerge: jest.fn().mockResolvedValue(null),
    } as unknown as IStorage;
    const manager = createDbManager(storage);

    await expect(manager.commitProfileSyncMerge(request)).resolves.toBeNull();
    expect(storage.commitProfileSyncMerge).toHaveBeenCalledWith(request);
  });
});
