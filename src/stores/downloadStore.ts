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
}

type PersistedDownloadStoreState = Pick<
  DownloadStoreState,
  'maxConcurrentTasks' | 'ownerUsername' | 'tasks' | 'library'
>;

const emptyPersistedState: PersistedDownloadStoreState = {
  maxConcurrentTasks: DEFAULT_CONCURRENT_DOWNLOAD_TASKS,
  ownerUsername: null,
  tasks: {},
  library: {},
};

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
    sizeBytes: typeof task.sizeBytes === 'number' ? task.sizeBytes : 0,
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
    }),
    {
      name: DOWNLOAD_STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedDownloadStoreState => ({
        maxConcurrentTasks: normalizeConcurrentDownloadTasks(
          state.maxConcurrentTasks
        ),
        ownerUsername: state.ownerUsername,
        tasks: normalizeTasks(state.tasks, {
          resetDownloadingStatus: true,
        }),
        library: normalizeLibrary(state.library),
      }),
      merge: (persistedState, currentState) => {
        const nextState =
          (persistedState as PersistedDownloadStoreState | undefined) ||
          emptyPersistedState;

        return {
          ...currentState,
          maxConcurrentTasks: normalizeConcurrentDownloadTasks(
            nextState.maxConcurrentTasks
          ),
          ownerUsername:
            typeof nextState.ownerUsername === 'string'
              ? nextState.ownerUsername
              : null,
          tasks: normalizeTasks(nextState.tasks, {
            resetDownloadingStatus: true,
          }),
          library: normalizeLibrary(nextState.library),
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
