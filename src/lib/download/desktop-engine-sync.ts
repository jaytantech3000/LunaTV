import {
  type DesktopDownloadEngineBulkCommand,
  cancelDesktopDownloadTask,
  deleteDesktopDownloadTask,
  DESKTOP_DOWNLOAD_RUNTIME_ERROR_TASK_NOT_FOUND,
  DesktopDownloadEngineSnapshot,
  getDesktopDownloadEngineSnapshot,
  pauseDesktopDownloadTask,
  postDesktopDownloadTask,
  postDesktopDownloadTaskBulkCommand,
  putDesktopDownloadEngineSettings,
  resumeDesktopDownloadTask,
  retryDesktopDownloadTask,
} from './desktop-runtime';
import { isDownloadDomainErrorCode } from './request';
import { DownloadTask } from './types';

export interface DesktopDownloadEngineSyncState {
  maxConcurrentTasks: number;
  tasks: Record<string, DownloadTask>;
}

export interface DesktopDownloadEngineSyncOptions {
  removeMissingTasks?: boolean;
}

function shouldPreserveLiveDesktopDownloadTask(
  existing?: DownloadTask,
  incoming?: DownloadTask
): boolean {
  if (!existing || !incoming) {
    return false;
  }

  if (existing.status === 'downloading') {
    if (incoming.status === 'downloading' || incoming.status === 'done') {
      return incoming.updatedAt < existing.updatedAt;
    }

    return true;
  }

  return existing.status === 'queued' && incoming.status === 'paused';
}

let desktopDownloadEngineSnapshotCache: DesktopDownloadEngineSnapshot | null =
  null;

function buildTaskFingerprint(task: DownloadTask): string {
  return JSON.stringify([
    task.id,
    task.contentId,
    task.source,
    task.sourceName,
    task.vodId,
    task.episodeIndex,
    task.title,
    task.searchTitle || null,
    task.searchType || null,
    task.poster,
    task.remarks || null,
    task.year,
    task.desc || null,
    task.typeName || null,
    task.doubanId || null,
    task.episodeTitle,
    task.originalM3u8Url,
    task.entryManifestUrl,
    task.manifestCandidateUrls || [],
    task.playbackManifestUrl || null,
    task.cacheIndexId,
    task.status,
    task.progress,
    task.totalResources,
    task.downloadedResources,
    task.sizeBytes,
    task.currentSizeBytes,
    task.estimatedTotalSizeBytes,
    task.downloadSpeedBytesPerSecond,
    task.createdAt,
    task.updatedAt,
    task.errorMessage || null,
  ]);
}

export function areDesktopDownloadTasksEquivalent(
  left?: DownloadTask,
  right?: DownloadTask
): boolean {
  if (!left || !right) {
    return false;
  }

  return buildTaskFingerprint(left) === buildTaskFingerprint(right);
}

export function areDesktopDownloadTaskCollectionsEquivalent(
  left: Record<string, DownloadTask>,
  right: Record<string, DownloadTask>
): boolean {
  const leftTaskIds = Object.keys(left);
  const rightTaskIds = Object.keys(right);

  if (leftTaskIds.length !== rightTaskIds.length) {
    return false;
  }

  return leftTaskIds.every((taskId) =>
    areDesktopDownloadTasksEquivalent(left[taskId], right[taskId])
  );
}

function rememberDesktopDownloadEngineSnapshot(
  snapshot: DesktopDownloadEngineSnapshot
): DesktopDownloadEngineSnapshot {
  desktopDownloadEngineSnapshotCache = snapshot;
  return snapshot;
}

export function cacheDesktopDownloadEngineSnapshot(
  snapshot: DesktopDownloadEngineSnapshot
): DesktopDownloadEngineSnapshot {
  return rememberDesktopDownloadEngineSnapshot(snapshot);
}

async function mutateDesktopDownloadEngineSnapshot(
  mutation: () => Promise<DesktopDownloadEngineSnapshot>
): Promise<DesktopDownloadEngineSnapshot> {
  return rememberDesktopDownloadEngineSnapshot(await mutation());
}

async function resolveDesktopDownloadEngineSnapshot(
  previousSnapshot?: DesktopDownloadEngineSnapshot | null
): Promise<DesktopDownloadEngineSnapshot> {
  if (previousSnapshot) {
    return rememberDesktopDownloadEngineSnapshot(previousSnapshot);
  }

  if (desktopDownloadEngineSnapshotCache) {
    return desktopDownloadEngineSnapshotCache;
  }

  return rememberDesktopDownloadEngineSnapshot(
    await getDesktopDownloadEngineSnapshot()
  );
}

export function clearDesktopDownloadEngineSnapshotCache(): void {
  desktopDownloadEngineSnapshotCache = null;
}

function dropTaskFromDesktopDownloadEngineSnapshotCache(
  taskId: string
): DesktopDownloadEngineSnapshot | null {
  if (!desktopDownloadEngineSnapshotCache?.tasks[taskId]) {
    return null;
  }

  const nextTasks = {
    ...desktopDownloadEngineSnapshotCache.tasks,
  };
  delete nextTasks[taskId];
  return rememberDesktopDownloadEngineSnapshot({
    ...desktopDownloadEngineSnapshotCache,
    tasks: nextTasks,
  });
}

export async function syncDesktopDownloadEngineSettings(
  maxConcurrentTasks: number
): Promise<DesktopDownloadEngineSnapshot> {
  return mutateDesktopDownloadEngineSnapshot(() =>
    putDesktopDownloadEngineSettings({
      maxConcurrentTasks,
    })
  );
}

export async function upsertDesktopDownloadEngineTask(
  task: DownloadTask
): Promise<DesktopDownloadEngineSnapshot> {
  return mutateDesktopDownloadEngineSnapshot(() =>
    postDesktopDownloadTask(task)
  );
}

export async function pauseDesktopDownloadEngineTask(
  taskId: string
): Promise<DesktopDownloadEngineSnapshot> {
  return mutateDesktopDownloadEngineSnapshot(() =>
    pauseDesktopDownloadTask(taskId)
  );
}

export async function resumeDesktopDownloadEngineTask(
  taskId: string
): Promise<DesktopDownloadEngineSnapshot> {
  return mutateDesktopDownloadEngineSnapshot(() =>
    resumeDesktopDownloadTask(taskId)
  );
}

export async function retryDesktopDownloadEngineTask(
  taskId: string
): Promise<DesktopDownloadEngineSnapshot> {
  return mutateDesktopDownloadEngineSnapshot(() =>
    retryDesktopDownloadTask(taskId)
  );
}

export async function cancelDesktopDownloadEngineTask(
  taskId: string
): Promise<DesktopDownloadEngineSnapshot> {
  return mutateDesktopDownloadEngineSnapshot(() =>
    cancelDesktopDownloadTask(taskId)
  );
}

export async function deleteMirroredDesktopDownloadTask(
  taskId: string
): Promise<DesktopDownloadEngineSnapshot> {
  try {
    return await mutateDesktopDownloadEngineSnapshot(() =>
      deleteDesktopDownloadTask(taskId)
    );
  } catch (error) {
    if (
      isDownloadDomainErrorCode(
        error,
        DESKTOP_DOWNLOAD_RUNTIME_ERROR_TASK_NOT_FOUND
      )
    ) {
      const cachedSnapshot =
        dropTaskFromDesktopDownloadEngineSnapshotCache(taskId);
      if (cachedSnapshot) {
        return cachedSnapshot;
      }
    }

    throw error;
  }
}

export async function postDesktopDownloadEngineTaskBulkCommand(
  command: DesktopDownloadEngineBulkCommand,
  taskIds: string[]
): Promise<DesktopDownloadEngineSnapshot> {
  return mutateDesktopDownloadEngineSnapshot(() =>
    postDesktopDownloadTaskBulkCommand(command, taskIds)
  );
}

export async function syncDesktopDownloadEngineState(
  nextState: DesktopDownloadEngineSyncState,
  previousSnapshot?: DesktopDownloadEngineSnapshot | null,
  options: DesktopDownloadEngineSyncOptions = {}
): Promise<DesktopDownloadEngineSnapshot> {
  const trustedEngineSnapshot = previousSnapshot ?? null;
  let snapshot = await resolveDesktopDownloadEngineSnapshot(previousSnapshot);

  if (snapshot.maxConcurrentTasks !== nextState.maxConcurrentTasks) {
    snapshot = await syncDesktopDownloadEngineSettings(
      nextState.maxConcurrentTasks
    );
  }

  for (const task of Object.values(nextState.tasks)) {
    const existingTask = snapshot.tasks[task.id];
    if (areDesktopDownloadTasksEquivalent(task, existingTask)) {
      continue;
    }

    if (shouldPreserveLiveDesktopDownloadTask(existingTask, task)) {
      continue;
    }

    snapshot = await mutateDesktopDownloadEngineSnapshot(() =>
      postDesktopDownloadTask(task)
    );
  }

  const canRemoveMissingTasks =
    options.removeMissingTasks === true && trustedEngineSnapshot !== null;

  if (!canRemoveMissingTasks) {
    return snapshot;
  }

  const staleTaskIds = Object.keys(snapshot.tasks).filter(
    (taskId) => !nextState.tasks[taskId]
  );

  for (const taskId of staleTaskIds) {
    snapshot = await deleteMirroredDesktopDownloadTask(taskId);
  }

  return snapshot;
}
