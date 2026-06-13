'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { getOfflineDownloadSupportState } from '@/lib/download/cache';
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
} from '@/lib/download/types';
import { SearchResult } from '@/lib/types';

import BatchEpisodeDownloadDialog from '@/components/BatchEpisodeDownloadDialog';

import { useDownloadStore } from '@/stores/downloadStore';

interface CurrentEpisodeDownloadControlProps {
  detail: SearchResult;
  availableSources?: SearchResult[];
  episodeIndex: number;
  isOfflineMode?: boolean;
  searchTitle?: string;
}

export default function CurrentEpisodeDownloadControl({
  detail,
  availableSources = [],
  episodeIndex,
  isOfflineMode = false,
  searchTitle,
}: CurrentEpisodeDownloadControlProps) {
  const contentId = buildDownloadContentId(detail.source, detail.id);
  const taskId = buildDownloadTaskId(contentId, episodeIndex);

  const [actionError, setActionError] = useState<string | null>(null);
  const [batchFeedback, setBatchFeedback] = useState<string | null>(null);
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [downloadSupport, setDownloadSupport] = useState<
    ReturnType<typeof getOfflineDownloadSupportState> | null
  >(null);

  const task = useDownloadStore((state) => state.tasks[taskId]);
  const content = useDownloadStore((state) => state.library[contentId]);
  const downloadedEpisode = getDownloadedEpisodeMeta(content, episodeIndex);

  useEffect(() => {
    setDownloadSupport(getOfflineDownloadSupportState());
  }, []);

  useEffect(() => {
    setActionError(null);
    setBatchFeedback(null);
    setIsBatchDialogOpen(false);
  }, [detail.id, detail.source, episodeIndex]);

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

  const canOpenDownloadDialog = !isOfflineMode;
  const downloadDialogLabel =
    detail.episodes.length > 1 ? '下载剧集' : '下载选项';

  const handleOpenBatchDialog = () => {
    setActionError(null);
    setBatchFeedback(null);
    setIsBatchDialogOpen(true);
  };

  const handleStart = async () => {
    try {
      setActionError(null);
      setBatchFeedback(null);
      await downloadManager.startEpisodeDownload({
        detail,
        episodeIndex,
        availableSources,
        searchTitle,
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
                    ` · ${formatTransferRate(
                      task.downloadSpeedBytesPerSecond
                    )}`}
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

            {canOpenDownloadDialog && (
              <button
                type='button'
                onClick={handleOpenBatchDialog}
                className='inline-flex items-center rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/20'
              >
                {downloadDialogLabel}
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

      <BatchEpisodeDownloadDialog
        detail={detail}
        availableSources={availableSources}
        episodeIndex={episodeIndex}
        isOpen={isBatchDialogOpen}
        searchTitle={searchTitle}
        onClose={() => setIsBatchDialogOpen(false)}
        onComplete={(message) => {
          setActionError(null);
          setBatchFeedback(message);
        }}
      />
    </>
  );
}
