'use client';

import { useEffect } from 'react';

import { DESKTOP_RUNTIME_UPDATED_EVENT } from '@/lib/desktop/runtime-config';
import {
  areDesktopDownloadTaskCollectionsEquivalent,
  cacheDesktopDownloadEngineSnapshot,
  syncDesktopDownloadEngineState,
} from '@/lib/download/desktop-engine-sync';
import {
  clearDesktopDownloadStoreSnapshot,
  getDesktopDownloadEngineSnapshot,
  getDesktopDownloadStoreSnapshot,
  isDesktopLocalDownloadRuntimeEnabled,
  putDesktopDownloadStoreSnapshot,
  subscribeToDesktopDownloadEngineSnapshots,
} from '@/lib/download/desktop-runtime';
import { mergeLibraryItem } from '@/lib/download/library';
import { DownloadTask } from '@/lib/download/types';

import {
  buildPersistedDownloadStoreState,
  isPersistedDownloadStoreEmpty,
  PersistedDownloadStoreState,
  useDownloadStore,
} from '@/stores/downloadStore';

const SAVE_DEBOUNCE_MS = 200;

type DesktopDownloadRuntimeSnapshot = Awaited<
  ReturnType<typeof getDesktopDownloadEngineSnapshot>
>;

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
  if (localSnapshot.ownerUsername !== mergedSnapshot.ownerUsername) {
    return true;
  }

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

  if (
    mergedSnapshot.ownerUsername &&
    Object.values(localSnapshot.library).some(
      (item) => item.ownerUsername !== mergedSnapshot.ownerUsername
    )
  ) {
    return true;
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

function shouldUpsertRuntimeLibraryItem(
  task: DownloadTask,
  ownerUsername: string,
  previousItem = useDownloadStore.getState().library[task.contentId]
): boolean {
  const playbackManifestUrl = task.playbackManifestUrl?.trim();
  if (!playbackManifestUrl) {
    return false;
  }

  if (!previousItem) {
    return true;
  }

  const existingEpisode = previousItem.episodes.find(
    (episode) => episode.episodeIndex === task.episodeIndex
  );
  if (!existingEpisode) {
    return true;
  }

  return (
    previousItem.ownerUsername !== ownerUsername ||
    previousItem.source !== task.source ||
    previousItem.vodId !== task.vodId ||
    previousItem.sourceName !== task.sourceName ||
    previousItem.title !== task.title ||
    previousItem.searchTitle !== task.searchTitle ||
    previousItem.searchType !== task.searchType ||
    previousItem.poster !== task.poster ||
    previousItem.remarks !== task.remarks ||
    previousItem.year !== task.year ||
    previousItem.desc !== task.desc ||
    previousItem.typeName !== task.typeName ||
    previousItem.doubanId !== task.doubanId ||
    previousItem.episodeTitles[task.episodeIndex] !== task.episodeTitle ||
    existingEpisode.rootManifestUrl !== task.entryManifestUrl ||
    existingEpisode.playbackManifestUrl !== playbackManifestUrl ||
    existingEpisode.cacheIndexId !== task.cacheIndexId ||
    existingEpisode.resourceCount !== task.totalResources ||
    existingEpisode.sizeBytes !== task.sizeBytes
  );
}

function syncRuntimeCompletedTaskToLibrary(task: DownloadTask): void {
  if (task.status !== 'done') {
    return;
  }

  const ownerUsername = useDownloadStore.getState().ownerUsername;
  const playbackManifestUrl = task.playbackManifestUrl?.trim();
  if (!ownerUsername || !playbackManifestUrl) {
    return;
  }

  const previousItem = useDownloadStore.getState().library[task.contentId];
  if (!shouldUpsertRuntimeLibraryItem(task, ownerUsername, previousItem)) {
    return;
  }

  useDownloadStore
    .getState()
    .upsertLibraryItem(
      mergeLibraryItem(
        previousItem,
        task,
        ownerUsername,
        playbackManifestUrl,
        task.entryManifestUrl,
        task.totalResources,
        task.sizeBytes
      )
    );
}

function syncRuntimeCompletedTasksToLibrary(
  runtimeSnapshot: DesktopDownloadRuntimeSnapshot,
  options: {
    hydrateAllDoneTasks?: boolean;
  } = {}
): void {
  const candidateTasks = options.hydrateAllDoneTasks
    ? Object.values(runtimeSnapshot.tasks).filter(
        (task) => task.status === 'done'
      )
    : (() => {
        const runtimeEvent = runtimeSnapshot.lastEvent;
        if (!runtimeEvent) {
          return [];
        }

        if (
          runtimeEvent.type === 'taskUpserted' ||
          runtimeEvent.type === 'taskStatusChanged'
        ) {
          const task = runtimeSnapshot.tasks[runtimeEvent.taskId];
          if (task?.status === 'done') {
            return [task];
          }
        }

        return [];
      })();

  candidateTasks.forEach((task) => {
    syncRuntimeCompletedTaskToLibrary(task);
  });
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
    let unsubscribeRuntimeSnapshots: (() => void) | null = null;

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
    };

    const applyRuntimeSnapshot = (
      runtimeSnapshot: DesktopDownloadRuntimeSnapshot
    ) => {
      cacheDesktopDownloadEngineSnapshot(runtimeSnapshot);

      const currentState = useDownloadStore.getState();
      const shouldReplaceRuntimeState =
        currentState.maxConcurrentTasks ===
          runtimeSnapshot.maxConcurrentTasks &&
        areDesktopDownloadTaskCollectionsEquivalent(
          currentState.tasks,
          runtimeSnapshot.tasks
        );

      if (!shouldReplaceRuntimeState) {
        skipNextPersist = true;
        useDownloadStore.getState().replaceRuntimeState(runtimeSnapshot);
      }

      syncRuntimeCompletedTasksToLibrary(runtimeSnapshot);
    };

    const reloadDesktopSnapshot = async () => {
      const [remoteSnapshot, engineSnapshot] = await Promise.all([
        getDesktopDownloadStoreSnapshot<PersistedDownloadStoreState>().catch(
          () => null
        ),
        getDesktopDownloadEngineSnapshot().catch(() => null),
      ]);
      if (!active) {
        return;
      }

      if (engineSnapshot) {
        cacheDesktopDownloadEngineSnapshot(engineSnapshot);
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

      if (engineSnapshot) {
        syncRuntimeCompletedTasksToLibrary(engineSnapshot, {
          hydrateAllDoneTasks: true,
        });
      }

      const nextState = useDownloadStore.getState();
      await syncDesktopDownloadEngineState(
        {
          maxConcurrentTasks: nextState.maxConcurrentTasks,
          tasks: nextState.tasks,
        },
        engineSnapshot
      ).catch(() => undefined);
    };

    const handleRuntimeUpdated = () => {
      void reloadDesktopSnapshot();
    };

    window.addEventListener(
      DESKTOP_RUNTIME_UPDATED_EVENT,
      handleRuntimeUpdated
    );

    void (async () => {
      try {
        await reloadDesktopSnapshot();
      } finally {
        if (active) {
          initialized = true;

          try {
            unsubscribeRuntimeSnapshots =
              subscribeToDesktopDownloadEngineSnapshots({
                onSnapshot: (runtimeSnapshot) => {
                  if (!active) {
                    return;
                  }

                  applyRuntimeSnapshot(runtimeSnapshot);
                },
              });
          } catch (_) {
            unsubscribeRuntimeSnapshots = null;
          }
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
      unsubscribeRuntimeSnapshots?.();
      window.removeEventListener(
        DESKTOP_RUNTIME_UPDATED_EVENT,
        handleRuntimeUpdated
      );

      if (saveTimer) {
        clearTimeout(saveTimer);
      }
    };
  }, []);

  return null;
}
