'use client';

import { useEffect } from 'react';

import {
  areDesktopDownloadTaskCollectionsEquivalent,
  syncDesktopDownloadEngineState,
} from '@/lib/download/desktop-engine-sync';
import {
  clearDesktopDownloadStoreSnapshot,
  getDesktopDownloadEngineSnapshot,
  getDesktopDownloadStoreSnapshot,
  isDesktopLocalDownloadRuntimeEnabled,
  putDesktopDownloadStoreSnapshot,
} from '@/lib/download/desktop-runtime';

import {
  buildPersistedDownloadStoreState,
  isPersistedDownloadStoreEmpty,
  PersistedDownloadStoreState,
  useDownloadStore,
} from '@/stores/downloadStore';

const SAVE_DEBOUNCE_MS = 200;

function hasRecordEntries<T>(record?: Record<string, T> | null): boolean {
  return Boolean(record && Object.keys(record).length > 0);
}

function buildMergedDesktopPersistedSnapshot(
  localSnapshot: PersistedDownloadStoreState,
  remoteSnapshot: PersistedDownloadStoreState | null,
  engineSnapshot: Awaited<
    ReturnType<typeof getDesktopDownloadEngineSnapshot>
  > | null
): PersistedDownloadStoreState {
  const remoteTasks = remoteSnapshot?.tasks;
  const remoteLibrary = remoteSnapshot?.library;
  const nextTasks =
    engineSnapshot?.tasks ??
    (hasRecordEntries(remoteTasks)
      ? remoteTasks ?? localSnapshot.tasks
      : localSnapshot.tasks);
  const nextLibrary = hasRecordEntries(remoteLibrary)
    ? remoteLibrary ?? localSnapshot.library
    : localSnapshot.library;

  return {
    maxConcurrentTasks:
      engineSnapshot?.maxConcurrentTasks ??
      remoteSnapshot?.maxConcurrentTasks ??
      localSnapshot.maxConcurrentTasks,
    ownerUsername: remoteSnapshot?.ownerUsername || localSnapshot.ownerUsername,
    tasks: nextTasks,
    library: nextLibrary,
  };
}

function shouldHydrateDesktopPersistedSnapshot(
  localSnapshot: PersistedDownloadStoreState,
  mergedSnapshot: PersistedDownloadStoreState,
  hasEngineSnapshot: boolean
): boolean {
  if (hasEngineSnapshot) {
    if (
      localSnapshot.maxConcurrentTasks !== mergedSnapshot.maxConcurrentTasks
    ) {
      return true;
    }

    if (
      !areDesktopDownloadTaskCollectionsEquivalent(
        localSnapshot.tasks,
        mergedSnapshot.tasks
      )
    ) {
      return true;
    }
  }

  if (!localSnapshot.ownerUsername && mergedSnapshot.ownerUsername) {
    return true;
  }

  if (
    !hasRecordEntries(localSnapshot.library) &&
    hasRecordEntries(mergedSnapshot.library)
  ) {
    return true;
  }

  return (
    isPersistedDownloadStoreEmpty(localSnapshot) &&
    !isPersistedDownloadStoreEmpty(mergedSnapshot)
  );
}

export default function DesktopDownloadStoreSync() {
  useEffect(() => {
    if (!isDesktopLocalDownloadRuntimeEnabled()) {
      return;
    }

    let active = true;
    let initialized = false;
    let skipNextPersist = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    const flushSnapshot = async () => {
      if (!active || !initialized) {
        return;
      }

      const state = useDownloadStore.getState();
      if (!state.hasHydrated) {
        return;
      }

      const snapshot = buildPersistedDownloadStoreState(state);
      try {
        if (isPersistedDownloadStoreEmpty(snapshot)) {
          await clearDesktopDownloadStoreSnapshot();
        } else {
          await putDesktopDownloadStoreSnapshot(snapshot);
        }
      } catch (_) {
        // Ignore sidecar snapshot write failures and keep local state intact.
      }

      try {
        await syncDesktopDownloadEngineState({
          maxConcurrentTasks: state.maxConcurrentTasks,
          tasks: state.tasks,
        });
      } catch (_) {
        // Ignore download engine mirror failures and keep local state intact.
      }
    };

    void (async () => {
      try {
        const [remoteSnapshot, engineSnapshot] = await Promise.all([
          getDesktopDownloadStoreSnapshot<PersistedDownloadStoreState>().catch(
            () => null
          ),
          getDesktopDownloadEngineSnapshot().catch(() => null),
        ]);
        if (!active) {
          return;
        }

        const localSnapshot = buildPersistedDownloadStoreState(
          useDownloadStore.getState()
        );
        const mergedSnapshot = buildMergedDesktopPersistedSnapshot(
          localSnapshot,
          remoteSnapshot,
          engineSnapshot
        );

        if (
          shouldHydrateDesktopPersistedSnapshot(
            localSnapshot,
            mergedSnapshot,
            Boolean(engineSnapshot)
          )
        ) {
          skipNextPersist = true;
          useDownloadStore.getState().replacePersistedState(mergedSnapshot);
        } else if (
          (!remoteSnapshot || isPersistedDownloadStoreEmpty(remoteSnapshot)) &&
          !isPersistedDownloadStoreEmpty(localSnapshot)
        ) {
          await putDesktopDownloadStoreSnapshot(localSnapshot).catch(
            () => undefined
          );
        }

        const nextState = useDownloadStore.getState();
        await syncDesktopDownloadEngineState({
          maxConcurrentTasks: nextState.maxConcurrentTasks,
          tasks: nextState.tasks,
        }).catch(() => undefined);
      } finally {
        if (active) {
          initialized = true;
        }
      }
    })();

    const unsubscribe = useDownloadStore.subscribe((state) => {
      if (!initialized || !state.hasHydrated) {
        return;
      }

      if (skipNextPersist) {
        skipNextPersist = false;
        return;
      }

      if (saveTimer) {
        clearTimeout(saveTimer);
      }

      saveTimer = setTimeout(() => {
        void flushSnapshot();
      }, SAVE_DEBOUNCE_MS);
    });

    return () => {
      active = false;
      unsubscribe();

      if (saveTimer) {
        clearTimeout(saveTimer);
      }
    };
  }, []);

  return null;
}
