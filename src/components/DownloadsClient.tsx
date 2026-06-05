'use client';

import { Settings2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { formatBytes, getDownloadStatusLabel } from '@/lib/download/format';
import { downloadManager } from '@/lib/download/manager';
import { buildOfflinePlayHref } from '@/lib/download/offline';
import { sortActiveDownloadTasks } from '@/lib/download/sort';
import {
  DOWNLOAD_CACHE_NAME,
  DOWNLOAD_RESOURCE_DB_NAME,
  DOWNLOAD_RESOURCE_STORE_NAME,
  DownloadedContentMeta,
  MAX_CONCURRENT_DOWNLOAD_TASKS,
  MIN_CONCURRENT_DOWNLOAD_TASKS,
} from '@/lib/download/types';
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

interface DownloadTaskActionHandlers {
  onPause: (taskId: string) => Promise<void>;
  onResume: (taskId: string) => Promise<void>;
  onCancel: (taskId: string) => Promise<void>;
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
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedEpisodeIndexes, setSelectedEpisodeIndexes] = useState<
    number[]
  >([]);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const shouldCollapseDescription = (content.desc?.length || 0) > 140;
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

  useEffect(() => {
    setIsDescriptionExpanded(false);
    setIsEditing(false);
    setSelectedEpisodeIndexes([]);
    setIsDeletingSelected(false);
  }, [content.contentId]);

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
  const [selectedContentId, setSelectedContentId] = useState<string | null>(
    null
  );
  const isDevelopment = process.env.NODE_ENV === 'development';
  const hasHydrated = useDownloadStore((state) => state.hasHydrated);
  const maxConcurrentTasks = useDownloadStore(
    (state) => state.maxConcurrentTasks
  );
  const setMaxConcurrentTasks = useDownloadStore(
    (state) => state.setMaxConcurrentTasks
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
    if (!isSettingsOpen && !selectedContentId) {
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
        setIsSettingsOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSettingsOpen, selectedContentId]);

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

  const handleOpenDownloadedContent = (contentId: string) => {
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
        onPause={handlePause}
        onResume={handleResume}
        onCancel={handleCancel}
      />

      <DownloadedContentsSection
        activeContentId={selectedContentId}
        onOpenContent={handleOpenDownloadedContent}
      />

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
