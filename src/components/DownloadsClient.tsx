'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type ChangeEvent, useMemo, useState } from 'react';

import { formatBytes, getDownloadStatusLabel } from '@/lib/download/format';
import { downloadManager } from '@/lib/download/manager';
import { buildOfflinePlayHref } from '@/lib/download/offline';
import { sortActiveDownloadTasks } from '@/lib/download/sort';
import {
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
        <div className='grid gap-4'>
          {activeTasks.map((task) => (
            <div
              key={task.id}
              className='rounded-2xl border border-gray-200 bg-white/80 p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900/50'
            >
              <div className='flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
                <div className='space-y-1'>
                  <div className='text-base font-medium text-gray-900 dark:text-gray-100'>
                    {task.title}
                  </div>
                  <div className='text-sm text-gray-600 dark:text-gray-400'>
                    {task.episodeTitle} · {task.sourceName}
                  </div>
                  <div className='text-xs text-gray-500 dark:text-gray-500'>
                    {getDownloadStatusLabel(task.status)}
                    {task.totalResources > 0 &&
                      ` · ${task.downloadedResources}/${task.totalResources}`}
                    {task.sizeBytes > 0 && ` · ${formatBytes(task.sizeBytes)}`}
                  </div>
                </div>

                <div className='flex flex-wrap gap-2'>
                  {task.status === 'downloading' && (
                    <button
                      type='button'
                      onClick={() => void onPause(task.id)}
                      className='rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/20'
                    >
                      暂停
                    </button>
                  )}

                  {task.status === 'queued' && (
                    <span className='rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400'>
                      排队中
                    </span>
                  )}

                  {['paused', 'error'].includes(task.status) && (
                    <button
                      type='button'
                      onClick={() => void onResume(task.id)}
                      className='rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700'
                    >
                      {task.status === 'error' ? '重试' : '继续'}
                    </button>
                  )}

                  <button
                    type='button'
                    onClick={() => void onCancel(task.id)}
                    className='rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/10'
                  >
                    取消
                  </button>
                </div>
              </div>

              {task.totalResources > 0 && (
                <div className='mt-4 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800'>
                  <div
                    className='h-full rounded-full bg-emerald-500 transition-all'
                    style={{ width: `${task.progress}%` }}
                  />
                </div>
              )}

              {task.errorMessage && task.status === 'error' && (
                <div className='mt-3 text-xs text-red-600 dark:text-red-400'>
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
        <div className='grid gap-4'>
          {downloadedContents.map((content) => (
            <div
              key={content.contentId}
              className='rounded-2xl border border-gray-200 bg-white/80 p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900/50'
            >
              <div className='flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between'>
                <div className='space-y-1'>
                  <div className='text-base font-medium text-gray-900 dark:text-gray-100'>
                    {content.title}
                  </div>
                  <div className='text-sm text-gray-600 dark:text-gray-400'>
                    {content.sourceName} · {content.episodes.length} 集已下载
                  </div>
                </div>
                <div className='text-sm text-gray-500 dark:text-gray-400'>
                  共 {formatBytes(content.totalSizeBytes)}
                </div>
              </div>

              <div className='mt-4 grid gap-3'>
                {content.episodes.map((episode) => {
                  const offlineHref = buildOfflinePlayHref({
                    content,
                    episodeIndex: episode.episodeIndex,
                  });

                  return (
                    <div
                      key={`${content.contentId}-${episode.episodeIndex}`}
                      className='flex flex-col gap-3 rounded-xl border border-gray-200/80 bg-gray-50/80 px-4 py-3 dark:border-gray-800 dark:bg-gray-950/40 lg:flex-row lg:items-center lg:justify-between'
                    >
                      <div className='space-y-1'>
                        <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {episode.episodeTitle}
                        </div>
                        <div className='text-xs text-gray-500 dark:text-gray-400'>
                          {formatBytes(episode.sizeBytes)} ·{' '}
                          {episode.resourceCount} 个资源
                        </div>
                      </div>

                      <div className='flex flex-wrap gap-2'>
                        <Link
                          href={offlineHref}
                          prefetch={false}
                          className='rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700'
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
                          className='rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-950/20'
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
  const isDevelopment = process.env.NODE_ENV === 'development';
  const hasHydrated = useDownloadStore((state) => state.hasHydrated);
  const maxConcurrentTasks = useDownloadStore(
    (state) => state.maxConcurrentTasks
  );
  const setMaxConcurrentTasks = useDownloadStore(
    (state) => state.setMaxConcurrentTasks
  );

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
              <p className='mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400'>
                Web
                版受浏览器沙箱限制，暂不支持直接打开系统文件夹或自定义磁盘目录。
              </p>
              {isDevelopment && (
                <p className='mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300'>
                  本地验证离线播放时，请使用 `pnpm
                  preview:offline`；开发模式不会提供完整的离线缓存链路。
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
