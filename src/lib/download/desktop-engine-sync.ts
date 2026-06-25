import {
  deleteDesktopDownloadTask,
  DesktopDownloadEngineSnapshot,
  getDesktopDownloadEngineSnapshot,
  postDesktopDownloadTask,
  putDesktopDownloadEngineSettings,
} from './desktop-runtime';
import { DownloadTask } from './types';

export interface DesktopDownloadEngineSyncState {
  maxConcurrentTasks: number;
  tasks: Record<string, DownloadTask>;
}

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

export async function syncDesktopDownloadEngineState(
  nextState: DesktopDownloadEngineSyncState,
  previousSnapshot?: DesktopDownloadEngineSnapshot | null
): Promise<DesktopDownloadEngineSnapshot> {
  let snapshot = previousSnapshot || (await getDesktopDownloadEngineSnapshot());

  if (snapshot.maxConcurrentTasks !== nextState.maxConcurrentTasks) {
    snapshot = await putDesktopDownloadEngineSettings({
      maxConcurrentTasks: nextState.maxConcurrentTasks,
    });
  }

  for (const task of Object.values(nextState.tasks)) {
    if (areDesktopDownloadTasksEquivalent(task, snapshot.tasks[task.id])) {
      continue;
    }

    snapshot = await postDesktopDownloadTask(task);
  }

  const staleTaskIds = Object.keys(snapshot.tasks).filter(
    (taskId) => !nextState.tasks[taskId]
  );

  for (const taskId of staleTaskIds) {
    snapshot = await deleteDesktopDownloadTask(taskId);
  }

  return snapshot;
}
