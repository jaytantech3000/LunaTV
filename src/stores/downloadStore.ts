'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  DEFAULT_CONCURRENT_DOWNLOAD_TASKS,
  DOWNLOAD_STORE_KEY,
  DownloadedContentMeta,
  DownloadTask,
  normalizeConcurrentDownloadTasks,
} from '@/lib/download/types';

interface DownloadStoreState {
  hasHydrated: boolean;
  maxConcurrentTasks: number;
  ownerUsername: string | null;
  tasks: Record<string, DownloadTask>;
  library: Record<string, DownloadedContentMeta>;
  setHasHydrated: (hasHydrated: boolean) => void;
  setMaxConcurrentTasks: (value: number) => void;
  setOwnerUsername: (ownerUsername: string | null) => void;
  upsertTask: (task: DownloadTask) => void;
  patchTask: (
    taskId: string,
    updater: (task: DownloadTask | undefined) => DownloadTask | undefined
  ) => void;
  removeTask: (taskId: string) => void;
  upsertLibraryItem: (item: DownloadedContentMeta) => void;
  removeLibraryItem: (contentId: string) => void;
  resetDownloads: () => void;
  replacePersistedState: (snapshot: PersistedDownloadStoreState) => void;
  replaceRuntimeState: (snapshot: RuntimeDownloadStoreState) => void;
}

export type PersistedDownloadStoreState = Pick<
  DownloadStoreState,
  'maxConcurrentTasks' | 'ownerUsername' | 'tasks' | 'library'
>;

export type RuntimeDownloadStoreState = Pick<
  DownloadStoreState,
  'maxConcurrentTasks' | 'tasks'
>;

const emptyPersistedState: PersistedDownloadStoreState = {
  maxConcurrentTasks: DEFAULT_CONCURRENT_DOWNLOAD_TASKS,
  ownerUsername: null,
  tasks: {},
  library: {},
};

export function normalizePersistedDownloadStoreState(
  snapshot?: Partial<PersistedDownloadStoreState> | null
): PersistedDownloadStoreState {
  return {
    maxConcurrentTasks: normalizeConcurrentDownloadTasks(
      snapshot?.maxConcurrentTasks
    ),
    ownerUsername:
      typeof snapshot?.ownerUsername === 'string'
        ? snapshot.ownerUsername
        : null,
    tasks: normalizeTasks(snapshot?.tasks, {
      resetDownloadingStatus: true,
    }),
    library: normalizeLibrary(snapshot?.library),
  };
}

export function isPersistedDownloadStoreEmpty(
  snapshot?: Partial<PersistedDownloadStoreState> | null
): boolean {
  const normalizedSnapshot = normalizePersistedDownloadStoreState(snapshot);
  return (
    !normalizedSnapshot.ownerUsername &&
    Object.keys(normalizedSnapshot.tasks).length === 0 &&
    Object.keys(normalizedSnapshot.library).length === 0
  );
}

export function buildPersistedDownloadStoreState(
  state: Pick<
    DownloadStoreState,
    'maxConcurrentTasks' | 'ownerUsername' | 'tasks' | 'library'
  >
): PersistedDownloadStoreState {
  return normalizePersistedDownloadStoreState(state);
}

function normalizeRuntimeDownloadStoreState(
  snapshot?: Partial<RuntimeDownloadStoreState> | null
): RuntimeDownloadStoreState {
  return {
    maxConcurrentTasks: normalizeConcurrentDownloadTasks(
      snapshot?.maxConcurrentTasks
    ),
    tasks: normalizeTasks(snapshot?.tasks),
  };
}

function normalizeTask(
  task: DownloadTask,
  options: {
    resetDownloadingStatus?: boolean;
  } = {}
): DownloadTask {
  const { resetDownloadingStatus = false } = options;
  const status =
    resetDownloadingStatus && task.status === 'downloading'
      ? 'paused'
      : task.status;
  const sizeBytes =
    typeof task.sizeBytes === 'number' && Number.isFinite(task.sizeBytes)
      ? Math.max(0, task.sizeBytes)
      : 0;
  const currentSizeBytesRaw =
    typeof task.currentSizeBytes === 'number' &&
    Number.isFinite(task.currentSizeBytes)
      ? Math.max(sizeBytes, task.currentSizeBytes)
      : sizeBytes;
  const currentSizeBytes =
    status === 'downloading' ? currentSizeBytesRaw : sizeBytes;
  const estimatedTotalSizeBytes =
    typeof task.estimatedTotalSizeBytes === 'number' &&
    Number.isFinite(task.estimatedTotalSizeBytes)
      ? Math.max(currentSizeBytes, task.estimatedTotalSizeBytes)
      : currentSizeBytes;
  const downloadSpeedBytesPerSecond =
    status === 'downloading' &&
    typeof task.downloadSpeedBytesPerSecond === 'number' &&
    Number.isFinite(task.downloadSpeedBytesPerSecond) &&
    task.downloadSpeedBytesPerSecond > 0
      ? task.downloadSpeedBytesPerSecond
      : 0;

  return {
    ...task,
    status,
    progress:
      typeof task.progress === 'number'
        ? Math.min(100, Math.max(0, task.progress))
        : 0,
    totalResources:
      typeof task.totalResources === 'number' ? task.totalResources : 0,
    downloadedResources:
      typeof task.downloadedResources === 'number'
        ? task.downloadedResources
        : 0,
    sizeBytes,
    currentSizeBytes,
    estimatedTotalSizeBytes,
    downloadSpeedBytesPerSecond,
    createdAt: typeof task.createdAt === 'number' ? task.createdAt : Date.now(),
    updatedAt: typeof task.updatedAt === 'number' ? task.updatedAt : Date.now(),
  };
}

function normalizeTasks(
  tasks?: Record<string, DownloadTask>,
  options?: {
    resetDownloadingStatus?: boolean;
  }
): Record<string, DownloadTask> {
  if (!tasks) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(tasks).map(([taskId, task]) => [
      taskId,
      normalizeTask(task, options),
    ])
  );
}

function normalizeLibrary(
  library?: Record<string, DownloadedContentMeta>
): Record<string, DownloadedContentMeta> {
  if (!library) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(library).map(([contentId, content]) => [
      contentId,
      {
        ...content,
        episodes: [...(content.episodes || [])].sort(
          (a, b) => a.episodeIndex - b.episodeIndex
        ),
        totalSizeBytes:
          typeof content.totalSizeBytes === 'number'
            ? content.totalSizeBytes
            : 0,
        updatedAt:
          typeof content.updatedAt === 'number'
            ? content.updatedAt
            : Date.now(),
      },
    ])
  );
}

export const useDownloadStore = create<DownloadStoreState>()(
  persist(
    (set) => ({
      hasHydrated: false,
      maxConcurrentTasks: DEFAULT_CONCURRENT_DOWNLOAD_TASKS,
      ownerUsername: null,
      tasks: {},
      library: {},
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setMaxConcurrentTasks: (value) =>
        set({
          maxConcurrentTasks: normalizeConcurrentDownloadTasks(value),
        }),
      setOwnerUsername: (ownerUsername) => set({ ownerUsername }),
      upsertTask: (task) =>
        set((state) => ({
          tasks: {
            ...state.tasks,
            [task.id]: normalizeTask(task),
          },
        })),
      patchTask: (taskId, updater) =>
        set((state) => {
          const nextTask = updater(state.tasks[taskId]);
          if (!nextTask) {
            const nextTasks = { ...state.tasks };
            delete nextTasks[taskId];
            return { tasks: nextTasks };
          }

          return {
            tasks: {
              ...state.tasks,
              [taskId]: normalizeTask(nextTask),
            },
          };
        }),
      removeTask: (taskId) =>
        set((state) => {
          const nextTasks = { ...state.tasks };
          delete nextTasks[taskId];
          return {
            tasks: nextTasks,
          };
        }),
      upsertLibraryItem: (item) =>
        set((state) => ({
          library: {
            ...state.library,
            [item.contentId]: {
              ...item,
              episodes: [...item.episodes].sort(
                (a, b) => a.episodeIndex - b.episodeIndex
              ),
              totalSizeBytes: item.totalSizeBytes || 0,
              updatedAt: item.updatedAt || Date.now(),
            },
          },
        })),
      removeLibraryItem: (contentId) =>
        set((state) => {
          const nextLibrary = { ...state.library };
          delete nextLibrary[contentId];
          return {
            library: nextLibrary,
          };
        }),
      resetDownloads: () =>
        set((state) => ({
          maxConcurrentTasks: state.maxConcurrentTasks,
          ownerUsername: null,
          tasks: {},
          library: {},
          hasHydrated: state.hasHydrated,
        })),
      replacePersistedState: (snapshot) =>
        set((state) => {
          const nextState = normalizePersistedDownloadStoreState(snapshot);
          return {
            maxConcurrentTasks: nextState.maxConcurrentTasks,
            ownerUsername: nextState.ownerUsername,
            tasks: nextState.tasks,
            library: nextState.library,
            hasHydrated: state.hasHydrated,
          };
        }),
      replaceRuntimeState: (snapshot) =>
        set(() => {
          const nextState = normalizeRuntimeDownloadStoreState(snapshot);
          return {
            maxConcurrentTasks: nextState.maxConcurrentTasks,
            tasks: nextState.tasks,
          };
        }),
    }),
    {
      name: DOWNLOAD_STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedDownloadStoreState =>
        buildPersistedDownloadStoreState(state),
      merge: (persistedState, currentState) => {
        const nextState = normalizePersistedDownloadStoreState(
          (persistedState as PersistedDownloadStoreState | undefined) ||
            emptyPersistedState
        );

        return {
          ...currentState,
          maxConcurrentTasks: nextState.maxConcurrentTasks,
          ownerUsername: nextState.ownerUsername,
          tasks: nextState.tasks,
          library: nextState.library,
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
