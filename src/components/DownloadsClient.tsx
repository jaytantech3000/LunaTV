'use client';

import { Settings2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import {
  formatBytes,
  formatTaskSizeProgress,
  formatTransferRate,
  getDownloadStatusLabel,
  getTaskCurrentSizeBytes,
  getTaskEstimatedTotalSizeBytes,
} from '@/lib/download/format';
import { downloadManager } from '@/lib/download/manager';
import { normalizeVodDetailForPlayback } from '@/lib/download/normalize';
import { buildOfflinePlayHref } from '@/lib/download/offline';
import { sortActiveDownloadTasks } from '@/lib/download/sort';
import {
  buildDownloadTaskId,
  DOWNLOAD_CACHE_NAME,
  DOWNLOAD_RESOURCE_DB_NAME,
  DOWNLOAD_RESOURCE_STORE_NAME,
  DownloadedContentMeta,
  DownloadTask,
  MAX_CONCURRENT_DOWNLOAD_TASKS,
  MIN_CONCURRENT_DOWNLOAD_TASKS,
} from '@/lib/download/types';
import { searchPlaybackSources } from '@/lib/playback-source-prefetch';
import { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import { useDownloadStore } from '@/stores/downloadStore';

const concurrentTaskOptions = Array.from(
  {
    length: MAX_CONCURRENT_DOWNLOAD_TASKS - MIN_CONCURRENT_DOWNLOAD_TASKS + 1,
  },
  (_, index) => MIN_CONCURRENT_DOWNLOAD_TASKS + index
);

const compactActionButtonClassName =
  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors';

function formatDateTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '未知';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function formatEpisodeCode(episodeIndex: number): string {
  return `EP${String(episodeIndex + 1).padStart(2, '0')}`;
}

function buildSearchResultKey(
  result: Pick<SearchResult, 'source' | 'id'>
): string {
  return `${result.source}:${result.id}`;
}

function mergeDownloadableSources(
  detail: SearchResult,
  sources: SearchResult[]
): SearchResult[] {
  const seen = new Set<string>();
  const mergedSources: SearchResult[] = [];

  [detail, ...sources].forEach((source) => {
    const sourceKey = buildSearchResultKey(source);

    if (seen.has(sourceKey)) {
      return;
    }

    seen.add(sourceKey);
    mergedSources.push(source);
  });

  return mergedSources;
}

function getEpisodeTitleFromSources(
  sources: SearchResult[],
  episodeIndex: number
): string {
  for (const source of sources) {
    const episodeTitle = source.episodes_titles[episodeIndex]?.trim();

    if (episodeTitle) {
      return episodeTitle;
    }
  }

  return `第 ${episodeIndex + 1} 集`;
}

interface MoreDownloadEpisodeOption {
  episodeIndex: number;
  episodeTitle: string;
  hasSource: boolean;
  task?: DownloadTask;
  isActionable: boolean;
}

interface ActiveTaskGroup {
  contentId: string;
  title: string;
  poster: string;
  sourceName: string;
  year: string;
  tasks: DownloadTask[];
  totalResources: number;
  downloadedResources: number;
  currentSizeBytes: number;
  estimatedTotalSizeBytes: number;
  downloadSpeedBytesPerSecond: number;
  progress: number;
  updatedAt: number;
  downloadingCount: number;
  queuedCount: number;
  pausedCount: number;
  errorCount: number;
}

function getMoreDownloadEpisodeStatus(option: MoreDownloadEpisodeOption): string {
  if (!option.hasSource) {
    return '当前源缺少可下载地址';
  }

  switch (option.task?.status) {
    case 'downloading':
      return `下载中 · ${option.task.progress}%`;
    case 'queued':
      return '已加入下载队列';
    case 'paused':
      return '已暂停，可继续';
    case 'error':
      return option.task.errorMessage || '下载失败，可重试';
    default:
      return '尚未下载';
  }
}

function getMoreDownloadEpisodeActionLabel(
  option: MoreDownloadEpisodeOption
): string {
  if (!option.hasSource) {
    return '不可下载';
  }

  switch (option.task?.status) {
    case 'downloading':
      return '下载中';
    case 'queued':
      return '排队中';
    case 'paused':
      return '继续下载';
    case 'error':
      return '重试下载';
    default:
      return '下载';
  }
}

function getMoreDownloadEpisodeActionBadgeClassName(
  option: MoreDownloadEpisodeOption
): string {
  if (!option.hasSource) {
    return 'border-white/10 bg-white/5 text-gray-500';
  }

  switch (option.task?.status) {
    case 'downloading':
      return 'border-sky-500/20 bg-sky-500/10 text-sky-200';
    case 'queued':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-200';
    case 'paused':
      return 'border-orange-500/20 bg-orange-500/10 text-orange-200';
    case 'error':
      return 'border-red-500/20 bg-red-500/10 text-red-200';
    default:
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200';
  }
}

interface ActiveTasksSectionProps {
  activeTaskGroups: ActiveTaskGroup[];
  activeContentId?: string | null;
  onOpenContent: (contentId: string) => void;
}

interface ActiveTaskDialogProps {
  group: ActiveTaskGroup;
  onClose: () => void;
}

interface DownloadedContentsSectionProps {
  activeContentId?: string | null;
  onOpenContent: (contentId: string) => void;
}

interface DownloadedContentDialogProps {
  content: DownloadedContentMeta;
  onClose: () => void;
  onDeleteEpisode: (contentId: string, episodeIndex: number) => Promise<void>;
}

interface DownloadSettingsDialogProps {
  storageOrigin: string;
  isDevelopment: boolean;
  maxConcurrentTasks: number;
  onConcurrentTaskChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onClose: () => void;
}

function buildActiveTaskGroups(
  tasks: Record<string, DownloadTask>
): ActiveTaskGroup[] {
  const activeTasks = sortActiveDownloadTasks(
    Object.values(tasks).filter((task) => task.status !== 'done')
  );
  const taskGroups = new Map<string, DownloadTask[]>();

  activeTasks.forEach((task) => {
    const currentTasks = taskGroups.get(task.contentId) || [];
    currentTasks.push(task);
    taskGroups.set(task.contentId, currentTasks);
  });

  return Array.from(taskGroups.values())
    .map((groupTasks) => {
      const sortedTasks = sortActiveDownloadTasks(groupTasks);
      const leadTask = sortedTasks[0];
      const totalResources = sortedTasks.reduce(
        (sum, task) => sum + Math.max(0, task.totalResources),
        0
      );
      const downloadedResources = sortedTasks.reduce(
        (sum, task) =>
          sum +
          Math.max(
            0,
            Math.min(
              task.downloadedResources,
              task.totalResources > 0
                ? task.totalResources
                : task.downloadedResources
            )
          ),
        0
      );
      const currentSizeBytes = sortedTasks.reduce(
        (sum, task) => sum + getTaskCurrentSizeBytes(task),
        0
      );
      const estimatedTotalSizeBytes = sortedTasks.reduce(
        (sum, task) => sum + getTaskEstimatedTotalSizeBytes(task),
        0
      );
      const downloadSpeedBytesPerSecond = sortedTasks.reduce(
        (sum, task) =>
          sum + Math.max(0, task.downloadSpeedBytesPerSecond || 0),
        0
      );
      const progress =
        totalResources > 0
          ? Math.min(
              100,
              Math.round((downloadedResources / totalResources) * 100)
            )
          : Math.round(
              sortedTasks.reduce(
                (sum, task) => sum + Math.max(0, Math.min(100, task.progress)),
                0
              ) / sortedTasks.length
            );

      return {
        contentId: leadTask.contentId,
        title: leadTask.title,
        poster: leadTask.poster,
        sourceName: leadTask.sourceName,
        year: leadTask.year,
        tasks: sortedTasks,
        totalResources,
        downloadedResources,
        currentSizeBytes,
        estimatedTotalSizeBytes,
        downloadSpeedBytesPerSecond,
        progress,
        updatedAt: sortedTasks.reduce(
          (latestUpdatedAt, task) => Math.max(latestUpdatedAt, task.updatedAt),
          0
        ),
        downloadingCount: sortedTasks.filter(
          (task) => task.status === 'downloading'
        ).length,
        queuedCount: sortedTasks.filter((task) => task.status === 'queued')
          .length,
        pausedCount: sortedTasks.filter((task) => task.status === 'paused')
          .length,
        errorCount: sortedTasks.filter((task) => task.status === 'error')
          .length,
      };
    })
    .sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }

      return left.title.localeCompare(right.title, 'zh-CN');
    });
}

function getActiveTaskGroupStatusBadgeLabel(group: ActiveTaskGroup): string {
  const statusKinds = [
    group.downloadingCount,
    group.queuedCount,
    group.pausedCount,
    group.errorCount,
  ].filter((count) => count > 0).length;

  if (group.downloadingCount > 0) {
    return statusKinds > 1
      ? `${group.tasks.length} 集进行中`
      : `${group.downloadingCount} 集下载中`;
  }

  if (group.queuedCount > 0) {
    return statusKinds > 1
      ? `${group.tasks.length} 集待处理`
      : `${group.queuedCount} 集排队中`;
  }

  if (group.pausedCount > 0) {
    return statusKinds > 1
      ? `${group.tasks.length} 集已暂停`
      : `${group.pausedCount} 集已暂停`;
  }

  if (group.errorCount > 0) {
    return statusKinds > 1
      ? `${group.tasks.length} 集异常`
      : `${group.errorCount} 集失败`;
  }

  return `${group.tasks.length} 集任务`;
}

function getActiveTaskGroupStatusBadgeClassName(group: ActiveTaskGroup): string {
  if (group.downloadingCount > 0) {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200';
  }

  if (group.queuedCount > 0) {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-200';
  }

  if (group.pausedCount > 0) {
    return 'border-orange-500/20 bg-orange-500/10 text-orange-200';
  }

  if (group.errorCount > 0) {
    return 'border-red-500/20 bg-red-500/10 text-red-200';
  }

  return 'border-white/10 bg-white/10 text-white/80';
}

function getActiveTaskGroupResourceSummary(group: ActiveTaskGroup): string {
  if (group.totalResources > 0) {
    return `${group.downloadedResources}/${group.totalResources} 个资源`;
  }

  return group.tasks.length > 1 ? `${group.tasks.length} 个任务` : '等待资源清单';
}

function getActiveTaskStatusClassName(task: DownloadTask): string {
  switch (task.status) {
    case 'downloading':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200';
    case 'queued':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-200';
    case 'paused':
      return 'border-orange-500/20 bg-orange-500/10 text-orange-200';
    case 'error':
      return 'border-red-500/20 bg-red-500/10 text-red-200';
    default:
      return 'border-white/10 bg-white/5 text-gray-300';
  }
}

function ActiveTasksSection({
  activeTaskGroups,
  activeContentId,
  onOpenContent,
}: ActiveTasksSectionProps) {
  const totalTaskCount = useMemo(
    () =>
      activeTaskGroups.reduce((sum, group) => sum + group.tasks.length, 0),
    [activeTaskGroups]
  );
  const totalDownloadSpeedBytesPerSecond = useMemo(
    () =>
      activeTaskGroups.reduce(
        (sum, group) => sum + group.downloadSpeedBytesPerSecond,
        0
      ),
    [activeTaskGroups]
  );

  return (
    <section className='space-y-4'>
      <div className='flex items-center justify-between gap-3'>
        <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
          进行中的任务
        </h2>
        <span className='text-sm text-gray-500 dark:text-gray-400'>
          {activeTaskGroups.length} 部内容 · {totalTaskCount} 个任务
          {totalDownloadSpeedBytesPerSecond > 0 &&
            ` · 总速 ${formatTransferRate(totalDownloadSpeedBytesPerSecond)}`}
        </span>
      </div>

      {activeTaskGroups.length === 0 ? (
        <div className='rounded-2xl border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
          当前没有进行中的下载任务。
        </div>
      ) : (
        <div className='flex flex-wrap gap-4'>
          {activeTaskGroups.map((group) => (
            <button
              type='button'
              key={group.contentId}
              onClick={() => onOpenContent(group.contentId)}
              className={`group w-full overflow-hidden rounded-[22px] border text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-xl sm:w-[220px] xl:w-[238px] ${
                activeContentId === group.contentId
                  ? 'border-emerald-400/70 bg-emerald-50/40 shadow-lg shadow-emerald-500/10 dark:border-emerald-500/60 dark:bg-emerald-950/20'
                  : 'border-gray-200 bg-white/80 shadow-sm hover:border-emerald-300/60 dark:border-gray-800 dark:bg-gray-900/50'
              }`}
              aria-haspopup='dialog'
              aria-label={`查看 ${group.title} 的进行中任务详情`}
            >
              <div className='relative aspect-[4/5] overflow-hidden bg-gray-900'>
                {group.poster ? (
                  <Image
                    src={processImageUrl(group.poster)}
                    alt={group.title}
                    fill
                    className='object-cover transition-transform duration-500 group-hover:scale-105'
                    referrerPolicy='no-referrer'
                    sizes='(max-width: 640px) 100vw, 238px'
                  />
                ) : (
                  <div className='absolute inset-0 flex items-center justify-center bg-gradient-to-br from-emerald-700/60 via-gray-900 to-black text-4xl font-semibold text-white/80'>
                    {group.title.slice(0, 1)}
                  </div>
                )}

                <div className='absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent' />

                <div
                  className={`absolute left-3 top-3 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm ${getActiveTaskGroupStatusBadgeClassName(
                    group
                  )}`}
                >
                  {getActiveTaskGroupStatusBadgeLabel(group)}
                </div>

                <div className='absolute right-3 top-3 inline-flex rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm'>
                  {group.progress}%
                </div>

                <div className='absolute inset-x-0 bottom-0 p-3 text-white'>
                  <div
                    className='line-clamp-2 text-base font-semibold leading-tight'
                    title={group.title}
                  >
                    {group.title}
                  </div>
                  <div className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/75'>
                    <span>{group.sourceName}</span>
                    {group.year && group.year !== 'unknown' && (
                      <span>{group.year}</span>
                    )}
                    <span>{group.tasks.length} 个任务</span>
                  </div>
                </div>
              </div>

              <div className='space-y-2 px-3 pb-3 pt-2'>
                <div className='grid grid-cols-2 gap-3 text-xs text-gray-500 dark:text-gray-400'>
                  <span className='line-clamp-3 min-h-12 break-words leading-4'>
                    {getActiveTaskGroupResourceSummary(group)}
                  </span>
                  <span className='line-clamp-3 min-h-12 break-words text-right leading-4'>
                    {formatTaskSizeProgress({
                      sizeBytes: group.currentSizeBytes,
                      currentSizeBytes: group.currentSizeBytes,
                      estimatedTotalSizeBytes: group.estimatedTotalSizeBytes,
                    })}
                  </span>
                </div>
                <div className='flex items-center justify-between text-xs text-gray-500 dark:text-gray-400'>
                  <span>
                    总速 {formatTransferRate(group.downloadSpeedBytesPerSecond)}
                  </span>
                  <span>{formatDateTime(group.updatedAt)}</span>
                </div>
                <div className='h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800'>
                  <div
                    className='h-full rounded-full bg-emerald-500 transition-all'
                    style={{ width: `${group.progress}%` }}
                  />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ActiveTaskDialog({ group, onClose }: ActiveTaskDialogProps) {
  const activeTasks = useMemo(() => sortActiveDownloadTasks(group.tasks), [
    group.tasks,
  ]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

  useEffect(() => {
    setActionError(null);
    setPendingTaskId(null);
  }, [group.contentId]);

  const handleTaskAction = async (
    taskId: string,
    action: 'pause' | 'resume' | 'cancel'
  ) => {
    try {
      setActionError(null);
      setPendingTaskId(taskId);

      if (action === 'pause') {
        await downloadManager.pauseTask(taskId);
        return;
      }

      if (action === 'resume') {
        await downloadManager.resumeTask(taskId);
        return;
      }

      await downloadManager.cancelTask(taskId);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : action === 'pause'
          ? '暂停下载失败'
          : action === 'resume'
          ? '恢复下载失败'
          : '取消下载失败'
      );
    } finally {
      setPendingTaskId(null);
    }
  };

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className='fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6'>
      <button
        type='button'
        aria-label='关闭进行中任务详情'
        className='absolute inset-0 bg-black/75 backdrop-blur-sm'
        onClick={onClose}
      />

      <div className='relative z-[10001] flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#040b15]/95 text-white shadow-2xl shadow-black/50'>
        <div className='border-b border-white/10 px-5 py-5 lg:px-6'>
          <div className='flex items-start justify-between gap-4'>
            <div className='space-y-3'>
              <div className='text-xs font-medium uppercase tracking-[0.24em] text-emerald-300/80'>
                进行中的任务
              </div>
              <div className='text-2xl font-semibold text-white'>
                {group.title}
              </div>
              <div className='flex flex-wrap items-center gap-2 text-sm text-gray-300'>
                <span>{group.sourceName}</span>
                {group.year && group.year !== 'unknown' && (
                  <span>{group.year}</span>
                )}
                <span>{group.tasks.length} 个任务</span>
                <span>{group.progress}%</span>
              </div>
            </div>

            <button
              type='button'
              onClick={onClose}
              className='rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10'
            >
              关闭
            </button>
          </div>

          <div className='mt-4 flex flex-wrap gap-2 text-xs'>
            {group.downloadingCount > 0 ? (
              <span className='rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-200'>
                下载中 {group.downloadingCount}
              </span>
            ) : null}
            {group.queuedCount > 0 ? (
              <span className='rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-amber-200'>
                排队中 {group.queuedCount}
              </span>
            ) : null}
            {group.pausedCount > 0 ? (
              <span className='rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-orange-200'>
                已暂停 {group.pausedCount}
              </span>
            ) : null}
            {group.errorCount > 0 ? (
              <span className='rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-red-200'>
                下载失败 {group.errorCount}
              </span>
            ) : null}
            <span className='rounded-full border border-white/10 bg-white/5 px-3 py-1 text-gray-300'>
              {getActiveTaskGroupResourceSummary(group)}
            </span>
          </div>
        </div>

        <div className='grid min-h-0 flex-1 lg:grid-cols-[260px_minmax(0,1fr)]'>
          <div className='overflow-y-auto border-b border-white/10 p-4 lg:border-b-0 lg:border-r lg:border-white/10 lg:p-6'>
            <div className='space-y-4'>
              <div className='relative aspect-[4/5] overflow-hidden rounded-3xl bg-black/40'>
                {group.poster ? (
                  <Image
                    src={processImageUrl(group.poster)}
                    alt={group.title}
                    fill
                    className='object-cover'
                    referrerPolicy='no-referrer'
                    sizes='260px'
                  />
                ) : (
                  <div className='absolute inset-0 flex items-center justify-center bg-gradient-to-br from-emerald-700/70 via-gray-900 to-black text-5xl font-semibold text-white/80'>
                    {group.title.slice(0, 1)}
                  </div>
                )}
                <div className='absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent' />
                <div className='absolute inset-x-0 bottom-0 p-4'>
                  <div className='line-clamp-2 text-xl font-semibold text-white'>
                    {group.title}
                  </div>
                </div>
              </div>

              <div className='flex flex-wrap gap-2 text-xs'>
                <span
                  className={`rounded-full border px-3 py-1 ${getActiveTaskGroupStatusBadgeClassName(
                    group
                  )}`}
                >
                  {getActiveTaskGroupStatusBadgeLabel(group)}
                </span>
                <span className='rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-sky-200'>
                  {group.progress}%
                </span>
                <span className='rounded-full border border-white/10 bg-white/5 px-3 py-1 text-gray-300'>
                  {formatTaskSizeProgress({
                    sizeBytes: group.currentSizeBytes,
                    currentSizeBytes: group.currentSizeBytes,
                    estimatedTotalSizeBytes: group.estimatedTotalSizeBytes,
                  })}
                </span>
                <span className='rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-200'>
                  总速 {formatTransferRate(group.downloadSpeedBytesPerSecond)}
                </span>
              </div>

              <div className='space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300'>
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-gray-400'>资源进度</span>
                  <span>{getActiveTaskGroupResourceSummary(group)}</span>
                </div>
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-gray-400'>大小进度</span>
                  <span>
                    {formatTaskSizeProgress({
                      sizeBytes: group.currentSizeBytes,
                      currentSizeBytes: group.currentSizeBytes,
                      estimatedTotalSizeBytes: group.estimatedTotalSizeBytes,
                    })}
                  </span>
                </div>
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-gray-400'>总下载速度</span>
                  <span>{formatTransferRate(group.downloadSpeedBytesPerSecond)}</span>
                </div>
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-gray-400'>最近更新</span>
                  <span>{formatDateTime(group.updatedAt)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className='min-h-0 overflow-y-auto p-4 lg:p-6'>
            <div className='space-y-4'>
              {actionError ? (
                <div className='rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200'>
                  {actionError}
                </div>
              ) : null}

              <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
                {activeTasks.map((task) => {
                  const isPending = pendingTaskId === task.id;

                  return (
                    <div
                      key={task.id}
                      className='rounded-xl border border-white/10 bg-black/20 p-3 text-left'
                    >
                      <div className='flex items-start justify-between gap-3'>
                        <div className='min-w-0'>
                          <div className='flex min-w-0 items-center gap-2'>
                            <span className='rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] font-medium text-gray-200'>
                              {formatEpisodeCode(task.episodeIndex)}
                            </span>
                            <div
                              className='truncate text-sm font-semibold text-white'
                              title={task.episodeTitle}
                            >
                              {task.episodeTitle}
                            </div>
                          </div>
                        </div>

                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${getActiveTaskStatusClassName(
                            task
                          )}`}
                        >
                          {getDownloadStatusLabel(task.status)}
                        </span>
                      </div>

                      <div className='mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-300'>
                        {task.totalResources > 0 ? (
                          <span>
                            {task.downloadedResources}/{task.totalResources} 个资源
                          </span>
                        ) : (
                          <span>等待资源清单</span>
                        )}
                        <span>{task.progress}%</span>
                      </div>

                      <div className='mt-2 flex items-center justify-between gap-3 text-[11px] text-gray-300'>
                        <span>{formatTaskSizeProgress(task)}</span>
                        <span>{formatTransferRate(task.downloadSpeedBytesPerSecond)}</span>
                      </div>

                      <div className='mt-3 h-1.5 overflow-hidden rounded-full bg-white/10'>
                        <div
                          className='h-full rounded-full bg-emerald-500 transition-all'
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>

                      {task.errorMessage && task.status === 'error' ? (
                        <div className='mt-3 text-xs text-red-200'>
                          {task.errorMessage}
                        </div>
                      ) : null}

                      <div className='mt-3 flex flex-wrap gap-2'>
                        {task.status === 'downloading' ? (
                          <button
                            type='button'
                            onClick={() =>
                              void handleTaskAction(task.id, 'pause')
                            }
                            disabled={isPending}
                            className={`${compactActionButtonClassName} border border-emerald-300 text-emerald-200 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            暂停
                          </button>
                        ) : null}

                        {['paused', 'error'].includes(task.status) ? (
                          <button
                            type='button'
                            onClick={() =>
                              void handleTaskAction(task.id, 'resume')
                            }
                            disabled={isPending}
                            className={`${compactActionButtonClassName} bg-emerald-600 text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400`}
                          >
                            {task.status === 'error' ? '重试' : '继续'}
                          </button>
                        ) : null}

                        {task.status === 'queued' ? (
                          <span className='rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300'>
                            排队中
                          </span>
                        ) : null}

                        <button
                          type='button'
                          onClick={() => void handleTaskAction(task.id, 'cancel')}
                          disabled={isPending}
                          className={`${compactActionButtonClassName} border border-white/15 text-gray-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {activeTasks.length === 0 ? (
                <div className='rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center text-sm text-gray-400'>
                  当前没有进行中的任务。
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function DownloadedContentsSection({
  activeContentId,
  onOpenContent,
}: DownloadedContentsSectionProps) {
  const library = useDownloadStore((state) => state.library);
  const downloadedContents = useMemo(
    () =>
      [...Object.values(library)].sort(
        (left, right) => right.updatedAt - left.updatedAt
      ),
    [library]
  );

  return (
    <section className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
          已下载内容
        </h2>
        <span className='text-sm text-gray-500 dark:text-gray-400'>
          {downloadedContents.length} 部内容
        </span>
      </div>

      {downloadedContents.length === 0 ? (
        <div className='rounded-2xl border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
          还没有可离线播放的内容。
        </div>
      ) : (
        <div className='flex flex-wrap gap-4'>
          {downloadedContents.map((content) => (
            <button
              type='button'
              key={content.contentId}
              onClick={() => onOpenContent(content.contentId)}
              className={`group w-full overflow-hidden rounded-[22px] border text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-xl sm:w-[220px] xl:w-[238px] ${
                activeContentId === content.contentId
                  ? 'border-emerald-400/70 bg-emerald-50/40 shadow-lg shadow-emerald-500/10 dark:border-emerald-500/60 dark:bg-emerald-950/20'
                  : 'border-gray-200 bg-white/80 shadow-sm hover:border-emerald-300/60 dark:border-gray-800 dark:bg-gray-900/50'
              }`}
              aria-haspopup='dialog'
              aria-label={`查看 ${content.title} 的离线资源详情`}
            >
              <div className='relative aspect-[4/5] overflow-hidden bg-gray-900'>
                {content.poster ? (
                  <Image
                    src={processImageUrl(content.poster)}
                    alt={content.title}
                    fill
                    className='object-cover transition-transform duration-500 group-hover:scale-105'
                    referrerPolicy='no-referrer'
                    sizes='(max-width: 640px) 100vw, 238px'
                  />
                ) : (
                  <div className='absolute inset-0 flex items-center justify-center bg-gradient-to-br from-emerald-700/60 via-gray-900 to-black text-4xl font-semibold text-white/80'>
                    {content.title.slice(0, 1)}
                  </div>
                )}

                <div className='absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent' />

                <div className='absolute left-3 top-3 inline-flex rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm'>
                  {content.episodes.length} 集已下载
                </div>

                <div className='absolute right-3 top-3 inline-flex rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm'>
                  {formatBytes(content.totalSizeBytes)}
                </div>

                <div className='absolute inset-x-0 bottom-0 p-3 text-white'>
                  <div
                    className='line-clamp-2 text-base font-semibold leading-tight'
                    title={content.title}
                  >
                    {content.title}
                  </div>
                  <div className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/75'>
                    <span>{content.sourceName}</span>
                    {content.year && content.year !== 'unknown' && (
                      <span>{content.year}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className='px-3 pb-3 pt-2'>
                <div className='flex items-center justify-between text-xs text-gray-500 dark:text-gray-400'>
                  <span>最近更新</span>
                  <span>{formatDateTime(content.updatedAt)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function DownloadedContentDialog({
  content,
  onClose,
  onDeleteEpisode,
}: DownloadedContentDialogProps) {
  const router = useRouter();
  const tasks = useDownloadStore((state) => state.tasks);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedEpisodeIndexes, setSelectedEpisodeIndexes] = useState<
    number[]
  >([]);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [isMoreDownloadsOpen, setIsMoreDownloadsOpen] = useState(false);
  const [downloadableDetail, setDownloadableDetail] =
    useState<SearchResult | null>(null);
  const [downloadableAvailableSources, setDownloadableAvailableSources] =
    useState<SearchResult[]>([]);
  const [isLoadingDownloadableDetail, setIsLoadingDownloadableDetail] =
    useState(false);
  const [moreDownloadsError, setMoreDownloadsError] = useState<string | null>(
    null
  );
  const [moreDownloadsFeedback, setMoreDownloadsFeedback] = useState<
    string | null
  >(null);
  const detailRequestKeyRef = useRef(`${content.source}:${content.vodId}`);
  const shouldCollapseDescription = (content.desc?.length || 0) > 140;
  const downloadedEpisodeIndexSet = useMemo(
    () => new Set(content.episodes.map((episode) => episode.episodeIndex)),
    [content.episodes]
  );
  const allEpisodeIndexes = useMemo(
    () => content.episodes.map((episode) => episode.episodeIndex),
    [content.episodes]
  );
  const selectedEpisodeIndexSet = useMemo(
    () => new Set(selectedEpisodeIndexes),
    [selectedEpisodeIndexes]
  );
  const allEpisodesSelected =
    allEpisodeIndexes.length > 0 &&
    allEpisodeIndexes.every((episodeIndex) =>
      selectedEpisodeIndexSet.has(episodeIndex)
    );
  const downloadableSources = useMemo(
    () =>
      downloadableDetail
        ? mergeDownloadableSources(
            downloadableDetail,
            downloadableAvailableSources
          )
        : [],
    [downloadableAvailableSources, downloadableDetail]
  );
  const moreDownloadEpisodeOptions = useMemo<MoreDownloadEpisodeOption[]>(() => {
    if (!downloadableSources.length) {
      return [];
    }

    const totalEpisodeCount = downloadableSources.reduce(
      (maxCount, source) => Math.max(maxCount, source.episodes.length),
      0
    );

    return Array.from({ length: totalEpisodeCount }, (_, episodeIndex) => {
      const task = tasks[buildDownloadTaskId(content.contentId, episodeIndex)];
      const isDownloaded =
        downloadedEpisodeIndexSet.has(episodeIndex) || task?.status === 'done';

      if (isDownloaded) {
        return null;
      }

      const hasSource = downloadableSources.some((source) =>
        Boolean(source.episodes[episodeIndex])
      );

      return {
        episodeIndex,
        episodeTitle: getEpisodeTitleFromSources(
          downloadableSources,
          episodeIndex
        ),
        hasSource,
        task,
        isActionable:
          hasSource && (!task || ['paused', 'error'].includes(task.status)),
      };
    }).filter(Boolean) as MoreDownloadEpisodeOption[];
  }, [
    content.contentId,
    downloadableSources,
    downloadedEpisodeIndexSet,
    tasks,
  ]);

  useEffect(() => {
    detailRequestKeyRef.current = `${content.source}:${content.vodId}`;
    setIsDescriptionExpanded(false);
    setIsEditing(false);
    setSelectedEpisodeIndexes([]);
    setIsDeletingSelected(false);
    setIsMoreDownloadsOpen(false);
    setDownloadableDetail(null);
    setDownloadableAvailableSources([]);
    setIsLoadingDownloadableDetail(false);
    setMoreDownloadsError(null);
    setMoreDownloadsFeedback(null);
  }, [content.contentId, content.source, content.vodId]);

  useEffect(() => {
    setSelectedEpisodeIndexes((currentState) => {
      const nextState = currentState.filter((episodeIndex) =>
        allEpisodeIndexes.includes(episodeIndex)
      );

      return nextState.length === currentState.length
        ? currentState
        : nextState;
    });
  }, [allEpisodeIndexes]);

  const handleToggleEditing = () => {
    setIsEditing((currentState) => {
      if (currentState) {
        setSelectedEpisodeIndexes([]);
      }

      return !currentState;
    });
  };

  const handleToggleSelectAll = () => {
    setSelectedEpisodeIndexes(
      allEpisodesSelected ? [] : allEpisodeIndexes
    );
  };

  const handleToggleEpisodeSelection = (episodeIndex: number) => {
    setSelectedEpisodeIndexes((currentState) =>
      currentState.includes(episodeIndex)
        ? currentState.filter((currentIndex) => currentIndex !== episodeIndex)
        : [...currentState, episodeIndex]
    );
  };

  const handleDeleteSelectedEpisodes = async () => {
    if (selectedEpisodeIndexes.length === 0 || isDeletingSelected) {
      return;
    }

    setIsDeletingSelected(true);

    try {
      for (const episodeIndex of selectedEpisodeIndexes) {
        await onDeleteEpisode(content.contentId, episodeIndex);
      }

      setSelectedEpisodeIndexes([]);
    } finally {
      setIsDeletingSelected(false);
    }
  };

  const loadDownloadableDetail = async (): Promise<SearchResult | null> => {
    if (downloadableDetail) {
      return downloadableDetail;
    }

    if (isLoadingDownloadableDetail) {
      return null;
    }

    const requestKey = `${content.source}:${content.vodId}`;

    try {
      setIsLoadingDownloadableDetail(true);
      setMoreDownloadsError(null);

      const [detailResponse, matchedSources] = await Promise.all([
        (async () => {
          const searchParams = new URLSearchParams({
            source: content.source,
            id: content.vodId,
          });
          const response = await fetch(
            `/api/detail?${searchParams.toString()}`,
            {
              cache: 'no-store',
            }
          );
          const payload = (await response.json()) as SearchResult & {
            error?: string;
          };

          if (!response.ok) {
            throw new Error(payload.error || '获取可下载剧集失败');
          }

          return payload;
        })(),
        searchPlaybackSources({
          title: content.title,
          year:
            content.year && content.year !== 'unknown'
              ? content.year
              : undefined,
          doubanId: content.doubanId,
        }).catch(() => []),
      ]);

      const normalizedDetail = normalizeVodDetailForPlayback(detailResponse);
      const nextAvailableSources = matchedSources.filter(
        (source) =>
          buildSearchResultKey(source) !== buildSearchResultKey(normalizedDetail)
      );

      if (detailRequestKeyRef.current !== requestKey) {
        return null;
      }

      setDownloadableDetail(normalizedDetail);
      setDownloadableAvailableSources(nextAvailableSources);
      return normalizedDetail;
    } catch (error) {
      if (detailRequestKeyRef.current === requestKey) {
        setMoreDownloadsError(
          error instanceof Error ? error.message : '获取可下载剧集失败'
        );
      }
      return null;
    } finally {
      if (detailRequestKeyRef.current === requestKey) {
        setIsLoadingDownloadableDetail(false);
      }
    }
  };

  const handleToggleMoreDownloads = () => {
    const nextOpenState = !isMoreDownloadsOpen;
    setIsMoreDownloadsOpen(nextOpenState);
    setMoreDownloadsFeedback(null);

    if (nextOpenState && !downloadableDetail && !isLoadingDownloadableDetail) {
      void loadDownloadableDetail();
    }
  };

  const handleStartMoreDownload = async (episodeIndex: number) => {
    const detail = downloadableDetail || (await loadDownloadableDetail());
    if (!detail) {
      return;
    }

    const candidateSources = mergeDownloadableSources(
      detail,
      downloadableAvailableSources
    );
    const availableSources = candidateSources.filter(
      (source) => buildSearchResultKey(source) !== buildSearchResultKey(detail)
    );
    const hasEpisodeSource = candidateSources.some((source) =>
      Boolean(source.episodes[episodeIndex])
    );

    if (!hasEpisodeSource) {
      setMoreDownloadsError('当前剧集缺少可下载地址');
      return;
    }

    try {
      setMoreDownloadsError(null);
      setMoreDownloadsFeedback(null);
      await downloadManager.startEpisodeDownload({
        detail,
        episodeIndex,
        availableSources,
      });
      setMoreDownloadsFeedback(
        `已将 ${
          getEpisodeTitleFromSources(candidateSources, episodeIndex)
        } 加入下载队列。`
      );
    } catch (error) {
      setMoreDownloadsError(
        error instanceof Error ? error.message : '加入下载队列失败'
      );
    }
  };

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className='fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6'>
      <button
        type='button'
        aria-label='关闭离线资源详情'
        className='absolute inset-0 bg-black/75 backdrop-blur-sm'
        onClick={onClose}
      />

      <div className='relative z-[10001] flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#040b15]/95 text-white shadow-2xl shadow-black/50'>
        <div className='border-b border-white/10 px-5 py-5 lg:px-6'>
          <div className='flex items-start justify-between gap-4'>
            <div className='space-y-3'>
              <div className='text-xs font-medium uppercase tracking-[0.24em] text-emerald-300/80'>
                已下载资源
              </div>
              <div className='text-2xl font-semibold text-white'>
                {content.title}
              </div>
              <div className='flex flex-wrap items-center gap-2 text-sm text-gray-300'>
                <span>{content.sourceName}</span>
                <span>{content.episodes.length} 集</span>
                <span>{formatBytes(content.totalSizeBytes)}</span>
                <button
                  type='button'
                  onClick={handleToggleMoreDownloads}
                  className='inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20'
                >
                  {isLoadingDownloadableDetail
                    ? '加载中...'
                    : isMoreDownloadsOpen
                    ? '收起更多'
                    : '下载更多'}
                </button>
              </div>
            </div>

            <div className='flex items-center gap-2'>
              {isEditing ? (
                <>
                  {selectedEpisodeIndexes.length > 0 && (
                    <button
                      type='button'
                      onClick={() => void handleDeleteSelectedEpisodes()}
                      disabled={isDeletingSelected}
                      className='rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50'
                    >
                      删除
                    </button>
                  )}
                  <button
                    type='button'
                    onClick={handleToggleSelectAll}
                    className='rounded-xl border border-white/15 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10'
                  >
                    {allEpisodesSelected ? '取消全选' : '全选'}
                  </button>
                  <button
                    type='button'
                    onClick={handleToggleEditing}
                    className='rounded-xl border border-white/15 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10'
                  >
                    完成
                  </button>
                </>
              ) : (
                <button
                  type='button'
                  onClick={handleToggleEditing}
                  className='rounded-xl border border-white/15 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10'
                >
                  编辑
                </button>
              )}

              <button
                type='button'
                onClick={onClose}
                className='rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10'
              >
                关闭
              </button>
            </div>
          </div>
        </div>

        <div className='grid min-h-0 flex-1 lg:grid-cols-[260px_minmax(0,1fr)]'>
          <div className='overflow-y-auto border-b border-white/10 p-4 lg:border-b-0 lg:border-r lg:border-white/10 lg:p-6'>
            <div className='space-y-4'>
              <div className='relative aspect-[4/5] overflow-hidden rounded-3xl bg-black/40'>
                {content.poster ? (
                  <Image
                    src={processImageUrl(content.poster)}
                    alt={content.title}
                    fill
                    className='object-cover'
                    referrerPolicy='no-referrer'
                    sizes='260px'
                  />
                ) : (
                  <div className='absolute inset-0 flex items-center justify-center bg-gradient-to-br from-emerald-700/70 via-gray-900 to-black text-5xl font-semibold text-white/80'>
                    {content.title.slice(0, 1)}
                  </div>
                )}
                <div className='absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent' />
                <div className='absolute inset-x-0 bottom-0 p-4'>
                  <div className='line-clamp-2 text-xl font-semibold text-white'>
                    {content.title}
                  </div>
                </div>
              </div>

              <div className='flex flex-wrap gap-2 text-xs'>
                <span className='rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-200'>
                  {content.episodes.length} 集已缓存
                </span>
                <span className='rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-sky-200'>
                  {formatBytes(content.totalSizeBytes)}
                </span>
                <span className='rounded-full border border-white/10 bg-white/5 px-3 py-1 text-gray-300'>
                  更新于 {formatDateTime(content.updatedAt)}
                </span>
              </div>

              <div className='space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300'>
                {content.year && content.year !== 'unknown' ? (
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-gray-400'>年份</span>
                    <span>{content.year}</span>
                  </div>
                ) : null}
                {content.typeName ? (
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-gray-400'>类型</span>
                    <span>{content.typeName}</span>
                  </div>
                ) : null}
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-gray-400'>离线来源</span>
                  <span>{content.sourceName}</span>
                </div>
              </div>

              {content.desc ? (
                <button
                  type='button'
                  onClick={() =>
                    setIsDescriptionExpanded(
                      (currentState) => !currentState
                    )
                  }
                  className='w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-left text-sm leading-6 text-gray-300 transition-colors hover:bg-white/10'
                >
                  <div className='mb-2 flex items-center justify-between gap-3'>
                    <div className='text-xs font-medium uppercase tracking-wide text-gray-400'>
                      内容简介
                    </div>
                    {shouldCollapseDescription ? (
                      <span className='rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-emerald-200'>
                        {isDescriptionExpanded ? '收起' : '展开全文'}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className={
                      shouldCollapseDescription && !isDescriptionExpanded
                        ? 'line-clamp-6'
                        : ''
                    }
                  >
                    {content.desc}
                  </div>
                  {shouldCollapseDescription ? (
                    <div className='mt-3 text-xs text-emerald-200'>
                      {isDescriptionExpanded ? '点击收起简介' : '点击查看完整简介'}
                    </div>
                  ) : null}
                </button>
              ) : null}
            </div>
          </div>

          <div className='min-h-0 overflow-y-auto p-4 lg:p-6'>
            <div className='space-y-4'>
              {isMoreDownloadsOpen ? (
                <div className='rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4'>
                  <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
                    <div className='space-y-1'>
                      <div className='text-sm font-semibold text-white'>
                        未下载资源集
                      </div>
                      <div className='text-xs text-gray-400'>
                        点击剧集卡片可继续加入离线下载；已在队列中的剧集会显示当前状态。
                      </div>
                    </div>
                    {downloadableDetail ? (
                      <span className='inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-200'>
                        {moreDownloadEpisodeOptions.length} 集待处理
                      </span>
                    ) : null}
                  </div>

                  {isLoadingDownloadableDetail ? (
                    <div className='mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-6 text-sm text-gray-300'>
                      正在加载可下载剧集...
                    </div>
                  ) : null}

                  {!isLoadingDownloadableDetail && moreDownloadsError ? (
                    <div className='mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200'>
                      {moreDownloadsError}
                    </div>
                  ) : null}

                  {!isLoadingDownloadableDetail &&
                  !moreDownloadsError &&
                  downloadableDetail &&
                  moreDownloadEpisodeOptions.length === 0 ? (
                    <div className='mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-6 text-sm text-gray-300'>
                      当前内容的可下载剧集已全部缓存。
                    </div>
                  ) : null}

                  {!isLoadingDownloadableDetail &&
                  !moreDownloadsError &&
                  moreDownloadEpisodeOptions.length > 0 ? (
                    <div className='mt-4 max-h-[320px] overflow-y-auto pr-1'>
                      <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
                        {moreDownloadEpisodeOptions.map((episode) => (
                          <button
                            type='button'
                            key={`${content.contentId}-more-${episode.episodeIndex}`}
                            disabled={!episode.isActionable}
                            onClick={() =>
                              void handleStartMoreDownload(episode.episodeIndex)
                            }
                            className={`rounded-xl border p-3 text-left transition-colors ${
                              episode.isActionable
                                ? 'border-emerald-500/20 bg-black/20 hover:border-emerald-400/40 hover:bg-white/5'
                                : 'border-white/10 bg-black/20 text-gray-400'
                            }`}
                          >
                            <div className='flex items-start justify-between gap-3'>
                              <span className='rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] font-medium text-gray-200'>
                                {formatEpisodeCode(episode.episodeIndex)}
                              </span>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${getMoreDownloadEpisodeActionBadgeClassName(
                                  episode
                                )}`}
                              >
                                {getMoreDownloadEpisodeActionLabel(episode)}
                              </span>
                            </div>

                            <div
                              className='mt-4 truncate text-sm font-semibold text-white'
                              title={episode.episodeTitle}
                            >
                              {episode.episodeTitle}
                            </div>
                            <div className='mt-2 text-xs text-gray-400'>
                              {getMoreDownloadEpisodeStatus(episode)}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {moreDownloadsFeedback ? (
                    <div className='mt-3 text-xs text-emerald-200'>
                      {moreDownloadsFeedback}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className='grid gap-3 md:grid-cols-2 lg:grid-cols-3'>
                {content.episodes.map((episode) => {
                  const offlineHref = buildOfflinePlayHref({
                    content,
                    episodeIndex: episode.episodeIndex,
                  });
                  const isSelected = selectedEpisodeIndexSet.has(
                    episode.episodeIndex
                  );

                  return (
                    <button
                      type='button'
                      key={`${content.contentId}-${episode.episodeIndex}`}
                      onClick={() => {
                        if (isEditing) {
                          handleToggleEpisodeSelection(episode.episodeIndex);
                          return;
                        }

                        router.push(offlineHref);
                      }}
                      aria-pressed={isEditing ? isSelected : undefined}
                      aria-label={
                        isEditing
                          ? `${isSelected ? '取消选择' : '选择'} ${episode.episodeTitle}`
                          : `离线播放 ${episode.episodeTitle}`
                      }
                      className={`rounded-xl border p-3 text-left transition-colors ${
                        isEditing
                          ? isSelected
                            ? 'border-emerald-400/60 bg-emerald-500/10'
                            : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/5'
                          : 'border-white/10 bg-black/20 hover:border-emerald-400/30 hover:bg-white/5'
                      }`}
                    >
                      <div className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2'>
                        <div className='flex min-w-0 items-center gap-2'>
                          <span className='rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] font-medium text-gray-200'>
                            {formatEpisodeCode(episode.episodeIndex)}
                          </span>
                          <div
                            className='truncate text-sm font-semibold text-white'
                            title={episode.episodeTitle}
                          >
                            {episode.episodeTitle}
                          </div>
                        </div>

                        {isEditing ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              isSelected
                                ? 'border border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                                : 'border border-white/10 bg-white/5 text-gray-400'
                            }`}
                          >
                            {isSelected ? '已选' : '选择'}
                          </span>
                        ) : null}

                        <div className='col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-300'>
                          <span>{formatBytes(episode.sizeBytes)}</span>
                          <span>下载于 {formatDateTime(episode.downloadedAt)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function DownloadSettingsDialog({
  storageOrigin,
  isDevelopment,
  maxConcurrentTasks,
  onConcurrentTaskChange,
  onClose,
}: DownloadSettingsDialogProps) {
  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className='fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6'>
      <button
        type='button'
        aria-label='关闭下载设置'
        className='absolute inset-0 bg-black/75 backdrop-blur-sm'
        onClick={onClose}
      />

      <div className='relative z-[10001] flex max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#040b15]/95 text-white shadow-2xl shadow-black/50'>
        <div className='border-b border-white/10 px-5 py-5 lg:px-6'>
          <div className='flex items-start justify-between gap-4'>
            <div className='space-y-2'>
              <div className='text-xs font-medium uppercase tracking-[0.24em] text-emerald-300/80'>
                下载设置
              </div>
              <div className='text-2xl font-semibold text-white'>下载设置</div>
              <p className='text-sm text-gray-300'>
                调整下载并发，并确认离线内容的保存位置。
              </p>
            </div>

            <button
              type='button'
              onClick={onClose}
              className='rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10'
            >
              关闭
            </button>
          </div>
        </div>

        <div className='min-h-0 overflow-y-auto p-4 lg:p-6'>
          <div className='space-y-4'>
            <div className='rounded-2xl border border-white/10 bg-white/5 p-4'>
              <label
                htmlFor='download-concurrency'
                className='block text-base font-semibold text-white'
              >
                同时下载数量
              </label>
              <p className='mt-1 text-sm text-gray-400'>修改后立即生效。</p>
              <select
                id='download-concurrency'
                value={maxConcurrentTasks}
                onChange={onConcurrentTaskChange}
                className='mt-4 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-emerald-500'
              >
                {concurrentTaskOptions.map((value) => (
                  <option key={value} value={value}>
                    {value} 个任务
                  </option>
                ))}
              </select>
            </div>

            <div className='rounded-2xl border border-white/10 bg-white/5 p-4'>
              <div className='text-base font-semibold text-white'>
                离线保存位置
              </div>
              <div className='mt-3 inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-200'>
                当前浏览器离线缓存
              </div>
              <div className='mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4'>
                <div className='text-xs font-medium uppercase tracking-wide text-emerald-200'>
                  逻辑存储位置
                </div>
                <div className='mt-4 grid gap-3 text-xs text-gray-300'>
                  <div className='grid gap-1 sm:grid-cols-[88px_minmax(0,1fr)] sm:items-center'>
                    <span className='font-medium text-gray-200'>站点</span>
                    <code className='break-all rounded-lg bg-black/20 px-3 py-2 text-[11px] text-gray-100'>
                      {storageOrigin || '当前站点'}
                    </code>
                  </div>
                  <div className='grid gap-1 sm:grid-cols-[88px_minmax(0,1fr)] sm:items-center'>
                    <span className='font-medium text-gray-200'>Cache</span>
                    <code className='break-all rounded-lg bg-black/20 px-3 py-2 text-[11px] text-gray-100'>
                      {DOWNLOAD_CACHE_NAME}
                    </code>
                  </div>
                  <div className='grid gap-1 sm:grid-cols-[88px_minmax(0,1fr)] sm:items-center'>
                    <span className='font-medium text-gray-200'>IndexedDB</span>
                    <code className='break-all rounded-lg bg-black/20 px-3 py-2 text-[11px] text-gray-100'>
                      {DOWNLOAD_RESOURCE_DB_NAME}
                    </code>
                  </div>
                  <div className='grid gap-1 sm:grid-cols-[88px_minmax(0,1fr)] sm:items-center'>
                    <span className='font-medium text-gray-200'>对象仓库</span>
                    <code className='break-all rounded-lg bg-black/20 px-3 py-2 text-[11px] text-gray-100'>
                      {DOWNLOAD_RESOURCE_STORE_NAME}
                    </code>
                  </div>
                </div>
              </div>
              <p className='mt-4 text-xs leading-5 text-gray-400'>
                实际磁盘位置由浏览器站点沙箱托管，Web 版暂不支持直接显示系统路径、打开系统文件夹或自定义磁盘目录。
              </p>
              {isDevelopment && (
                <p className='mt-2 text-xs leading-5 text-amber-300'>
                  本地验证离线播放时，请使用独立预览模式；开发模式不会提供完整的离线缓存链路。
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function DownloadsClient() {
  const searchParams = useSearchParams();
  const [actionError, setActionError] = useState<string | null>(null);
  const [storageOrigin, setStorageOrigin] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedActiveTaskContentId, setSelectedActiveTaskContentId] =
    useState<string | null>(null);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(
    null
  );
  const isDevelopment = process.env.NODE_ENV === 'development';
  const hasHydrated = useDownloadStore((state) => state.hasHydrated);
  const tasks = useDownloadStore((state) => state.tasks);
  const maxConcurrentTasks = useDownloadStore(
    (state) => state.maxConcurrentTasks
  );
  const setMaxConcurrentTasks = useDownloadStore(
    (state) => state.setMaxConcurrentTasks
  );
  const activeTaskGroups = useMemo(
    () => buildActiveTaskGroups(tasks),
    [tasks]
  );
  const selectedActiveTaskGroup = useMemo(
    () =>
      selectedActiveTaskContentId
        ? activeTaskGroups.find(
            (group) => group.contentId === selectedActiveTaskContentId
          ) || null
        : null,
    [activeTaskGroups, selectedActiveTaskContentId]
  );
  const selectedContent = useDownloadStore((state) =>
    selectedContentId ? state.library[selectedContentId] || null : null
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setStorageOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (selectedContentId && !selectedContent) {
      setSelectedContentId(null);
    }
  }, [selectedContentId, selectedContent]);

  useEffect(() => {
    if (selectedActiveTaskContentId && !selectedActiveTaskGroup) {
      setSelectedActiveTaskContentId(null);
    }
  }, [selectedActiveTaskContentId, selectedActiveTaskGroup]);

  useEffect(() => {
    if (
      !isSettingsOpen &&
      !selectedContentId &&
      !selectedActiveTaskContentId
    ) {
      return;
    }
    if (typeof document === 'undefined') {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (selectedContentId) {
          setSelectedContentId(null);
          return;
        }
        if (selectedActiveTaskContentId) {
          setSelectedActiveTaskContentId(null);
          return;
        }
        setIsSettingsOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSettingsOpen, selectedContentId, selectedActiveTaskContentId]);

  const handleDeleteEpisode = async (
    contentId: string,
    episodeIndex: number
  ) => {
    try {
      setActionError(null);
      await downloadManager.deleteEpisode(contentId, episodeIndex);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : '删除离线文件失败'
      );
    }
  };

  const handleConcurrentTaskChange = (
    event: ChangeEvent<HTMLSelectElement>
  ) => {
    const nextValue = Number(event.target.value);
    setMaxConcurrentTasks(nextValue);
    downloadManager.refreshScheduling();
  };

  const handleOpenActiveTaskContent = (contentId: string) => {
    setSelectedContentId(null);
    setSelectedActiveTaskContentId(contentId);
  };

  const handleCloseActiveTaskContent = () => {
    setSelectedActiveTaskContentId(null);
  };

  const handleOpenDownloadedContent = (contentId: string) => {
    setSelectedActiveTaskContentId(null);
    setSelectedContentId(contentId);
  };

  const handleCloseDownloadedContent = () => {
    setSelectedContentId(null);
  };

  const handleOpenSettings = () => {
    setIsSettingsOpen(true);
  };

  const handleCloseSettings = () => {
    setIsSettingsOpen(false);
  };

  if (!hasHydrated) {
    return (
      <div className='mx-auto flex min-h-[60vh] max-w-5xl items-center justify-center px-5 py-8'>
        <div className='text-sm text-gray-600 dark:text-gray-400'>
          正在加载离线下载数据...
        </div>
      </div>
    );
  }

  return (
    <div className='mx-auto flex max-w-6xl flex-col gap-6 px-5 py-6 lg:px-12 2xl:px-20'>
      <div className='space-y-2'>
        <div className='flex items-start justify-between gap-4'>
          <h1 className='text-2xl font-semibold text-gray-900 dark:text-gray-100'>
            下载管理
          </h1>
          <button
            type='button'
            onClick={handleOpenSettings}
            className='inline-flex shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white/85 px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-200 dark:hover:bg-gray-900'
          >
            <Settings2 className='h-4 w-4' />
            下载设置
          </button>
        </div>
        <p className='text-sm text-gray-600 dark:text-gray-400'>
          管理当前下载任务，并在断网时播放已缓存的剧集。
        </p>
      </div>

      {searchParams.get('error') === 'missing' && (
        <div className='rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300'>
          离线文件缺失或缓存已被系统清理，请重新下载。
        </div>
      )}

      {actionError && (
        <div className='rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400'>
          {actionError}
        </div>
      )}

      <ActiveTasksSection
        activeTaskGroups={activeTaskGroups}
        activeContentId={selectedActiveTaskContentId}
        onOpenContent={handleOpenActiveTaskContent}
      />

      <DownloadedContentsSection
        activeContentId={selectedContentId}
        onOpenContent={handleOpenDownloadedContent}
      />

      {selectedActiveTaskGroup ? (
        <ActiveTaskDialog
          group={selectedActiveTaskGroup}
          onClose={handleCloseActiveTaskContent}
        />
      ) : null}

      {selectedContent ? (
        <DownloadedContentDialog
          content={selectedContent}
          onClose={handleCloseDownloadedContent}
          onDeleteEpisode={handleDeleteEpisode}
        />
      ) : null}

      {isSettingsOpen ? (
        <DownloadSettingsDialog
          storageOrigin={storageOrigin}
          isDevelopment={isDevelopment}
          maxConcurrentTasks={maxConcurrentTasks}
          onConcurrentTaskChange={handleConcurrentTaskChange}
          onClose={handleCloseSettings}
        />
      ) : null}
    </div>
  );
}
