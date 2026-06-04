import {
  DOWNLOAD_RESOURCE_DB_NAME,
  DOWNLOAD_RESOURCE_STORE_NAME,
  ResourceIndexRecord,
} from './types';

function assertIndexedDbAvailable(): void {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    throw new Error('当前环境不支持 IndexedDB');
  }
}

function openResourceIndexDb(): Promise<IDBDatabase> {
  assertIndexedDbAvailable();

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DOWNLOAD_RESOURCE_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOWNLOAD_RESOURCE_STORE_NAME)) {
        const store = db.createObjectStore(DOWNLOAD_RESOURCE_STORE_NAME, {
          keyPath: 'id',
        });
        store.createIndex('ownerUsername', 'ownerUsername', { unique: false });
        store.createIndex('taskId', 'taskId', { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error('打开 IndexedDB 失败'));
    };
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  callback: (
    store: IDBObjectStore,
    resolve: (value: T | PromiseLike<T>) => void,
    reject: (reason?: unknown) => void
  ) => void
): Promise<T> {
  return openResourceIndexDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(DOWNLOAD_RESOURCE_STORE_NAME, mode);
        const store = transaction.objectStore(DOWNLOAD_RESOURCE_STORE_NAME);

        transaction.oncomplete = () => {
          db.close();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error || new Error('IndexedDB 事务失败'));
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error || new Error('IndexedDB 事务已终止'));
        };

        callback(store, resolve, reject);
      })
  );
}

export async function putResourceIndex(
  record: ResourceIndexRecord
): Promise<void> {
  await withStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getResourceIndex(
  id: string
): Promise<ResourceIndexRecord | null> {
  return withStore<ResourceIndexRecord | null>('readonly', (store, resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => {
      resolve((request.result as ResourceIndexRecord | undefined) || null);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteResourceIndex(id: string): Promise<void> {
  await withStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function listResourceIndexes(): Promise<ResourceIndexRecord[]> {
  return withStore<ResourceIndexRecord[]>('readonly', (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      resolve((request.result as ResourceIndexRecord[] | undefined) || []);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function clearResourceIndexes(): Promise<void> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const deleteRequest = indexedDB.deleteDatabase(DOWNLOAD_RESOURCE_DB_NAME);
    deleteRequest.onsuccess = () => resolve();
    deleteRequest.onerror = () => reject(deleteRequest.error);
    deleteRequest.onblocked = () => resolve();
  });
}
