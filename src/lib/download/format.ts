import { DownloadTaskStatus } from './types';

export function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = sizeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatTransferRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '0 B/s';
  }

  return `${formatBytes(bytesPerSecond)}/s`;
}

export function getTaskCurrentSizeBytes(
  task: Pick<DownloadTaskLike, 'sizeBytes' | 'currentSizeBytes'>
): number {
  return Math.max(
    0,
    typeof task.currentSizeBytes === 'number'
      ? task.currentSizeBytes
      : task.sizeBytes
  );
}

export function getTaskEstimatedTotalSizeBytes(
  task: Pick<
    DownloadTaskLike,
    'sizeBytes' | 'currentSizeBytes' | 'estimatedTotalSizeBytes'
  >
): number {
  const currentSizeBytes = getTaskCurrentSizeBytes(task);
  const estimatedTotalSizeBytes =
    typeof task.estimatedTotalSizeBytes === 'number'
      ? task.estimatedTotalSizeBytes
      : currentSizeBytes;

  return Math.max(currentSizeBytes, estimatedTotalSizeBytes);
}

export function hasEstimatedTaskTotalSize(
  task: Pick<
    DownloadTaskLike,
    'sizeBytes' | 'currentSizeBytes' | 'estimatedTotalSizeBytes'
  >
): boolean {
  return getTaskEstimatedTotalSizeBytes(task) > getTaskCurrentSizeBytes(task);
}

export function formatTaskSizeProgress(
  task: Pick<
    DownloadTaskLike,
    'sizeBytes' | 'currentSizeBytes' | 'estimatedTotalSizeBytes'
  >
): string {
  const currentSizeBytes = getTaskCurrentSizeBytes(task);
  const estimatedTotalSizeBytes = getTaskEstimatedTotalSizeBytes(task);

  if (hasEstimatedTaskTotalSize(task)) {
    return `${formatBytes(currentSizeBytes)} / 约 ${formatBytes(
      estimatedTotalSizeBytes
    )}`;
  }

  return `${formatBytes(currentSizeBytes)} / ${formatBytes(
    estimatedTotalSizeBytes
  )}`;
}

export function getDownloadStatusLabel(status: DownloadTaskStatus): string {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'downloading':
      return '下载中';
    case 'paused':
      return '已暂停';
    case 'done':
      return '已完成';
    case 'error':
      return '下载失败';
    default:
      return status;
  }
}

interface DownloadTaskLike {
  sizeBytes: number;
  currentSizeBytes: number;
  estimatedTotalSizeBytes: number;
}
