'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type ChangeEvent, useEffect, useMemo, useState } from 'react';

import { formatBytes, getDownloadStatusLabel } from '@/lib/download/format';
import { downloadManager } from '@/lib/download/manager';
import { buildOfflinePlayHref } from '@/lib/download/offline';
import { sortActiveDownloadTasks } from '@/lib/download/sort';
import {
  DOWNLOAD_CACHE_NAME,
  DOWNLOAD_RESOURCE_DB_NAME,
  DOWNLOAD_RESOURCE_STORE_NAME,
  MAX_CONCURRENT_DOWNLOAD_TASKS,
  MIN_CONCURRENT_DOWNLOAD_TASKS,
} from '@/lib/download/types';

import { useDownloadStore } from '@/stores/downloadStore';

const concurrentTaskOptions = Array.from(
  {
    length: MAX_CONCURRENT_DOWNLOAD_TASKS - MIN_CONCURRENT_DOWNLOAD_TASKS + 1,
  },
  (_, index) => MIN_CONCURRENT_DOWNLOAD_TASKS + index
);

const compactActionButtonClassName =
  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors';

interface DownloadTaskActionHandlers {
  onPause: (taskId: string) => Promise<void>;
  onResume: (taskId: string) => Promise<void>;
  onCancel: (taskId: string) => Promise<void>;
}

interface DownloadedContentActionHandlers {
  onDeleteEpisode: (contentId: string, episodeIndex: number) => Promise<void>;
}

function ActiveTasksSection({
  onPause,
  onResume,
  onCancel,
}: DownloadTaskActionHandlers) {
  const tasks = useDownloadStore((state) => state.tasks);
  const activeTasks = useMemo(
    () =>
      sortActiveDownloadTasks(
        Object.values(tasks).filter((task) => task.status !== 'done')
      ),
    [tasks]
  );

  return (
    <section className='space-y-4'>
      <div className='flex items-center justify-between gap-3'>
        <div className='flex items-center justify-between gap-3'>
          <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            进行中的任务
          </h2>
          <span className='text-sm text-gray-500 dark:text-gray-400'>
            {activeTasks.length} 个任务
          </span>
        </div>
      </div>

      {activeTasks.length === 0 ? (
        <div className='rounded-2xl border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
          当前没有进行中的下载任务。
        </div>
      ) : (
        <div className='grid gap-3 xl:grid-cols-2'>
          {activeTasks.map((task) => (
            <div
              key={task.id}
              className='rounded-2xl border border-gray-200 bg-white/80 p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/50'
            >
              <div className='flex flex-col gap-3'>
                <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
                  <div className='min-w-0 space-y-2'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <div
                        className='truncate text-base font-semibold text-gray-900 dark:text-gray-100'
                        title={task.title}
                      >
                        {task.title}
                      </div>
                      <span className='inline-flex rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'>
                        {task.episodeTitle}
                      </span>
                      <span className='inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'>
                        {getDownloadStatusLabel(task.status)}
                      </span>
                    </div>
                    <div
                      className='truncate text-sm text-gray-600 dark:text-gray-400'
                      title={task.sourceName}
                    >
                      {task.sourceName}
                    </div>
                    <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400'>
                      {task.totalResources > 0 ? (
                        <span>
                          {task.downloadedResources}/{task.totalResources} 个资源
                        </span>
                      ) : (
                        <span>等待资源清单</span>
                      )}
                      {task.sizeBytes > 0 && (
                        <span>{formatBytes(task.sizeBytes)}</span>
                      )}
                      <span>{task.progress}%</span>
                    </div>
                  </div>

                  <div className='flex shrink-0 flex-wrap gap-2 sm:justify-end'>
                    {task.status === 'downloading' && (
                      <button
                        type='button'
                        onClick={() => void onPause(task.id)}
                        className={`${compactActionButtonClassName} border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/20`}
                      >
                        暂停
                      </button>
                    )}

                    {task.status === 'queued' && (
                      <span className='rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400'>
                        排队中
                      </span>
                    )}

                    {['paused', 'error'].includes(task.status) && (
                      <button
                        type='button'
                        onClick={() => void onResume(task.id)}
                        className={`${compactActionButtonClassName} bg-emerald-600 text-white hover:bg-emerald-700`}
                      >
                        {task.status === 'error' ? '重试' : '继续'}
                      </button>
                    )}

                    <button
                      type='button'
                      onClick={() => void onCancel(task.id)}
                      className={`${compactActionButtonClassName} border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/10`}
                    >
                      取消
                    </button>
                  </div>
                </div>

                <div className='flex items-center gap-3'>
                  <div className='h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800'>
                    <div
                      className='h-full rounded-full bg-emerald-500 transition-all'
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                  <div className='w-12 text-right text-xs font-medium text-gray-500 dark:text-gray-400'>
                    {task.progress}%
                  </div>
                </div>
              </div>

              {task.errorMessage && task.status === 'error' && (
                <div className='mt-3 rounded-xl border border-red-200/70 bg-red-50/80 px-3 py-2 text-xs text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400'>
                  {task.errorMessage}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DownloadedContentsSection({
  onDeleteEpisode,
}: DownloadedContentActionHandlers) {
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
        <div className='grid gap-4 xl:grid-cols-2'>
          {downloadedContents.map((content) => (
            <div
              key={content.contentId}
              className='flex h-full flex-col rounded-2xl border border-gray-200 bg-white/80 p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/50'
            >
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0 space-y-2'>
                  <div
                    className='line-clamp-2 text-lg font-semibold text-gray-900 dark:text-gray-100'
                    title={content.title}
                  >
                    {content.title}
                  </div>
                  <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-gray-400'>
                    <span>{content.sourceName}</span>
                    <span>{content.episodes.length} 集已下载</span>
                  </div>
                </div>
                <div className='shrink-0 rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'>
                  {formatBytes(content.totalSizeBytes)}
                </div>
              </div>

              <div
                className={`mt-4 grid gap-2 ${
                  content.episodes.length > 4 ? 'max-h-80 overflow-y-auto pr-1' : ''
                }`}
              >
                {content.episodes.map((episode) => {
                  const offlineHref = buildOfflinePlayHref({
                    content,
                    episodeIndex: episode.episodeIndex,
                  });

                  return (
                    <div
                      key={`${content.contentId}-${episode.episodeIndex}`}
                      className='flex flex-col gap-3 rounded-xl border border-gray-200/80 bg-gray-50/80 px-3 py-3 dark:border-gray-800 dark:bg-gray-950/40 sm:flex-row sm:items-center sm:justify-between'
                    >
                      <div className='min-w-0 space-y-1'>
                        <div className='flex flex-wrap items-center gap-2'>
                          <span className='inline-flex rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-300'>
                            EP{String(episode.episodeIndex + 1).padStart(2, '0')}
                          </span>
                          <div
                            className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'
                            title={episode.episodeTitle}
                          >
                            {episode.episodeTitle}
                          </div>
                        </div>
                        <div className='text-xs text-gray-500 dark:text-gray-400'>
                          {formatBytes(episode.sizeBytes)} ·{' '}
                          {episode.resourceCount} 个资源
                        </div>
                      </div>

                      <div className='flex shrink-0 flex-wrap gap-2 sm:justify-end'>
                        <Link
                          href={offlineHref}
                          prefetch={false}
                          className={`${compactActionButtonClassName} bg-emerald-600 text-white hover:bg-emerald-700`}
                        >
                          离线播放
                        </Link>
                        <button
                          type='button'
                          onClick={() =>
                            void onDeleteEpisode(
                              content.contentId,
                              episode.episodeIndex
                            )
                          }
                          className={`${compactActionButtonClassName} border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-950/20`}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function DownloadsClient() {
  const searchParams = useSearchParams();
  const [actionError, setActionError] = useState<string | null>(null);
  const [storageOrigin, setStorageOrigin] = useState('');
  const isDevelopment = process.env.NODE_ENV === 'development';
  const hasHydrated = useDownloadStore((state) => state.hasHydrated);
  const maxConcurrentTasks = useDownloadStore(
    (state) => state.maxConcurrentTasks
  );
  const setMaxConcurrentTasks = useDownloadStore(
    (state) => state.setMaxConcurrentTasks
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setStorageOrigin(window.location.origin);
  }, []);

  const handlePause = async (taskId: string) => {
    try {
      setActionError(null);
      await downloadManager.pauseTask(taskId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '暂停下载失败');
    }
  };

  const handleResume = async (taskId: string) => {
    try {
      setActionError(null);
      await downloadManager.resumeTask(taskId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '恢复下载失败');
    }
  };

  const handleCancel = async (taskId: string) => {
    try {
      setActionError(null);
      await downloadManager.cancelTask(taskId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '取消下载失败');
    }
  };

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
        <h1 className='text-2xl font-semibold text-gray-900 dark:text-gray-100'>
          下载管理
        </h1>
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

      <section className='rounded-2xl border border-gray-200 bg-white/85 p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/60'>
        <div className='space-y-4'>
          <div className='space-y-1'>
            <h2 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
              下载设置
            </h2>
            <p className='text-sm text-gray-600 dark:text-gray-400'>
              调整下载并发，并确认离线内容的保存位置。
            </p>
          </div>

          <div className='grid gap-3 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]'>
            <div className='rounded-xl border border-gray-200 bg-gray-50/80 p-3 shadow-sm dark:border-gray-700 dark:bg-gray-950/50'>
              <label
                htmlFor='download-concurrency'
                className='block text-sm font-medium text-gray-700 dark:text-gray-200'
              >
                同时下载数量
              </label>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                修改后立即生效。
              </p>
              <select
                id='download-concurrency'
                value={maxConcurrentTasks}
                onChange={handleConcurrentTaskChange}
                className='mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-emerald-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
              >
                {concurrentTaskOptions.map((value) => (
                  <option key={value} value={value}>
                    {value} 个任务
                  </option>
                ))}
              </select>
            </div>

            <div className='rounded-xl border border-gray-200 bg-gray-50/80 p-3 shadow-sm dark:border-gray-700 dark:bg-gray-950/50'>
              <div className='text-sm font-medium text-gray-700 dark:text-gray-200'>
                离线保存位置
              </div>
              <div className='mt-3 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300'>
                当前浏览器离线缓存
              </div>
              <div className='mt-3 rounded-xl border border-emerald-200/70 bg-emerald-50/60 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20'>
                <div className='text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300'>
                  逻辑存储位置
                </div>
                <div className='mt-3 grid gap-2 text-xs text-gray-600 dark:text-gray-300'>
                  <div className='grid gap-1 sm:grid-cols-[88px_minmax(0,1fr)]'>
                    <span className='font-medium text-gray-700 dark:text-gray-200'>
                      站点
                    </span>
                    <code className='break-all rounded bg-white/80 px-2 py-1 text-[11px] text-gray-700 dark:bg-gray-900/70 dark:text-gray-200'>
                      {storageOrigin || '当前站点'}
                    </code>
                  </div>
                  <div className='grid gap-1 sm:grid-cols-[88px_minmax(0,1fr)]'>
                    <span className='font-medium text-gray-700 dark:text-gray-200'>
                      Cache
                    </span>
                    <code className='break-all rounded bg-white/80 px-2 py-1 text-[11px] text-gray-700 dark:bg-gray-900/70 dark:text-gray-200'>
                      {DOWNLOAD_CACHE_NAME}
                    </code>
                  </div>
                  <div className='grid gap-1 sm:grid-cols-[88px_minmax(0,1fr)]'>
                    <span className='font-medium text-gray-700 dark:text-gray-200'>
                      IndexedDB
                    </span>
                    <code className='break-all rounded bg-white/80 px-2 py-1 text-[11px] text-gray-700 dark:bg-gray-900/70 dark:text-gray-200'>
                      {DOWNLOAD_RESOURCE_DB_NAME}
                    </code>
                  </div>
                  <div className='grid gap-1 sm:grid-cols-[88px_minmax(0,1fr)]'>
                    <span className='font-medium text-gray-700 dark:text-gray-200'>
                      对象仓库
                    </span>
                    <code className='break-all rounded bg-white/80 px-2 py-1 text-[11px] text-gray-700 dark:bg-gray-900/70 dark:text-gray-200'>
                      {DOWNLOAD_RESOURCE_STORE_NAME}
                    </code>
                  </div>
                </div>
              </div>
              <p className='mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400'>
                实际磁盘位置由浏览器站点沙箱托管，Web 版暂不支持直接显示系统路径、打开系统文件夹或自定义磁盘目录。
              </p>
              {isDevelopment && (
                <p className='mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300'>
                  本地验证离线播放时，请使用独立预览模式；开发模式不会提供完整的离线缓存链路。
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <ActiveTasksSection
        onPause={handlePause}
        onResume={handleResume}
        onCancel={handleCancel}
      />

      <DownloadedContentsSection onDeleteEpisode={handleDeleteEpisode} />
    </div>
  );
}
