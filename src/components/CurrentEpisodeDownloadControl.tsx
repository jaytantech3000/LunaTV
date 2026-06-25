'use client';

import { Info } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { getOfflineDownloadSupportState } from '@/lib/download/cache';
import { downloadClient } from '@/lib/download/client';
import { resolveDownloadablePlaybackSources } from '@/lib/download/downloadable';
import {
  formatBytes,
  formatTaskSizeProgress,
  formatTransferRate,
  getDownloadStatusLabel,
} from '@/lib/download/format';
import {
  buildOfflinePlayHref,
  getDownloadedEpisodeMeta,
} from '@/lib/download/offline';
import {
  buildDownloadContentId,
  buildDownloadTaskId,
} from '@/lib/download/types';
import { SearchResult } from '@/lib/types';
import { isAdultContentResult } from '@/lib/yellow';

import BatchEpisodeDownloadDialog from '@/components/BatchEpisodeDownloadDialog';

import { useDownloadStore } from '@/stores/downloadStore';

interface CurrentEpisodeDownloadControlProps {
  detail: SearchResult;
  availableSources?: SearchResult[];
  episodeIndex: number;
  downloadEpisodeIndex?: number;
  isOfflineMode?: boolean;
  searchTitle?: string;
  searchType?: string;
  compact?: boolean;
}

export default function CurrentEpisodeDownloadControl({
  detail,
  availableSources = [],
  episodeIndex,
  downloadEpisodeIndex,
  isOfflineMode = false,
  searchTitle,
  searchType,
  compact = false,
}: CurrentEpisodeDownloadControlProps) {
  const targetEpisodeIndex =
    typeof downloadEpisodeIndex === 'number'
      ? downloadEpisodeIndex
      : episodeIndex;
  const contentId = buildDownloadContentId(detail.source, detail.id);
  const taskId = buildDownloadTaskId(contentId, targetEpisodeIndex);

  const [actionError, setActionError] = useState<string | null>(null);
  const [batchFeedback, setBatchFeedback] = useState<string | null>(null);
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [isPreparingBatchDialog, setIsPreparingBatchDialog] = useState(false);
  const [isCompactPanelOpen, setIsCompactPanelOpen] = useState(false);
  const [downloadDialogDetail, setDownloadDialogDetail] =
    useState<SearchResult | null>(null);
  const [downloadDialogAvailableSources, setDownloadDialogAvailableSources] =
    useState<SearchResult[]>([]);
  const [downloadSupport, setDownloadSupport] = useState<ReturnType<
    typeof getOfflineDownloadSupportState
  > | null>(null);
  const compactPanelRef = useRef<HTMLDivElement | null>(null);
  const compactPanelSurfaceRef = useRef<HTMLDivElement | null>(null);
  const compactTriggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const [compactPanelPosition, setCompactPanelPosition] = useState<{
    right: number;
    top: number;
  } | null>(null);

  const task = useDownloadStore((state) => state.tasks[taskId]);
  const content = useDownloadStore((state) => state.library[contentId]);
  const downloadedEpisode = getDownloadedEpisodeMeta(
    content,
    targetEpisodeIndex
  );

  useEffect(() => {
    setDownloadSupport(getOfflineDownloadSupportState());
  }, []);

  useEffect(() => {
    setActionError(null);
    setBatchFeedback(null);
    setIsBatchDialogOpen(false);
    setIsPreparingBatchDialog(false);
    setIsCompactPanelOpen(false);
    setDownloadDialogDetail(null);
    setDownloadDialogAvailableSources([]);
  }, [
    detail.id,
    detail.source,
    episodeIndex,
    searchTitle,
    searchType,
    targetEpisodeIndex,
  ]);

  const updateCompactPanelPosition = useCallback(() => {
    if (!compactTriggerButtonRef.current || typeof window === 'undefined') {
      return;
    }

    const triggerRect = compactTriggerButtonRef.current.getBoundingClientRect();
    setCompactPanelPosition({
      top: triggerRect.bottom + 8,
      right: Math.max(16, window.innerWidth - triggerRect.right),
    });
  }, []);

  useEffect(() => {
    if (!compact || !isCompactPanelOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        compactPanelRef.current?.contains(event.target as Node) ||
        compactPanelSurfaceRef.current?.contains(event.target as Node)
      ) {
        return;
      }

      setIsCompactPanelOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsCompactPanelOpen(false);
      }
    };

    updateCompactPanelPosition();

    const handleViewportChange = () => {
      updateCompactPanelPosition();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [compact, isCompactPanelOpen, updateCompactPanelPosition]);

  if (!detail.episodes[episodeIndex]) {
    return null;
  }

  if (!downloadSupport) {
    return null;
  }

  if (!downloadSupport.supported) {
    return (
      <div className='rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-300'>
        {downloadSupport.reason || '当前环境不支持离线下载。'}
      </div>
    );
  }

  const shouldAllowAdultPlayback = isAdultContentResult({
    title: detail.title,
    source_name: detail.source_name,
    desc: detail.desc,
    type_name: detail.type_name,
  });
  const batchDialogDetail = isOfflineMode
    ? downloadDialogDetail || detail
    : detail;
  const batchDialogAvailableSources = isOfflineMode
    ? downloadDialogAvailableSources
    : availableSources;
  const batchDialogEpisodeIndex = isOfflineMode
    ? targetEpisodeIndex
    : episodeIndex;
  const downloadDialogLabel = isOfflineMode
    ? '下载更多'
    : detail.episodes.length > 1
    ? '下载剧集'
    : '下载选项';
  const episodeLabel =
    detail.episodes_titles[episodeIndex] || `第 ${episodeIndex + 1} 集`;
  const filledButtonClassName =
    'inline-flex items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50';
  const secondaryButtonClassName =
    'inline-flex items-center justify-center rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/20';
  const neutralButtonClassName =
    'inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/10';
  const dangerButtonClassName =
    'inline-flex items-center justify-center rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/20';
  const compactPanelTitle = isOfflineMode ? '离线下载详情' : '下载详情';
  const compactButtonLabel = isCompactPanelOpen
    ? `收起${compactPanelTitle}`
    : `查看${compactPanelTitle}`;
  const compactPanelClassName =
    'fixed isolate z-[10020] w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-[#1d2738] bg-[#05070c] p-4 opacity-100 shadow-[0_24px_80px_rgba(0,0,0,0.72)] sm:w-96';
  const compactIndicatorClassName =
    task?.status === 'error'
      ? 'bg-red-400'
      : task?.status === 'downloading'
      ? 'bg-sky-400 animate-pulse'
      : task?.status === 'paused'
      ? 'bg-amber-400'
      : downloadedEpisode
      ? 'bg-emerald-400'
      : 'bg-gray-400';
  const conciseEpisodeLabel =
    episodeLabel.trim() === '全集' ? '当前内容' : episodeLabel;
  const standardStatusLabel = task
    ? getDownloadStatusLabel(task.status)
    : downloadedEpisode
    ? '已缓存'
    : '未缓存';
  const standardStatusClassName =
    task?.status === 'error'
      ? 'border-red-200/80 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300'
      : task?.status === 'paused'
      ? 'border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300'
      : task?.status === 'downloading'
      ? 'border-sky-200/80 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300'
      : task?.status === 'queued'
      ? 'border-gray-200/80 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300'
      : downloadedEpisode || task?.status === 'done'
      ? 'border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300'
      : 'border-gray-200/80 bg-white/80 text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300';
  const standardSummary = task
    ? `${
        task.totalResources > 0
          ? `${task.downloadedResources}/${task.totalResources} 个资源`
          : `${task.progress}%`
      } · ${formatTaskSizeProgress(task)}${
        task.status === 'downloading'
          ? ` · ${formatTransferRate(task.downloadSpeedBytesPerSecond)}`
          : ''
      }`
    : downloadedEpisode
    ? `${formatBytes(downloadedEpisode.sizeBytes)} · ${
        downloadedEpisode.resourceCount
      } 个资源已缓存`
    : detail.episodes.length > 1
    ? '可缓存当前集，也可从下载选项批量选择剧集。'
    : '可缓存当前内容，稍后离线播放。';

  const ensureDownloadDialogSources = async (): Promise<{
    detail: SearchResult;
    availableSources: SearchResult[];
  } | null> => {
    if (!isOfflineMode) {
      return {
        detail,
        availableSources,
      };
    }

    if (downloadDialogDetail) {
      return {
        detail: downloadDialogDetail,
        availableSources: downloadDialogAvailableSources,
      };
    }

    try {
      setActionError(null);
      setIsPreparingBatchDialog(true);

      const resolvedSources = await resolveDownloadablePlaybackSources({
        source: detail.source,
        id: detail.id,
        title: detail.title.trim(),
        year: detail.year || undefined,
        searchType,
        query: searchTitle || detail.title,
        doubanId: detail.douban_id,
        allowAdultCandidates: shouldAllowAdultPlayback,
      });

      setDownloadDialogDetail(resolvedSources.detail);
      setDownloadDialogAvailableSources(resolvedSources.availableSources);
      return resolvedSources;
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : '获取可下载剧集失败'
      );
      return null;
    } finally {
      setIsPreparingBatchDialog(false);
    }
  };

  const handleOpenBatchDialog = async () => {
    setActionError(null);
    setBatchFeedback(null);

    const resolvedSources = await ensureDownloadDialogSources();
    if (!resolvedSources) {
      return;
    }

    setIsBatchDialogOpen(true);
  };

  const handleStart = async () => {
    try {
      setActionError(null);
      setBatchFeedback(null);
      const downloadSources = await ensureDownloadDialogSources();
      if (!downloadSources) {
        return;
      }
      await downloadClient.startEpisodeDownload({
        detail: downloadSources.detail,
        episodeIndex: targetEpisodeIndex,
        availableSources: downloadSources.availableSources,
        searchTitle,
        searchType,
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
      await downloadClient.pauseTask(taskId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '暂停下载失败');
    }
  };

  const handleResume = async () => {
    try {
      setActionError(null);
      await downloadClient.resumeTask(taskId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '恢复下载失败');
    }
  };

  const handleCancel = async () => {
    try {
      setActionError(null);
      await downloadClient.cancelTask(taskId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '取消下载失败');
    }
  };

  const handleDelete = async () => {
    try {
      setActionError(null);
      await downloadClient.deleteEpisode(contentId, targetEpisodeIndex);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : '删除离线文件失败'
      );
    }
  };

  const renderStandardActionButtons = () => (
    <>
      {downloadedEpisode && content && (
        <Link
          href={buildOfflinePlayHref({
            content,
            episodeIndex: targetEpisodeIndex,
          })}
          className={filledButtonClassName}
        >
          {isOfflineMode ? '当前为离线播放' : '离线播放'}
        </Link>
      )}

      {!downloadedEpisode && !task && !isOfflineMode && (
        <button
          type='button'
          onClick={handleStart}
          className={filledButtonClassName}
        >
          下载当前集
        </button>
      )}

      {task?.status === 'downloading' && (
        <button
          type='button'
          onClick={handlePause}
          className={secondaryButtonClassName}
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
          className={filledButtonClassName}
        >
          继续下载
        </button>
      )}

      {task?.status === 'error' && (
        <button
          type='button'
          onClick={handleResume}
          className={filledButtonClassName}
        >
          重试下载
        </button>
      )}

      <button
        type='button'
        onClick={() => void handleOpenBatchDialog()}
        disabled={isPreparingBatchDialog}
        className={secondaryButtonClassName}
      >
        {isPreparingBatchDialog ? '加载中...' : downloadDialogLabel}
      </button>

      {task && task.status !== 'done' && (
        <button
          type='button'
          onClick={handleCancel}
          className={neutralButtonClassName}
        >
          取消
        </button>
      )}

      {downloadedEpisode && (
        <button
          type='button'
          onClick={handleDelete}
          className={dangerButtonClassName}
        >
          删除
        </button>
      )}
    </>
  );

  const renderCompactActionButtons = () => (
    <div className='grid gap-2 sm:grid-cols-2'>
      {task?.status === 'downloading' && (
        <button
          type='button'
          onClick={handlePause}
          className={`${secondaryButtonClassName} w-full`}
        >
          暂停下载
        </button>
      )}

      {task?.status === 'queued' && (
        <span className='inline-flex w-full cursor-default items-center justify-center rounded-lg border border-gray-700 bg-white/5 px-3 py-2 text-sm font-medium text-gray-400'>
          排队中
        </span>
      )}

      {task?.status === 'paused' && (
        <button
          type='button'
          onClick={handleResume}
          className={`${filledButtonClassName} w-full`}
        >
          继续下载
        </button>
      )}

      {task?.status === 'error' && (
        <button
          type='button'
          onClick={handleResume}
          className={`${filledButtonClassName} w-full`}
        >
          重试下载
        </button>
      )}

      {!downloadedEpisode && !task && !isOfflineMode && (
        <button
          type='button'
          onClick={handleStart}
          className={`${filledButtonClassName} w-full`}
        >
          下载当前集
        </button>
      )}

      <button
        type='button'
        onClick={() => void handleOpenBatchDialog()}
        disabled={isPreparingBatchDialog}
        className={`${secondaryButtonClassName} w-full`}
      >
        {isPreparingBatchDialog ? '加载中...' : downloadDialogLabel}
      </button>

      {task && task.status !== 'done' && (
        <button
          type='button'
          onClick={handleCancel}
          className={`${neutralButtonClassName} w-full`}
        >
          取消下载
        </button>
      )}

      {downloadedEpisode && (
        <button
          type='button'
          onClick={handleDelete}
          className={`${dangerButtonClassName} w-full`}
        >
          删除
        </button>
      )}
    </div>
  );

  if (compact) {
    return (
      <>
        <div ref={compactPanelRef} className='relative flex items-center'>
          <button
            ref={compactTriggerButtonRef}
            type='button'
            onClick={() => {
              if (!isCompactPanelOpen) {
                updateCompactPanelPosition();
              }

              setIsCompactPanelOpen((currentState) => !currentState);
            }}
            aria-label={compactButtonLabel}
            title={compactPanelTitle}
            className={`group relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200/50 bg-white/80 text-gray-600 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-white hover:text-gray-900 hover:shadow-md dark:border-gray-700/50 dark:bg-gray-800/80 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white ${
              isCompactPanelOpen
                ? 'border-emerald-400/40 text-emerald-500 dark:text-emerald-300'
                : ''
            }`}
          >
            <Info className='h-4 w-4' />
            <span
              className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-gray-900 ${compactIndicatorClassName}`}
            />
          </button>

          {isCompactPanelOpen &&
            compactPanelPosition &&
            typeof document !== 'undefined' &&
            createPortal(
              <div
                ref={compactPanelSurfaceRef}
                className={compactPanelClassName}
                style={{
                  right: compactPanelPosition.right,
                  top: compactPanelPosition.top,
                }}
              >
                <div className='flex items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    <div className='text-sm font-semibold text-white'>
                      {compactPanelTitle}
                    </div>
                    <div className='mt-1 truncate text-xs text-gray-400'>
                      {episodeLabel}
                    </div>
                  </div>
                  {isOfflineMode ? (
                    <span className='shrink-0 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-200'>
                      当前离线播放
                    </span>
                  ) : null}
                </div>

                <div className='mt-4'>{renderCompactActionButtons()}</div>

                {batchFeedback && (
                  <div className='mt-3 text-xs text-emerald-300'>
                    {batchFeedback}
                  </div>
                )}

                {actionError && (
                  <div className='mt-3 text-xs text-red-400'>{actionError}</div>
                )}

                {task?.errorMessage && task.status === 'error' && (
                  <div className='mt-2 text-xs text-red-400'>
                    {task.errorMessage}
                  </div>
                )}
              </div>,
              document.body
            )}
        </div>

        <BatchEpisodeDownloadDialog
          detail={batchDialogDetail}
          availableSources={batchDialogAvailableSources}
          episodeIndex={batchDialogEpisodeIndex}
          isOpen={isBatchDialogOpen}
          searchTitle={searchTitle}
          searchType={searchType}
          onClose={() => setIsBatchDialogOpen(false)}
          onComplete={(message) => {
            setActionError(null);
            setBatchFeedback(message);
          }}
        />
      </>
    );
  }

  return (
    <>
      <div className='rounded-xl border border-emerald-200/80 bg-emerald-50/80 px-4 py-4 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/10'>
        <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='rounded-full border border-emerald-300/80 bg-emerald-100/80 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-900/40 dark:text-emerald-300'>
                离线下载
              </span>
              <span className='min-w-0 truncate text-sm font-medium text-gray-800 dark:text-gray-100'>
                {conciseEpisodeLabel}
              </span>
              <span
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${standardStatusClassName}`}
              >
                {standardStatusLabel}
              </span>
            </div>
            <div className='mt-1 text-xs text-gray-600 dark:text-gray-400'>
              {standardSummary}
            </div>
          </div>

          <div className='flex flex-wrap items-center gap-2 lg:justify-end'>
            {renderStandardActionButtons()}
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

      <BatchEpisodeDownloadDialog
        detail={batchDialogDetail}
        availableSources={batchDialogAvailableSources}
        episodeIndex={batchDialogEpisodeIndex}
        isOpen={isBatchDialogOpen}
        searchTitle={searchTitle}
        searchType={searchType}
        onClose={() => setIsBatchDialogOpen(false)}
        onComplete={(message) => {
          setActionError(null);
          setBatchFeedback(message);
        }}
      />
    </>
  );
}
