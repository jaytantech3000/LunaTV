'use client';

import { useEffect } from 'react';

import { syncDesktopDownloadEngineState } from '@/lib/download/desktop-engine-sync';
import {
  clearDesktopDownloadStoreSnapshot,
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
        const remoteSnapshot =
          await getDesktopDownloadStoreSnapshot<PersistedDownloadStoreState>();
        if (!active) {
          return;
        }

        const localSnapshot = buildPersistedDownloadStoreState(
          useDownloadStore.getState()
        );

        if (
          remoteSnapshot &&
          isPersistedDownloadStoreEmpty(localSnapshot) &&
          !isPersistedDownloadStoreEmpty(remoteSnapshot)
        ) {
          skipNextPersist = true;
          useDownloadStore.getState().replacePersistedState(remoteSnapshot);
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
