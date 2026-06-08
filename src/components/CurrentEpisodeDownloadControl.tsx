'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { isOfflineDownloadSupported } from '@/lib/download/cache';
import {
  formatTaskSizeProgress,
  formatTransferRate,
  getDownloadStatusLabel,
} from '@/lib/download/format';
import { downloadManager } from '@/lib/download/manager';
import {
  buildOfflinePlayHref,
  getDownloadedEpisodeMeta,
} from '@/lib/download/offline';
import {
  buildDownloadContentId,
  buildDownloadTaskId,
  DownloadTask,
} from '@/lib/download/types';
import { SearchResult } from '@/lib/types';

import { useDownloadStore } from '@/stores/downloadStore';

interface CurrentEpisodeDownloadControlProps {
  detail: SearchResult;
  availableSources?: SearchResult[];
  episodeIndex: number;
  isOfflineMode?: boolean;
}

interface BatchEpisodeOption {
  episodeIndex: number;
  episodeTitle: string;
  hasSource: boolean;
  isCurrent: boolean;
  isDownloaded: boolean;
  isSelectable: boolean;
  task?: DownloadTask;
}

const BATCH_EPISODES_PER_PAGE = 50;

function normalizeEpisodeSelection(indexes: number[]): number[] {
  return Array.from(new Set(indexes)).sort((left, right) => left - right);
}

function buildEpisodePageRanges(
  totalEpisodes: number,
  episodesPerPage: number
): Array<{ start: number; end: number }> {
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);

  return Array.from({ length: pageCount }, (_, pageIndex) => {
    const start = pageIndex * episodesPerPage + 1;
    const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
    return { start, end };
  });
}

function getBatchFeedbackMessage(
  queuedCount: number,
  skippedCount: number
): string {
  const parts: string[] = [];

  if (queuedCount > 0) {
    parts.push(`已加入 ${queuedCount} 集`);
  }

  if (skippedCount > 0) {
    parts.push(`跳过 ${skippedCount} 集`);
  }

  if (parts.length === 0) {
    return '没有可加入的剧集。';
  }

  const suffix = skippedCount > 0 ? '（已下载、已在队列中或当前不可下载）' : '';

  return `${parts.join('，')}${suffix}。`;
}

function getEpisodeTaskStatusText(option: BatchEpisodeOption): string {
  if (!option.hasSource) {
    return '不可下载';
  }

  if (option.isDownloaded) {
    return '已下载';
  }

  switch (option.task?.status) {
    case 'downloading':
      return '下载中';
    case 'queued':
      return '排队中';
    case 'paused':
      return '已暂停';
    case 'error':
      return '下载失败';
    default:
      return '可下载';
  }
}

function getEpisodeButtonClassName(params: {
  option: BatchEpisodeOption;
  isSelected: boolean;
}): string {
  const { option, isSelected } = params;

  if (!option.hasSource) {
    return 'border-gray-200 bg-gray-100/80 text-gray-400 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-600 cursor-not-allowed';
  }

  if (option.isDownloaded) {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 cursor-not-allowed';
  }

  if (option.task?.status === 'downloading') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300 cursor-not-allowed';
  }

  if (option.task?.status === 'queued') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 cursor-not-allowed';
  }

  if (isSelected) {
    return 'border-emerald-500 bg-emerald-500/20 text-emerald-900 shadow-lg shadow-emerald-500/10 dark:text-emerald-50';
  }

  if (option.task?.status === 'error') {
    return 'border-red-500/30 bg-red-500/5 text-red-700 hover:border-red-400 hover:bg-red-500/10 dark:text-red-300';
  }

  if (option.task?.status === 'paused') {
    return 'border-orange-500/30 bg-orange-500/5 text-orange-700 hover:border-orange-400 hover:bg-orange-500/10 dark:text-orange-300';
  }

  return 'border-gray-200 bg-white/90 text-gray-800 hover:border-emerald-400 hover:bg-emerald-50 dark:border-gray-800 dark:bg-gray-950/70 dark:text-gray-100 dark:hover:bg-emerald-950/20';
}

export default function CurrentEpisodeDownloadControl({
  detail,
  availableSources = [],
  episodeIndex,
  isOfflineMode = false,
}: CurrentEpisodeDownloadControlProps) {
  const contentId = buildDownloadContentId(detail.source, detail.id);
  const taskId = buildDownloadTaskId(contentId, episodeIndex);
  const totalEpisodes = detail.episodes.length;
  const [actionError, setActionError] = useState<string | null>(null);
  const [batchFeedback, setBatchFeedback] = useState<string | null>(null);
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [isStartingBatchDownload, setIsStartingBatchDownload] = useState(false);
  const [batchCurrentPage, setBatchCurrentPage] = useState(() =>
    Math.floor(episodeIndex / BATCH_EPISODES_PER_PAGE)
  );
  const [isBatchDescending, setIsBatchDescending] = useState(false);
  const [selectedEpisodeIndexes, setSelectedEpisodeIndexes] = useState<
    number[]
  >([]);

  const tasks = useDownloadStore((state) => state.tasks);
  const task = useDownloadStore((state) => state.tasks[taskId]);
  const content = useDownloadStore((state) => state.library[contentId]);
  const downloadedEpisode = getDownloadedEpisodeMeta(content, episodeIndex);

  const downloadedEpisodeIndexes = new Set(
    content?.episodes.map((episode) => episode.episodeIndex) || []
  );

  const episodeOptions: BatchEpisodeOption[] = detail.episodes.map(
    (episodeUrl, targetEpisodeIndex) => {
      const targetTaskId = buildDownloadTaskId(contentId, targetEpisodeIndex);
      const episodeTask = tasks[targetTaskId];
      const isDownloaded =
        downloadedEpisodeIndexes.has(targetEpisodeIndex) ||
        episodeTask?.status === 'done';
      const isSelectable =
        Boolean(episodeUrl) &&
        !isDownloaded &&
        (!episodeTask || ['paused', 'error'].includes(episodeTask.status));

      return {
        episodeIndex: targetEpisodeIndex,
        episodeTitle:
          detail.episodes_titles[targetEpisodeIndex] ||
          `第 ${targetEpisodeIndex + 1} 集`,
        hasSource: Boolean(episodeUrl),
        isCurrent: targetEpisodeIndex === episodeIndex,
        isDownloaded,
        isSelectable,
        task: episodeTask,
      };
    }
  );

  const selectableEpisodeIndexes = episodeOptions
    .filter((option) => option.isSelectable)
    .map((option) => option.episodeIndex);
  const selectableEpisodeIndexesKey = selectableEpisodeIndexes.join(',');
  const selectedEpisodeSet = new Set(selectedEpisodeIndexes);
  const selectedCount = selectedEpisodeIndexes.length;
  const selectableCount = selectableEpisodeIndexes.length;
  const downloadedCount = episodeOptions.filter(
    (option) => option.isDownloaded
  ).length;
  const activeCount = episodeOptions.filter((option) =>
    ['downloading', 'queued'].includes(option.task?.status || '')
  ).length;
  const pausedOrFailedCount = episodeOptions.filter((option) =>
    ['paused', 'error'].includes(option.task?.status || '')
  ).length;

  const pageRanges = buildEpisodePageRanges(
    totalEpisodes,
    BATCH_EPISODES_PER_PAGE
  );
  const pageCount = pageRanges.length;
  const displayedPageIndex = isBatchDescending
    ? pageCount - 1 - batchCurrentPage
    : batchCurrentPage;
  const pageLabels = isBatchDescending
    ? [...pageRanges].reverse().map(({ start, end }) => `${end}-${start}`)
    : pageRanges.map(({ start, end }) => `${start}-${end}`);

  const currentPageStartIndex = batchCurrentPage * BATCH_EPISODES_PER_PAGE;
  const currentPageEndIndex = Math.min(
    currentPageStartIndex + BATCH_EPISODES_PER_PAGE,
    totalEpisodes
  );
  const visibleEpisodeOptions = episodeOptions.slice(
    currentPageStartIndex,
    currentPageEndIndex
  );
  if (isBatchDescending) {
    visibleEpisodeOptions.reverse();
  }

  useEffect(() => {
    setActionError(null);
    setBatchFeedback(null);
    setIsBatchDialogOpen(false);
    setIsStartingBatchDownload(false);
    setBatchCurrentPage(Math.floor(episodeIndex / BATCH_EPISODES_PER_PAGE));
    setIsBatchDescending(false);
    setSelectedEpisodeIndexes([]);
  }, [detail.id, detail.source, episodeIndex]);

  useEffect(() => {
    if (!isBatchDialogOpen || typeof document === 'undefined') {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsBatchDialogOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isBatchDialogOpen]);

  useEffect(() => {
    if (!isBatchDialogOpen) {
      return;
    }

    const nextSelectableEpisodeIndexes = selectableEpisodeIndexesKey
      ? selectableEpisodeIndexesKey.split(',').map((value) => Number(value))
      : [];
    const selectableEpisodeSet = new Set(nextSelectableEpisodeIndexes);
    setSelectedEpisodeIndexes((previousIndexes) => {
      const nextIndexes = previousIndexes.filter((targetEpisodeIndex) =>
        selectableEpisodeSet.has(targetEpisodeIndex)
      );

      return nextIndexes.length === previousIndexes.length
        ? previousIndexes
        : nextIndexes;
    });
  }, [isBatchDialogOpen, selectableEpisodeIndexesKey]);

  if (!detail.episodes[episodeIndex]) {
    return null;
  }

  if (!isOfflineDownloadSupported()) {
    return (
      <div className='rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-300'>
        当前浏览器不支持离线下载。
      </div>
    );
  }

  const canBatchDownload = !isOfflineMode && totalEpisodes > 1;

  const handleOpenBatchDialog = () => {
    const defaultSelection = episodeOptions[episodeIndex]?.isSelectable
      ? [episodeIndex]
      : [];

    setActionError(null);
    setBatchFeedback(null);
    setBatchCurrentPage(Math.floor(episodeIndex / BATCH_EPISODES_PER_PAGE));
    setIsBatchDescending(false);
    setSelectedEpisodeIndexes(defaultSelection);
    setIsBatchDialogOpen(true);
  };

  const handleCloseBatchDialog = () => {
    if (isStartingBatchDownload) {
      return;
    }

    setIsBatchDialogOpen(false);
  };

  const handleStart = async () => {
    try {
      setActionError(null);
      setBatchFeedback(null);
      await downloadManager.startEpisodeDownload({
        detail,
        episodeIndex,
        availableSources,
      });
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : '离线下载启动失败'
      );
    }
  };

  const handlePause = async () => {
    try {
      setActionError(null);
      await downloadManager.pauseTask(taskId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '暂停下载失败');
    }
  };

  const handleResume = async () => {
    try {
      setActionError(null);
      await downloadManager.resumeTask(taskId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '恢复下载失败');
    }
  };

  const handleCancel = async () => {
    try {
      setActionError(null);
      await downloadManager.cancelTask(taskId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '取消下载失败');
    }
  };

  const handleDelete = async () => {
    try {
      setActionError(null);
      await downloadManager.deleteEpisode(contentId, episodeIndex);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : '删除离线文件失败'
      );
    }
  };

  const handleToggleEpisodeSelection = (targetEpisodeIndex: number) => {
    const option = episodeOptions[targetEpisodeIndex];
    if (!option?.isSelectable) {
      return;
    }

    setSelectedEpisodeIndexes((previousIndexes) => {
      const previousIndexSet = new Set(previousIndexes);
      if (previousIndexSet.has(targetEpisodeIndex)) {
        previousIndexSet.delete(targetEpisodeIndex);
      } else {
        previousIndexSet.add(targetEpisodeIndex);
      }

      return normalizeEpisodeSelection(Array.from(previousIndexSet));
    });
  };

  const handleSelectAll = () => {
    setSelectedEpisodeIndexes(selectableEpisodeIndexes);
  };

  const handleSelectFromCurrent = () => {
    setSelectedEpisodeIndexes(
      selectableEpisodeIndexes.filter(
        (targetEpisodeIndex) => targetEpisodeIndex >= episodeIndex
      )
    );
  };

  const handleInvertSelection = () => {
    setSelectedEpisodeIndexes((previousIndexes) => {
      const previousIndexSet = new Set(previousIndexes);
      return selectableEpisodeIndexes.filter(
        (targetEpisodeIndex) => !previousIndexSet.has(targetEpisodeIndex)
      );
    });
  };

  const handleClearSelection = () => {
    setSelectedEpisodeIndexes([]);
  };

  const handleChangeBatchPage = (displayIndex: number) => {
    if (isBatchDescending) {
      setBatchCurrentPage(pageCount - 1 - displayIndex);
      return;
    }

    setBatchCurrentPage(displayIndex);
  };

  const handleStartBatchDownload = async () => {
    if (selectedCount === 0) {
      setActionError('请先选择要下载的剧集');
      return;
    }

    try {
      setActionError(null);
      setIsStartingBatchDownload(true);

      const result = await downloadManager.startBatchEpisodeDownloads({
        detail,
        episodeIndexes: selectedEpisodeIndexes,
        availableSources,
      });

      setBatchFeedback(
        `批量下载：${getBatchFeedbackMessage(
          result.queuedCount,
          result.skippedCount
        )}`
      );
      setIsBatchDialogOpen(false);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : '批量下载启动失败'
      );
    } finally {
      setIsStartingBatchDownload(false);
    }
  };

  const batchDialog = (
    <div className='fixed inset-0 z-[10000] flex items-center justify-center p-4'>
      <button
        type='button'
        aria-label='关闭批量下载弹窗'
        className='absolute inset-0 bg-black/70 backdrop-blur-sm'
        onClick={handleCloseBatchDialog}
      />

      <div className='relative z-[10001] flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#04110d] text-white shadow-2xl shadow-black/40'>
        <div className='border-b border-white/10 px-5 py-5 lg:px-6'>
          <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
            <div className='space-y-2'>
              <div className='text-xs font-medium uppercase tracking-[0.24em] text-emerald-300/80'>
                批量下载
              </div>
              <div className='text-2xl font-semibold text-white'>
                {detail.title}
              </div>
              <div className='text-sm text-gray-300'>
                自由选择要加入离线下载的剧集。已选 {selectedCount} 集，可选{' '}
                {selectableCount} 集。
              </div>
            </div>

            <div className='flex items-center gap-2 self-start'>
              <button
                type='button'
                onClick={handleCloseBatchDialog}
                className='rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10'
              >
                关闭
              </button>
            </div>
          </div>

          <div className='mt-4 flex flex-wrap gap-2 text-xs'>
            <span className='rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-200'>
              已下载 {downloadedCount}
            </span>
            <span className='rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-sky-200'>
              进行中 {activeCount}
            </span>
            <span className='rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-orange-200'>
              可恢复 {pausedOrFailedCount}
            </span>
            <span className='rounded-full border border-white/10 bg-white/5 px-3 py-1 text-gray-300'>
              当前集 {episodeIndex + 1}
            </span>
          </div>
        </div>

        <div className='flex-1 overflow-y-auto px-5 py-5 lg:px-6'>
          <div className='space-y-5'>
            <div className='flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-4'>
              <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
                <div className='space-y-1'>
                  <div className='text-sm font-medium text-white'>
                    快速选择
                  </div>
                  <div className='text-xs text-gray-400'>
                    支持全选、反选、从当前集起选择，也可以直接逐集点选。
                  </div>
                </div>

                <div className='flex flex-wrap gap-2'>
                  <button
                    type='button'
                    onClick={handleSelectAll}
                    disabled={selectableCount === 0}
                    className='rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-gray-500'
                  >
                    全选可下载
                  </button>
                  <button
                    type='button'
                    onClick={handleSelectFromCurrent}
                    disabled={selectableCount === 0}
                    className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-gray-500'
                  >
                    从当前集起
                  </button>
                  <button
                    type='button'
                    onClick={handleInvertSelection}
                    disabled={selectableCount === 0}
                    className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-gray-500'
                  >
                    反选
                  </button>
                  <button
                    type='button'
                    onClick={handleClearSelection}
                    disabled={selectedCount === 0}
                    className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-gray-500'
                  >
                    清空
                  </button>
                </div>
              </div>

              {pageCount > 1 && (
                <div className='flex items-center gap-3 border-t border-white/10 pt-4'>
                  <div className='flex-1 overflow-x-auto'>
                    <div className='flex min-w-max gap-2'>
                      {pageLabels.map((label, displayIndex) => {
                        const isActive = displayIndex === displayedPageIndex;

                        return (
                          <button
                            key={label}
                            type='button'
                            onClick={() =>
                              handleChangeBatchPage(displayIndex)
                            }
                            className={`relative rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                              isActive
                                ? 'bg-emerald-500/15 text-emerald-200'
                                : 'text-gray-400 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            {label}
                            {isActive && (
                              <span className='absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-emerald-400' />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type='button'
                    onClick={() =>
                      setIsBatchDescending((previous) => !previous)
                    }
                    className='flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-200 transition-colors hover:bg-white/10'
                    title='切换正序/倒序'
                  >
                    <svg
                      className='h-4 w-4'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth='2'
                        d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'
                      />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              {visibleEpisodeOptions.map((option) => {
                const isSelected = selectedEpisodeSet.has(option.episodeIndex);

                return (
                  <button
                    key={`${contentId}-${option.episodeIndex}`}
                    type='button'
                    disabled={!option.isSelectable}
                    onClick={() =>
                      handleToggleEpisodeSelection(option.episodeIndex)
                    }
                    className={`flex min-h-[112px] flex-col items-start rounded-2xl border px-4 py-4 text-left transition-all ${getEpisodeButtonClassName(
                      {
                        option,
                        isSelected,
                      }
                    )}`}
                  >
                    <div className='flex w-full items-start justify-between gap-2'>
                      <div className='text-xs font-medium uppercase tracking-[0.18em] opacity-70'>
                        EP {String(option.episodeIndex + 1).padStart(2, '0')}
                      </div>

                      <div className='flex flex-wrap justify-end gap-1'>
                        {option.isCurrent && (
                          <span className='rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] font-medium text-current'>
                            当前
                          </span>
                        )}
                        {isSelected && (
                          <span className='rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-100'>
                            已选
                          </span>
                        )}
                      </div>
                    </div>

                    <div className='mt-4 w-full'>
                      <div className='truncate text-base font-semibold text-current'>
                        {option.episodeTitle}
                      </div>
                      <div className='mt-2 text-xs opacity-70'>
                        {getEpisodeTaskStatusText(option)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {visibleEpisodeOptions.length === 0 && (
              <div className='rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center text-sm text-gray-400'>
                当前没有可显示的剧集。
              </div>
            )}
          </div>
        </div>

        <div className='border-t border-white/10 px-5 py-4 lg:px-6'>
          <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
            <div className='space-y-2'>
              <div className='text-sm text-gray-300'>
                已选 {selectedCount} 集。
                {selectedCount > 0 &&
                  ' 点击“开始下载”后会按队列顺序依次下载。'}
              </div>
              {actionError && (
                <div className='text-sm text-red-300'>{actionError}</div>
              )}
            </div>

            <div className='flex flex-wrap gap-2'>
              <button
                type='button'
                onClick={handleCloseBatchDialog}
                disabled={isStartingBatchDownload}
                className='rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-gray-500'
              >
                取消
              </button>
              <button
                type='button'
                onClick={handleStartBatchDownload}
                disabled={selectedCount === 0 || isStartingBatchDownload}
                className='rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400'
              >
                {isStartingBatchDownload
                  ? '正在加入队列...'
                  : `开始下载 ${selectedCount > 0 ? selectedCount : ''}`.trim()}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className='rounded-xl border border-emerald-200/80 bg-emerald-50/80 px-4 py-4 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/10'>
        <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
          <div className='space-y-1'>
            <div className='text-sm font-medium text-emerald-700 dark:text-emerald-300'>
              离线下载
            </div>
            <div className='text-sm text-gray-700 dark:text-gray-300'>
              {detail.episodes_titles[episodeIndex] ||
                `第 ${episodeIndex + 1} 集`}
            </div>
            {task && (
              <div className='space-y-1 text-xs text-gray-600 dark:text-gray-400'>
                <div>
                  {getDownloadStatusLabel(task.status)}
                  {task.totalResources > 0 &&
                    ` · ${task.downloadedResources}/${task.totalResources}`}
                </div>
                <div>
                  {formatTaskSizeProgress(task)}
                  {task.status === 'downloading' &&
                    ` · ${formatTransferRate(task.downloadSpeedBytesPerSecond)}`}
                </div>
              </div>
            )}
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            {downloadedEpisode && content && (
              <Link
                href={buildOfflinePlayHref({
                  content,
                  episodeIndex,
                })}
                className='inline-flex items-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700'
              >
                {isOfflineMode ? '当前为离线播放' : '离线播放'}
              </Link>
            )}

            {!downloadedEpisode && !task && !isOfflineMode && (
              <button
                type='button'
                onClick={handleStart}
                className='inline-flex items-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700'
              >
                下载当前集
              </button>
            )}

            {task?.status === 'downloading' && (
              <button
                type='button'
                onClick={handlePause}
                className='inline-flex items-center rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/20'
              >
                暂停下载
              </button>
            )}

            {task?.status === 'queued' && (
              <span className='inline-flex cursor-default items-center rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400'>
                排队中
              </span>
            )}

            {task?.status === 'paused' && (
              <button
                type='button'
                onClick={handleResume}
                className='inline-flex items-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700'
              >
                继续下载
              </button>
            )}

            {task?.status === 'error' && (
              <button
                type='button'
                onClick={handleResume}
                className='inline-flex items-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700'
              >
                重试下载
              </button>
            )}

            {canBatchDownload && (
              <button
                type='button'
                onClick={handleOpenBatchDialog}
                className='inline-flex items-center rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/20'
              >
                批量下载
              </button>
            )}

            {task && task.status !== 'done' && (
              <button
                type='button'
                onClick={handleCancel}
                className='inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/10'
              >
                取消
              </button>
            )}

            {downloadedEpisode && (
              <button
                type='button'
                onClick={handleDelete}
                className='inline-flex items-center rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/20'
              >
                删除离线文件
              </button>
            )}
          </div>
        </div>

        {task && task.totalResources > 0 && (
          <div className='mt-3 h-2 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-950/40'>
            <div
              className='h-full rounded-full bg-emerald-500 transition-all'
              style={{ width: `${task.progress}%` }}
            />
          </div>
        )}

        {batchFeedback && (
          <div className='mt-3 text-xs text-emerald-700 dark:text-emerald-300'>
            {batchFeedback}
          </div>
        )}

        {actionError && (
          <div className='mt-3 text-xs text-red-600 dark:text-red-400'>
            {actionError}
          </div>
        )}

        {task?.errorMessage && task.status === 'error' && (
          <div className='mt-2 text-xs text-red-600 dark:text-red-400'>
            {task.errorMessage}
          </div>
        )}
      </div>

      {isBatchDialogOpen &&
        typeof document !== 'undefined' &&
        createPortal(batchDialog, document.body)}
    </>
  );
}
