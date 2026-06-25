import {
  cancelDesktopDownloadTask,
  deleteDesktopDownloadTask,
  DesktopDownloadEngineSnapshot,
  getDesktopDownloadEngineSnapshot,
  pauseDesktopDownloadTask,
  postDesktopDownloadTask,
  putDesktopDownloadEngineSettings,
  resumeDesktopDownloadTask,
} from './desktop-runtime';
import { DownloadTask } from './types';

export interface DesktopDownloadEngineSyncState {
  maxConcurrentTasks: number;
  tasks: Record<string, DownloadTask>;
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
  return mutateDesktopDownloadEngineSnapshot(() =>
    deleteDesktopDownloadTask(taskId)
  );
}

export async function syncDesktopDownloadEngineState(
  nextState: DesktopDownloadEngineSyncState,
  previousSnapshot?: DesktopDownloadEngineSnapshot | null
): Promise<DesktopDownloadEngineSnapshot> {
  let snapshot = await resolveDesktopDownloadEngineSnapshot(previousSnapshot);

  if (snapshot.maxConcurrentTasks !== nextState.maxConcurrentTasks) {
    snapshot = await syncDesktopDownloadEngineSettings(
      nextState.maxConcurrentTasks
    );
  }

  for (const task of Object.values(nextState.tasks)) {
    if (areDesktopDownloadTasksEquivalent(task, snapshot.tasks[task.id])) {
      continue;
    }

    snapshot = await mutateDesktopDownloadEngineSnapshot(() =>
      postDesktopDownloadTask(task)
    );
  }

  const staleTaskIds = Object.keys(snapshot.tasks).filter(
    (taskId) => !nextState.tasks[taskId]
  );

  for (const taskId of staleTaskIds) {
    snapshot = await deleteMirroredDesktopDownloadTask(taskId);
  }

  return snapshot;
}
