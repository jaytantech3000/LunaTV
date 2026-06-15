'use client';

import { Loader2, Settings2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';

import {
  buildAdultContentMatchKey,
  buildAdultDownloadGroupingKey,
  buildAdultDownloadGroupingQuery,
  filterAdultGroupingSearchResults,
} from '@/lib/download/adult';
import {
  formatBytes,
  formatTaskSizeProgress,
  formatTransferRate,
  getDownloadStatusLabel,
  getTaskCurrentSizeBytes,
  getTaskEstimatedTotalSizeBytes,
} from '@/lib/download/format';
import { downloadManager } from '@/lib/download/manager';
import {
  normalizeVodDetailForPlayback,
  normalizeVodSearchResultsForPlayback,
} from '@/lib/download/normalize';
import {
  buildOfflinePlayHref,
  getDownloadedEpisodeDurationSeconds,
  isAdultDownloadedContent,
  sortDownloadedEpisodes,
} from '@/lib/download/offline';
import {
  sortActiveDownloadTaskGroups,
  sortActiveDownloadTasks,
} from '@/lib/download/sort';
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
import { acquireScrollLock } from '@/lib/scroll-lock';
import { apiFetch } from '@/lib/transport/api-client';
import { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';
import { isAdultContentResult } from '@/lib/yellow';

import { useDownloadStore } from '@/stores/downloadStore';

import { useNavigationFeedback } from './NavigationFeedbackProvider';
import { useSite } from './SiteProvider';

const concurrentTaskOptions = Array.from(
  {
    length: MAX_CONCURRENT_DOWNLOAD_TASKS - MIN_CONCURRENT_DOWNLOAD_TASKS + 1,
  },
  (_, index) => MIN_CONCURRENT_DOWNLOAD_TASKS + index
);

const compactActionButtonClassName =
  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors';
const dialogHeaderActionButtonClassName =
  'inline-flex h-10 w-[88px] shrink-0 items-center justify-center rounded-xl border border-white/15 px-0 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10';
const dialogHeaderIconButtonClassName =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 text-gray-200 transition-colors hover:bg-white/10';

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

function normalizeMetadataText(value?: string | null): string | null {
  const normalizedValue = value?.trim();
  return normalizedValue ? normalizedValue : null;
}

function extractDurationText(
  ...values: Array<string | null | undefined>
): string | null {
  const durationPatterns = [
    /((?:\d+(?:\.\d+)?)\s*小时(?:\s*\d+\s*分钟)?)/i,
    /((?:\d+(?:\.\d+)?)\s*(?:分钟|min(?:ute)?s?))/i,
    /((?:\d{1,2}:\d{2})(?::\d{2})?)/,
  ];

  for (const value of values) {
    const normalizedValue = normalizeMetadataText(value);
    if (!normalizedValue) {
      continue;
    }

    for (const pattern of durationPatterns) {
      const matchedDuration = normalizedValue.match(pattern)?.[1]?.trim();
      if (matchedDuration) {
        return matchedDuration.replace(/\s+/g, '');
      }
    }
  }

  return null;
}

function formatDurationLabel(totalSeconds: number): string {
  const normalizedSeconds = Math.max(1, Math.round(totalSeconds));
  const hours = Math.floor(normalizedSeconds / 3600);
  const minutes = Math.floor((normalizedSeconds % 3600) / 60);
  const seconds = normalizedSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
  }

  if (minutes > 0) {
    return `${minutes}分钟`;
  }

  return `${seconds}秒`;
}

function getDisplayableOfflineRemark(
  remarks?: string | null,
  episodeTitle?: string | null
): string | null {
  const normalizedRemarks = normalizeMetadataText(remarks);
  if (!normalizedRemarks) {
    return null;
  }

  const normalizedEpisodeTitle = normalizeMetadataText(episodeTitle);
  if (normalizedEpisodeTitle && normalizedRemarks === normalizedEpisodeTitle) {
    return null;
  }

  if (
    /^(hd|sd|uhd|4k|8k|高清|超清|蓝光|中字|国语|完结|全集|已完结|第?\s*\d+\s*集|更新至.+)$/i.test(
      normalizedRemarks
    )
  ) {
    return null;
  }

  return normalizedRemarks;
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
  createdAt: number;
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

interface ActiveTaskCardGroup extends ActiveTaskGroup {
  id: string;
  groupingKind?: 'adult' | 'title';
  adultGroupingQuery?: string;
  groupedContentCount: number;
  memberContentIds: string[];
}

interface DownloadedContentCardGroup {
  id: string;
  contentId: string;
  title: string;
  poster: string;
  sourceName: string;
  year: string;
  groupingKind?: 'adult' | 'title';
  adultGroupingQuery?: string;
  contents: DownloadedContentMeta[];
  totalEpisodeCount: number;
  totalSizeBytes: number;
  updatedAt: number;
}

interface GroupedOfflineEpisodeEntry {
  contentId: string;
  sourceName: string;
  contentTitle: string;
  poster: string;
  remarks?: string;
  year: string;
  typeName?: string;
  desc?: string;
  rootManifestUrl: string;
  playbackManifestUrl: string;
  episodeIndex: number;
  episodeTitle: string;
  sizeBytes: number;
  downloadedAt: number;
  offlineHref: string;
  isCurrentContent: boolean;
}

interface SelectableEpisodeTarget {
  key: string;
  contentId: string;
  episodeIndex: number;
  episodeTitle: string;
}

interface AdultRelatedDownloadOption {
  contentId: string;
  detail: SearchResult;
  totalEpisodes: number;
  actionableEpisodeIndexes: number[];
  downloadedEpisodeCount: number;
  activeEpisodeCount: number;
  pausedOrErrorEpisodeCount: number;
  isActionable: boolean;
}

interface AdultGroupCoverMenuState {
  poster: string;
  title: string;
  x: number;
  y: number;
}

function getAdultGroupingIdentity(
  content: Partial<{
    title: string;
    searchTitle: string;
    sourceName: string;
    desc: string;
    typeName: string;
  }>
): { key: string; query: string } | null {
  const query = buildAdultDownloadGroupingQuery(content);
  const key = buildAdultDownloadGroupingKey(content);

  if (!query || !key) {
    return null;
  }

  return { key, query };
}

function normalizeDownloadGroupingTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\-_.·•・:：,，!！?？'"“”‘’`~()（）[\]【】{}<>《》/\\|]/g, '');
}

function getTitleGroupingIdentity(
  title?: string | null
): { key: string; title: string } | null {
  const normalizedTitle = title?.trim() || '';
  if (!normalizedTitle) {
    return null;
  }

  const key = normalizeDownloadGroupingTitle(normalizedTitle);
  if (!key) {
    return null;
  }

  return {
    key,
    title: normalizedTitle,
  };
}

function getAdultGroupPoster(contents: DownloadedContentMeta[]): string {
  const customPoster = contents.find((content) =>
    Boolean(content.adultGroupPoster?.trim())
  )?.adultGroupPoster;
  if (customPoster?.trim()) {
    return customPoster.trim();
  }

  return (
    contents.find((content) => Boolean(content.poster.trim()))?.poster.trim() ||
    ''
  );
}

function buildSingleActiveTaskCardGroup(
  group: ActiveTaskGroup,
  adultGroupingQuery?: string
): ActiveTaskCardGroup {
  return {
    ...group,
    id: group.contentId,
    adultGroupingQuery,
    groupedContentCount: 1,
    memberContentIds: [group.contentId],
  };
}

function buildGroupedActiveTaskCardGroup(
  key: string,
  groupingLabel: string,
  groupingKind: 'adult' | 'title',
  groups: ActiveTaskGroup[]
): ActiveTaskCardGroup {
  const sortedGroups = sortActiveDownloadTaskGroups(groups);
  const leadGroup = sortedGroups[0];
  const tasks = sortActiveDownloadTasks(
    sortedGroups.flatMap((group) => group.tasks)
  );
  const totalResources = sortedGroups.reduce(
    (sum, group) => sum + group.totalResources,
    0
  );
  const downloadedResources = sortedGroups.reduce(
    (sum, group) => sum + group.downloadedResources,
    0
  );
  const progress =
    totalResources > 0
      ? Math.min(100, Math.round((downloadedResources / totalResources) * 100))
      : Math.round(
          tasks.reduce(
            (sum, task) => sum + Math.max(0, Math.min(100, task.progress)),
            0
          ) / tasks.length
        );

  return {
    ...leadGroup,
    id: `${groupingKind}:${key}`,
    title: groupingLabel,
    groupingKind,
    adultGroupingQuery: groupingKind === 'adult' ? groupingLabel : undefined,
    groupedContentCount: sortedGroups.length,
    memberContentIds: sortedGroups.map((group) => group.contentId),
    tasks,
    totalResources,
    downloadedResources,
    currentSizeBytes: sortedGroups.reduce(
      (sum, group) => sum + group.currentSizeBytes,
      0
    ),
    estimatedTotalSizeBytes: sortedGroups.reduce(
      (sum, group) => sum + group.estimatedTotalSizeBytes,
      0
    ),
    downloadSpeedBytesPerSecond: sortedGroups.reduce(
      (sum, group) => sum + group.downloadSpeedBytesPerSecond,
      0
    ),
    progress,
    updatedAt: sortedGroups.reduce(
      (latestUpdatedAt, group) => Math.max(latestUpdatedAt, group.updatedAt),
      0
    ),
    downloadingCount: sortedGroups.reduce(
      (sum, group) => sum + group.downloadingCount,
      0
    ),
    queuedCount: sortedGroups.reduce(
      (sum, group) => sum + group.queuedCount,
      0
    ),
    pausedCount: sortedGroups.reduce(
      (sum, group) => sum + group.pausedCount,
      0
    ),
    errorCount: sortedGroups.reduce((sum, group) => sum + group.errorCount, 0),
    createdAt: sortedGroups.reduce(
      (earliestCreatedAt, group) =>
        Math.min(earliestCreatedAt, group.createdAt),
      leadGroup.createdAt
    ),
  };
}

function buildActiveTaskCardGroups(
  groups: ActiveTaskGroup[],
  options: {
    groupSameTitleAcrossSources: boolean;
  }
): ActiveTaskCardGroup[] {
  const adultBuckets = new Map<
    string,
    { query: string; groups: ActiveTaskGroup[] }
  >();
  const titleBuckets = new Map<
    string,
    { title: string; groups: ActiveTaskGroup[] }
  >();
  const cardGroups: ActiveTaskCardGroup[] = [];

  groups.forEach((group) => {
    const leadTask = group.tasks[0];
    const identity = leadTask
      ? getAdultGroupingIdentity({
          title: leadTask.title,
          searchTitle: leadTask.searchTitle,
          sourceName: leadTask.sourceName,
          desc: leadTask.desc,
          typeName: leadTask.typeName,
        })
      : null;

    if (!identity) {
      if (!options.groupSameTitleAcrossSources) {
        cardGroups.push(buildSingleActiveTaskCardGroup(group));
        return;
      }

      const titleIdentity = getTitleGroupingIdentity(group.title);
      if (!titleIdentity) {
        cardGroups.push(buildSingleActiveTaskCardGroup(group));
        return;
      }

      const currentBucket = titleBuckets.get(titleIdentity.key) || {
        title: titleIdentity.title,
        groups: [],
      };
      currentBucket.groups.push(group);
      titleBuckets.set(titleIdentity.key, currentBucket);
      return;
    }

    const currentBucket = adultBuckets.get(identity.key) || {
      query: identity.query,
      groups: [],
    };
    currentBucket.groups.push(group);
    adultBuckets.set(identity.key, currentBucket);
  });

  adultBuckets.forEach(({ query, groups: groupedItems }, key) => {
    if (groupedItems.length === 1) {
      cardGroups.push(buildSingleActiveTaskCardGroup(groupedItems[0], query));
      return;
    }

    cardGroups.push(
      buildGroupedActiveTaskCardGroup(key, query, 'adult', groupedItems)
    );
  });

  titleBuckets.forEach(({ title, groups: groupedItems }, key) => {
    if (groupedItems.length === 1) {
      cardGroups.push(buildSingleActiveTaskCardGroup(groupedItems[0]));
      return;
    }

    cardGroups.push(
      buildGroupedActiveTaskCardGroup(key, title, 'title', groupedItems)
    );
  });

  return sortActiveDownloadTaskGroups(cardGroups);
}

function buildSingleDownloadedContentCardGroup(
  content: DownloadedContentMeta,
  adultGroupingQuery?: string
): DownloadedContentCardGroup {
  return {
    id: content.contentId,
    contentId: content.contentId,
    title: content.title,
    poster: adultGroupingQuery
      ? getAdultGroupPoster([content])
      : content.poster.trim(),
    sourceName: content.sourceName,
    year: content.year,
    adultGroupingQuery,
    contents: [content],
    totalEpisodeCount: content.episodes.length,
    totalSizeBytes: content.totalSizeBytes,
    updatedAt: content.updatedAt,
  };
}

function buildGroupedDownloadedContentCardGroup(
  key: string,
  groupingLabel: string,
  groupingKind: 'adult' | 'title',
  contents: DownloadedContentMeta[]
): DownloadedContentCardGroup {
  const sortedContents = [...contents].sort(
    (left, right) => right.updatedAt - left.updatedAt
  );
  const leadContent = sortedContents[0];

  return {
    id: `${groupingKind}:${key}`,
    contentId: leadContent.contentId,
    title: groupingLabel,
    poster:
      groupingKind === 'adult'
        ? getAdultGroupPoster(sortedContents)
        : leadContent.poster.trim(),
    sourceName: leadContent.sourceName,
    year: leadContent.year,
    groupingKind,
    adultGroupingQuery: groupingKind === 'adult' ? groupingLabel : undefined,
    contents: sortedContents,
    totalEpisodeCount: sortedContents.reduce(
      (sum, content) => sum + content.episodes.length,
      0
    ),
    totalSizeBytes: sortedContents.reduce(
      (sum, content) => sum + content.totalSizeBytes,
      0
    ),
    updatedAt: sortedContents.reduce(
      (latestUpdatedAt, content) =>
        Math.max(latestUpdatedAt, content.updatedAt),
      0
    ),
  };
}

function buildDownloadedContentCardGroups(
  contents: DownloadedContentMeta[],
  options: {
    groupSameTitleAcrossSources: boolean;
  }
): DownloadedContentCardGroup[] {
  const adultBuckets = new Map<
    string,
    { query: string; contents: DownloadedContentMeta[] }
  >();
  const titleBuckets = new Map<
    string,
    { title: string; contents: DownloadedContentMeta[] }
  >();
  const cardGroups: DownloadedContentCardGroup[] = [];

  contents.forEach((content) => {
    const identity = getAdultGroupingIdentity({
      title: content.title,
      searchTitle: content.searchTitle,
      sourceName: content.sourceName,
      desc: content.desc,
      typeName: content.typeName,
    });

    if (!identity) {
      if (!options.groupSameTitleAcrossSources) {
        cardGroups.push(buildSingleDownloadedContentCardGroup(content));
        return;
      }

      const titleIdentity = getTitleGroupingIdentity(content.title);
      if (!titleIdentity) {
        cardGroups.push(buildSingleDownloadedContentCardGroup(content));
        return;
      }

      const currentBucket = titleBuckets.get(titleIdentity.key) || {
        title: titleIdentity.title,
        contents: [],
      };
      currentBucket.contents.push(content);
      titleBuckets.set(titleIdentity.key, currentBucket);
      return;
    }

    const currentBucket = adultBuckets.get(identity.key) || {
      query: identity.query,
      contents: [],
    };
    currentBucket.contents.push(content);
    adultBuckets.set(identity.key, currentBucket);
  });

  adultBuckets.forEach(({ query, contents: groupedItems }, key) => {
    if (groupedItems.length === 1) {
      cardGroups.push(
        buildSingleDownloadedContentCardGroup(groupedItems[0], query)
      );
      return;
    }

    cardGroups.push(
      buildGroupedDownloadedContentCardGroup(key, query, 'adult', groupedItems)
    );
  });

  titleBuckets.forEach(({ title, contents: groupedItems }, key) => {
    if (groupedItems.length === 1) {
      cardGroups.push(buildSingleDownloadedContentCardGroup(groupedItems[0]));
      return;
    }

    cardGroups.push(
      buildGroupedDownloadedContentCardGroup(key, title, 'title', groupedItems)
    );
  });

  return [...cardGroups].sort(
    (left, right) => right.updatedAt - left.updatedAt
  );
}

function buildGroupedOfflineEpisodeEntries(params: {
  contents: DownloadedContentMeta[];
  activeContentId: string;
}): GroupedOfflineEpisodeEntry[] {
  const { contents, activeContentId } = params;

  return contents
    .flatMap((groupedContent) =>
      sortDownloadedEpisodes(groupedContent.episodes).map((episode) => ({
        contentId: groupedContent.contentId,
        sourceName: groupedContent.sourceName,
        contentTitle: groupedContent.title,
        poster: groupedContent.poster,
        remarks: groupedContent.remarks,
        year: groupedContent.year,
        typeName: groupedContent.typeName,
        desc: groupedContent.desc,
        rootManifestUrl: episode.rootManifestUrl,
        playbackManifestUrl: episode.playbackManifestUrl,
        episodeIndex: episode.episodeIndex,
        episodeTitle: episode.episodeTitle,
        sizeBytes: episode.sizeBytes,
        downloadedAt: episode.downloadedAt,
        offlineHref: buildOfflinePlayHref({
          content: groupedContent,
          episodeIndex: episode.episodeIndex,
        }),
        isCurrentContent: groupedContent.contentId === activeContentId,
      }))
    )
    .sort((left, right) => {
      if (left.episodeIndex !== right.episodeIndex) {
        return left.episodeIndex - right.episodeIndex;
      }

      if (left.isCurrentContent !== right.isCurrentContent) {
        return left.isCurrentContent ? -1 : 1;
      }

      if (right.downloadedAt !== left.downloadedAt) {
        return right.downloadedAt - left.downloadedAt;
      }

      return left.sourceName.localeCompare(right.sourceName, 'zh-CN');
    });
}

function buildEpisodeSelectionKey(
  contentId: string,
  episodeIndex: number
): string {
  return `${contentId}::${episodeIndex}`;
}

function getMoreDownloadEpisodeStatus(
  option: MoreDownloadEpisodeOption
): string {
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

function getAdultRelatedDownloadStatus(
  option: AdultRelatedDownloadOption
): string {
  if (option.totalEpisodes <= 0) {
    return '当前资源没有可下载剧集';
  }

  if (option.downloadedEpisodeCount >= option.totalEpisodes) {
    return option.totalEpisodes > 1 ? '已全部缓存' : '已缓存';
  }

  if (option.activeEpisodeCount > 0) {
    return option.totalEpisodes > 1
      ? `${option.activeEpisodeCount} 集在队列中`
      : '已在下载队列中';
  }

  if (option.isActionable) {
    return option.totalEpisodes > 1
      ? `可加入 ${option.actionableEpisodeIndexes.length} 集`
      : '可加入下载队列';
  }

  if (option.pausedOrErrorEpisodeCount > 0) {
    return option.totalEpisodes > 1
      ? `${option.pausedOrErrorEpisodeCount} 集可恢复`
      : '当前资源可恢复下载';
  }

  return '当前没有可加入的剧集';
}

function getAdultRelatedDownloadActionLabel(
  option: AdultRelatedDownloadOption
): string {
  if (option.totalEpisodes <= 0) {
    return '不可下载';
  }

  if (option.downloadedEpisodeCount >= option.totalEpisodes) {
    return '已缓存';
  }

  if (option.activeEpisodeCount > 0 && !option.isActionable) {
    return '队列中';
  }

  if (!option.isActionable) {
    return '不可下载';
  }

  if (option.totalEpisodes > 1) {
    return `下载 ${option.actionableEpisodeIndexes.length} 集`;
  }

  return '下载';
}

function getAdultRelatedDownloadActionBadgeClassName(
  option: AdultRelatedDownloadOption
): string {
  if (option.totalEpisodes <= 0) {
    return 'border-white/10 bg-white/5 text-gray-500';
  }

  if (option.downloadedEpisodeCount >= option.totalEpisodes) {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200';
  }

  if (option.activeEpisodeCount > 0 && !option.isActionable) {
    return 'border-sky-500/20 bg-sky-500/10 text-sky-200';
  }

  if (!option.isActionable) {
    return 'border-white/10 bg-white/5 text-gray-500';
  }

  return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200';
}

function getBatchFeedbackMessage(params: {
  queuedCount: number;
  restartedCount: number;
  skippedCount: number;
}): string {
  const parts: string[] = [];

  if (params.queuedCount > 0) {
    parts.push(`已加入 ${params.queuedCount} 集`);
  }

  if (params.restartedCount > 0) {
    parts.push(`已重下 ${params.restartedCount} 集`);
  }

  if (params.skippedCount > 0) {
    parts.push(`跳过 ${params.skippedCount} 集`);
  }

  return parts.length > 0 ? `${parts.join('，')}。` : '没有可处理的剧集。';
}

interface ActiveTasksSectionProps {
  activeTaskGroups: ActiveTaskCardGroup[];
  totalContentCount: number;
  activeContentId?: string | null;
  onOpenContent: (contentId: string) => void;
}

interface ActiveTaskDialogProps {
  group: ActiveTaskCardGroup;
  onClose: () => void;
}

interface DownloadedContentsSectionProps {
  contentGroups: DownloadedContentCardGroup[];
  totalContentCount: number;
  activeContentId?: string | null;
  onOpenContent: (contentId: string) => void;
}

interface DownloadedContentDialogProps {
  content: DownloadedContentMeta;
  contentGroup: DownloadedContentCardGroup;
  onSelectContent: (contentId: string) => void;
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

  const groups = Array.from(taskGroups.values()).map((groupTasks) => {
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
      (sum, task) => sum + Math.max(0, task.downloadSpeedBytesPerSecond || 0),
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
      createdAt: leadTask.createdAt,
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
      errorCount: sortedTasks.filter((task) => task.status === 'error').length,
    };
  });

  return sortActiveDownloadTaskGroups(groups);
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

function getActiveTaskGroupStatusBadgeClassName(
  group: ActiveTaskGroup
): string {
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

  return group.tasks.length > 1
    ? `${group.tasks.length} 个任务`
    : '等待资源清单';
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

function getGroupedCollectionLabel(groupingKind?: 'adult' | 'title'): string {
  return groupingKind === 'adult' ? '同人名归集' : '同名聚合';
}

function ActiveTasksSection({
  activeTaskGroups,
  totalContentCount,
  activeContentId,
  onOpenContent,
}: ActiveTasksSectionProps) {
  const totalTaskCount = useMemo(
    () => activeTaskGroups.reduce((sum, group) => sum + group.tasks.length, 0),
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
          {activeTaskGroups.length === totalContentCount
            ? `${activeTaskGroups.length} 部内容`
            : `${activeTaskGroups.length} 个归集卡片 · ${totalContentCount} 部内容`}{' '}
          · {totalTaskCount} 个任务
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
              key={group.id}
              onClick={() => onOpenContent(group.contentId)}
              className={`group w-full overflow-hidden rounded-[22px] border text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-xl sm:w-[220px] xl:w-[238px] ${
                group.memberContentIds.includes(activeContentId || '')
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
                    {group.groupedContentCount > 1 ? (
                      <>
                        <span>
                          {getGroupedCollectionLabel(group.groupingKind)}
                        </span>
                        <span>{group.groupedContentCount} 部资源</span>
                      </>
                    ) : (
                      <>
                        <span>{group.sourceName}</span>
                        {group.year && group.year !== 'unknown' && (
                          <span>{group.year}</span>
                        )}
                      </>
                    )}
                    <span>{group.tasks.length} 个任务</span>
                  </div>
                </div>
              </div>

              <div className='space-y-2 px-3 pb-3 pt-2'>
                <div className='space-y-1 text-xs text-gray-500 dark:text-gray-400'>
                  <span className='block break-words leading-4'>
                    {getActiveTaskGroupResourceSummary(group)}
                  </span>
                  <span className='block break-words text-right leading-4'>
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
  const activeTasks = useMemo(
    () => sortActiveDownloadTasks(group.tasks),
    [group.tasks]
  );
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
            <div className='min-w-0 flex-1 space-y-3'>
              <div className='text-xs font-medium uppercase tracking-[0.24em] text-emerald-300/80'>
                进行中的任务
              </div>
              <div className='break-words text-2xl font-semibold text-white'>
                {group.title}
              </div>
              <div className='flex flex-wrap items-center gap-2 text-sm text-gray-300'>
                {group.groupedContentCount > 1 ? (
                  <>
                    <span>{getGroupedCollectionLabel(group.groupingKind)}</span>
                    <span>{group.groupedContentCount} 部资源</span>
                  </>
                ) : (
                  <>
                    <span>{group.sourceName}</span>
                    {group.year && group.year !== 'unknown' && (
                      <span>{group.year}</span>
                    )}
                  </>
                )}
                <span>{group.tasks.length} 个任务</span>
                <span>{group.progress}%</span>
              </div>
            </div>

            <button
              type='button'
              onClick={onClose}
              className='inline-flex h-10 min-w-[72px] shrink-0 items-center justify-center rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10'
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
                {group.groupedContentCount > 1 ? (
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-gray-400'>
                      {group.groupingKind === 'adult' ? '归集人名' : '归集标题'}
                    </span>
                    <span>{group.adultGroupingQuery || group.title}</span>
                  </div>
                ) : null}
                {group.groupedContentCount > 1 ? (
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-gray-400'>归集资源</span>
                    <span>{group.groupedContentCount} 部内容</span>
                  </div>
                ) : null}
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
                  <span>
                    {formatTransferRate(group.downloadSpeedBytesPerSecond)}
                  </span>
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
                      {group.groupedContentCount > 1 ? (
                        <div
                          className='mb-2 truncate text-[11px] text-gray-400'
                          title={`${task.sourceName} · ${task.title}`}
                        >
                          {task.sourceName} · {task.title}
                        </div>
                      ) : null}
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
                            {task.downloadedResources}/{task.totalResources}{' '}
                            个资源
                          </span>
                        ) : (
                          <span>等待资源清单</span>
                        )}
                        <span>{task.progress}%</span>
                      </div>

                      <div className='mt-2 flex items-center justify-between gap-3 text-[11px] text-gray-300'>
                        <span>{formatTaskSizeProgress(task)}</span>
                        <span>
                          {formatTransferRate(task.downloadSpeedBytesPerSecond)}
                        </span>
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
                          onClick={() =>
                            void handleTaskAction(task.id, 'cancel')
                          }
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
  contentGroups,
  totalContentCount,
  activeContentId,
  onOpenContent,
}: DownloadedContentsSectionProps) {
  return (
    <section className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
          已下载内容
        </h2>
        <span className='text-sm text-gray-500 dark:text-gray-400'>
          {contentGroups.length === totalContentCount
            ? `${contentGroups.length} 部内容`
            : `${contentGroups.length} 个归集卡片 · ${totalContentCount} 部内容`}
        </span>
      </div>

      {contentGroups.length === 0 ? (
        <div className='rounded-2xl border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
          还没有可离线播放的内容。
        </div>
      ) : (
        <div className='flex flex-wrap gap-4'>
          {contentGroups.map((contentGroup) => (
            <button
              type='button'
              key={contentGroup.id}
              onClick={() => onOpenContent(contentGroup.contentId)}
              className={`group w-full overflow-hidden rounded-[22px] border text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-xl sm:w-[220px] xl:w-[238px] ${
                contentGroup.contents.some(
                  (content) => content.contentId === activeContentId
                )
                  ? 'border-emerald-400/70 bg-emerald-50/40 shadow-lg shadow-emerald-500/10 dark:border-emerald-500/60 dark:bg-emerald-950/20'
                  : 'border-gray-200 bg-white/80 shadow-sm hover:border-emerald-300/60 dark:border-gray-800 dark:bg-gray-900/50'
              }`}
              aria-haspopup='dialog'
              aria-label={`查看 ${contentGroup.title} 的离线资源详情`}
            >
              <div className='relative aspect-[4/5] overflow-hidden bg-gray-900'>
                {contentGroup.poster ? (
                  <Image
                    src={processImageUrl(contentGroup.poster)}
                    alt={contentGroup.title}
                    fill
                    className='object-cover transition-transform duration-500 group-hover:scale-105'
                    referrerPolicy='no-referrer'
                    sizes='(max-width: 640px) 100vw, 238px'
                  />
                ) : (
                  <div className='absolute inset-0 flex items-center justify-center bg-gradient-to-br from-emerald-700/60 via-gray-900 to-black text-4xl font-semibold text-white/80'>
                    {contentGroup.title.slice(0, 1)}
                  </div>
                )}

                <div className='absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent' />

                <div className='absolute left-3 top-3 inline-flex rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm'>
                  {contentGroup.contents.length > 1
                    ? `${contentGroup.contents.length} 部资源`
                    : `${contentGroup.totalEpisodeCount} 集已下载`}
                </div>

                <div className='absolute right-3 top-3 inline-flex rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm'>
                  {formatBytes(contentGroup.totalSizeBytes)}
                </div>

                <div className='absolute inset-x-0 bottom-0 p-3 text-white'>
                  <div
                    className='line-clamp-2 text-base font-semibold leading-tight'
                    title={contentGroup.title}
                  >
                    {contentGroup.title}
                  </div>
                  <div className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/75'>
                    {contentGroup.contents.length > 1 ? (
                      <>
                        <span>
                          {getGroupedCollectionLabel(contentGroup.groupingKind)}
                        </span>
                        <span>{contentGroup.totalEpisodeCount} 集已下载</span>
                      </>
                    ) : (
                      <>
                        <span>{contentGroup.sourceName}</span>
                        {contentGroup.year &&
                        contentGroup.year !== 'unknown' ? (
                          <span>{contentGroup.year}</span>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className='px-3 pb-3 pt-2'>
                <div className='flex items-center justify-between text-xs text-gray-500 dark:text-gray-400'>
                  <span>最近更新</span>
                  <span>{formatDateTime(contentGroup.updatedAt)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function DownloadedContentDialog({
  content,
  contentGroup,
  onSelectContent,
  onClose,
  onDeleteEpisode,
}: DownloadedContentDialogProps) {
  const router = useRouter();
  const { beginNavigation } = useNavigationFeedback();
  const tasks = useDownloadStore((state) => state.tasks);
  const library = useDownloadStore((state) => state.library);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedEpisodeKeys, setSelectedEpisodeKeys] = useState<string[]>([]);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [isRestartingSelected, setIsRestartingSelected] = useState(false);
  const [isTitleGroupingEnabled, setIsTitleGroupingEnabled] = useState(
    contentGroup.groupingKind === 'title'
  );
  const [selectionFeedback, setSelectionFeedback] = useState<string | null>(
    null
  );
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [isMoreDownloadsOpen, setIsMoreDownloadsOpen] = useState(false);
  const [downloadableDetail, setDownloadableDetail] =
    useState<SearchResult | null>(null);
  const [downloadableAvailableSources, setDownloadableAvailableSources] =
    useState<SearchResult[]>([]);
  const [isLoadingDownloadableDetail, setIsLoadingDownloadableDetail] =
    useState(false);
  const [adultGroupedContents, setAdultGroupedContents] = useState<
    SearchResult[]
  >([]);
  const [isLoadingAdultGroupedContents, setIsLoadingAdultGroupedContents] =
    useState(false);
  const [hasLoadedAdultGroupedContents, setHasLoadedAdultGroupedContents] =
    useState(false);
  const [moreDownloadsError, setMoreDownloadsError] = useState<string | null>(
    null
  );
  const [moreDownloadsFeedback, setMoreDownloadsFeedback] = useState<
    string | null
  >(null);
  const [groupedEpisodeDurationByKey, setGroupedEpisodeDurationByKey] =
    useState<Record<string, string>>({});
  const [pendingOfflineNavigationKey, setPendingOfflineNavigationKey] =
    useState<string | null>(null);
  const detailRequestKeyRef = useRef(`${content.source}:${content.vodId}`);
  const dialogMenuRef = useRef<HTMLDivElement | null>(null);
  const adultCoverMenuRef = useRef<HTMLDivElement | null>(null);
  const closeFrameRef = useRef<number | null>(null);
  const offlineNavigationResetTimerRef = useRef<number | null>(null);
  const [isDialogMenuOpen, setIsDialogMenuOpen] = useState(false);
  const [adultCoverMenu, setAdultCoverMenu] =
    useState<AdultGroupCoverMenuState | null>(null);
  const shouldCollapseDescription = (content.desc?.length || 0) > 140;
  const isAdultContent = useMemo(
    () =>
      isAdultContentResult({
        title: content.title,
        type_name: content.typeName,
        source_name: content.sourceName,
        desc: content.desc,
      }),
    [content.desc, content.sourceName, content.title, content.typeName]
  );
  const adultGroupingQuery = useMemo(
    () =>
      contentGroup.adultGroupingQuery ||
      buildAdultDownloadGroupingQuery({
        title: content.title,
        searchTitle: content.searchTitle,
        sourceName: content.sourceName,
        desc: content.desc,
        typeName: content.typeName,
      }),
    [
      content.desc,
      content.searchTitle,
      content.sourceName,
      content.title,
      content.typeName,
      contentGroup.adultGroupingQuery,
    ]
  );
  const titleGroupingIdentity = useMemo(
    () => getTitleGroupingIdentity(content.title),
    [content.title]
  );
  const localTitleGroupedContents = useMemo(
    () =>
      titleGroupingIdentity
        ? Object.values(library)
            .filter((libraryItem) => {
              const isLibraryItemAdult = Boolean(
                getAdultGroupingIdentity({
                  title: libraryItem.title,
                  searchTitle: libraryItem.searchTitle,
                  sourceName: libraryItem.sourceName,
                  desc: libraryItem.desc,
                  typeName: libraryItem.typeName,
                })
              );

              if (isLibraryItemAdult !== isAdultContent) {
                return false;
              }

              return (
                getTitleGroupingIdentity(libraryItem.title)?.key ===
                titleGroupingIdentity.key
              );
            })
            .sort((left, right) => right.updatedAt - left.updatedAt)
        : [],
    [isAdultContent, library, titleGroupingIdentity]
  );
  const localTitleContentGroup = useMemo(
    () =>
      titleGroupingIdentity && localTitleGroupedContents.length > 1
        ? buildGroupedDownloadedContentCardGroup(
            titleGroupingIdentity.key,
            titleGroupingIdentity.title,
            'title',
            localTitleGroupedContents
          )
        : null,
    [localTitleGroupedContents, titleGroupingIdentity]
  );
  const canToggleLocalTitleGrouping = Boolean(
    localTitleContentGroup && localTitleGroupedContents.length > 1
  );
  const hasDialogMenuActions = isAdultContent || canToggleLocalTitleGrouping;
  const effectiveContentGroup = useMemo(
    () =>
      isTitleGroupingEnabled && localTitleContentGroup
        ? localTitleContentGroup
        : contentGroup.groupingKind === 'adult'
        ? contentGroup
        : null,
    [contentGroup, isTitleGroupingEnabled, localTitleContentGroup]
  );
  const groupedResolvedContents = useMemo(
    () =>
      (effectiveContentGroup?.contents || contentGroup.contents).map(
        (groupedContent) => library[groupedContent.contentId] || groupedContent
      ),
    [contentGroup.contents, effectiveContentGroup, library]
  );
  const isGroupedCollection =
    Boolean(effectiveContentGroup?.groupingKind) &&
    groupedResolvedContents.length > 1;
  const groupedCollectionLabel = getGroupedCollectionLabel(
    effectiveContentGroup?.groupingKind
  );
  const groupedCollectionIdentity =
    effectiveContentGroup?.groupingKind === 'adult'
      ? adultGroupingQuery || effectiveContentGroup.title
      : effectiveContentGroup?.title || content.title;
  const groupedCollectionEpisodeCount =
    effectiveContentGroup?.totalEpisodeCount || content.episodes.length;
  const groupedCollectionTotalSizeBytes =
    effectiveContentGroup?.totalSizeBytes || content.totalSizeBytes;
  const groupedCollectionKind = effectiveContentGroup?.groupingKind;
  const isAdultGroupedCollection =
    groupedCollectionKind === 'adult' && isGroupedCollection;
  const dialogTitle =
    isAdultGroupedCollection && groupedCollectionIdentity
      ? groupedCollectionIdentity
      : content.title;
  const dialogPosterTitle = isAdultGroupedCollection
    ? dialogTitle
    : content.title;
  const dialogPosterAlt = isAdultGroupedCollection
    ? `${dialogPosterTitle} 归集图`
    : dialogPosterTitle;
  const dialogPoster = useMemo(() => {
    if (!isAdultGroupedCollection) {
      return content.poster;
    }

    const groupedPoster = getAdultGroupPoster(groupedResolvedContents);
    if (groupedPoster) {
      return groupedPoster;
    }

    return content.poster;
  }, [content.poster, groupedResolvedContents, isAdultGroupedCollection]);
  const usesAdultSingleEpisodeLayout =
    isAdultGroupedCollection && content.episodes.length === 1;
  const groupedPlayableEpisodes = useMemo(
    () =>
      isGroupedCollection
        ? buildGroupedOfflineEpisodeEntries({
            contents: groupedResolvedContents,
            activeContentId: content.contentId,
          })
        : [],
    [content.contentId, groupedResolvedContents, isGroupedCollection]
  );
  const groupedPlayableEpisodeCount = useMemo(
    () =>
      new Set(groupedPlayableEpisodes.map((episode) => episode.episodeIndex))
        .size,
    [groupedPlayableEpisodes]
  );
  const groupedPlayableSourceNames = useMemo(
    () =>
      Array.from(
        new Set(groupedPlayableEpisodes.map((episode) => episode.sourceName))
      ),
    [groupedPlayableEpisodes]
  );
  const groupedPlayableEpisodeTitleCount = useMemo(
    () =>
      new Set(
        groupedPlayableEpisodes
          .map((episode) => episode.episodeTitle.trim())
          .filter(Boolean)
      ).size,
    [groupedPlayableEpisodes]
  );
  const shouldShowGroupedEpisodeList =
    isGroupedCollection && groupedPlayableEpisodes.length > 0;
  const shouldShowEpisodeGrid =
    !shouldShowGroupedEpisodeList &&
    (!usesAdultSingleEpisodeLayout || isEditing);
  const shouldShowAdultGroupedSourceSummary =
    isAdultGroupedCollection && groupedPlayableSourceNames.length > 1;
  const shouldShowAdultGroupedEpisodeCode =
    !isAdultGroupedCollection || groupedPlayableEpisodeCount > 1;
  const shouldShowAdultGroupedEpisodeTitle =
    !isAdultGroupedCollection || groupedPlayableEpisodeTitleCount > 1;
  const selectableEpisodes = useMemo<SelectableEpisodeTarget[]>(
    () =>
      shouldShowGroupedEpisodeList
        ? groupedPlayableEpisodes.map((episode) => ({
            key: buildEpisodeSelectionKey(
              episode.contentId,
              episode.episodeIndex
            ),
            contentId: episode.contentId,
            episodeIndex: episode.episodeIndex,
            episodeTitle: episode.episodeTitle,
          }))
        : content.episodes.map((episode) => ({
            key: buildEpisodeSelectionKey(
              content.contentId,
              episode.episodeIndex
            ),
            contentId: content.contentId,
            episodeIndex: episode.episodeIndex,
            episodeTitle: episode.episodeTitle,
          })),
    [
      content.contentId,
      content.episodes,
      groupedPlayableEpisodes,
      shouldShowGroupedEpisodeList,
    ]
  );
  const allSelectableEpisodeKeys = useMemo(
    () => selectableEpisodes.map((episode) => episode.key),
    [selectableEpisodes]
  );
  const selectedEpisodeKeySet = useMemo(
    () => new Set(selectedEpisodeKeys),
    [selectedEpisodeKeys]
  );
  const selectedEpisodeTargets = useMemo(
    () =>
      selectableEpisodes.filter((episode) =>
        selectedEpisodeKeySet.has(episode.key)
      ),
    [selectableEpisodes, selectedEpisodeKeySet]
  );
  const downloadedEpisodeIndexSet = useMemo(
    () => new Set(content.episodes.map((episode) => episode.episodeIndex)),
    [content.episodes]
  );
  const allEpisodesSelected =
    allSelectableEpisodeKeys.length > 0 &&
    allSelectableEpisodeKeys.every((episodeKey) =>
      selectedEpisodeKeySet.has(episodeKey)
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
  const moreDownloadEpisodeOptions = useMemo<
    MoreDownloadEpisodeOption[]
  >(() => {
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
  const adultRelatedDownloadOptions = useMemo<AdultRelatedDownloadOption[]>(
    () =>
      adultGroupedContents
        .map((detail) => {
          const contentId = buildAdultContentMatchKey(detail);
          const libraryItem = library[contentId];
          const downloadedEpisodeIndexSet = new Set(
            libraryItem?.episodes.map((episode) => episode.episodeIndex) || []
          );
          const availableEpisodeIndexes = detail.episodes
            .map((episodeUrl, episodeIndex) =>
              episodeUrl ? episodeIndex : null
            )
            .filter(
              (episodeIndex): episodeIndex is number => episodeIndex !== null
            );
          const actionableEpisodeIndexes = availableEpisodeIndexes.filter(
            (episodeIndex) => {
              const task = tasks[buildDownloadTaskId(contentId, episodeIndex)];
              const isDownloaded =
                downloadedEpisodeIndexSet.has(episodeIndex) ||
                task?.status === 'done';

              return (
                !isDownloaded &&
                (!task || ['paused', 'error'].includes(task.status))
              );
            }
          );
          const downloadedEpisodeCount = availableEpisodeIndexes.filter(
            (episodeIndex) => {
              const task = tasks[buildDownloadTaskId(contentId, episodeIndex)];
              return (
                downloadedEpisodeIndexSet.has(episodeIndex) ||
                task?.status === 'done'
              );
            }
          ).length;
          const activeEpisodeCount = availableEpisodeIndexes.filter(
            (episodeIndex) => {
              const task = tasks[buildDownloadTaskId(contentId, episodeIndex)];
              return ['downloading', 'queued'].includes(task?.status || '');
            }
          ).length;
          const pausedOrErrorEpisodeCount = availableEpisodeIndexes.filter(
            (episodeIndex) => {
              const task = tasks[buildDownloadTaskId(contentId, episodeIndex)];
              return ['paused', 'error'].includes(task?.status || '');
            }
          ).length;

          return {
            contentId,
            detail,
            totalEpisodes: availableEpisodeIndexes.length,
            actionableEpisodeIndexes,
            downloadedEpisodeCount,
            activeEpisodeCount,
            pausedOrErrorEpisodeCount,
            isActionable: actionableEpisodeIndexes.length > 0,
          };
        })
        .sort((left, right) => {
          if (left.isActionable !== right.isActionable) {
            return left.isActionable ? -1 : 1;
          }

          if (right.totalEpisodes !== left.totalEpisodes) {
            return right.totalEpisodes - left.totalEpisodes;
          }

          return left.detail.title.localeCompare(right.detail.title, 'zh-CN');
        }),
    [adultGroupedContents, library, tasks]
  );

  useEffect(() => {
    detailRequestKeyRef.current = `${content.source}:${content.vodId}`;
    setIsDescriptionExpanded(false);
    setIsEditing(false);
    setSelectedEpisodeKeys([]);
    setIsDeletingSelected(false);
    setIsRestartingSelected(false);
    setSelectionFeedback(null);
    setSelectionError(null);
    setIsMoreDownloadsOpen(false);
    setDownloadableDetail(null);
    setDownloadableAvailableSources([]);
    setIsLoadingDownloadableDetail(false);
    setAdultGroupedContents([]);
    setIsLoadingAdultGroupedContents(false);
    setHasLoadedAdultGroupedContents(false);
    setMoreDownloadsError(null);
    setMoreDownloadsFeedback(null);
    setGroupedEpisodeDurationByKey({});
    setPendingOfflineNavigationKey(null);
    setIsDialogMenuOpen(false);
    setAdultCoverMenu(null);
  }, [content.contentId, content.source, content.vodId]);

  useEffect(() => {
    if (!isAdultGroupedCollection || !shouldShowGroupedEpisodeList) {
      setGroupedEpisodeDurationByKey({});
      return;
    }

    let cancelled = false;
    setGroupedEpisodeDurationByKey({});

    const loadGroupedEpisodeDurations = async () => {
      const durationEntries = await Promise.all(
        groupedPlayableEpisodes.map(async (episode) => {
          const durationSeconds = await getDownloadedEpisodeDurationSeconds({
            playbackManifestUrl: episode.playbackManifestUrl,
            rootManifestUrl: episode.rootManifestUrl,
          }).catch(() => null);

          return [
            buildEpisodeSelectionKey(episode.contentId, episode.episodeIndex),
            typeof durationSeconds === 'number' &&
            Number.isFinite(durationSeconds) &&
            durationSeconds > 0
              ? formatDurationLabel(durationSeconds)
              : null,
          ] as const;
        })
      );

      if (cancelled) {
        return;
      }

      const nextDurationMap = durationEntries.reduce<Record<string, string>>(
        (result, [episodeKey, durationLabel]) => {
          if (durationLabel) {
            result[episodeKey] = durationLabel;
          }

          return result;
        },
        {}
      );

      if (Object.keys(nextDurationMap).length === 0) {
        return;
      }

      setGroupedEpisodeDurationByKey(nextDurationMap);
    };

    void loadGroupedEpisodeDurations();

    return () => {
      cancelled = true;
    };
  }, [
    groupedPlayableEpisodes,
    isAdultGroupedCollection,
    shouldShowGroupedEpisodeList,
  ]);

  useEffect(() => {
    setIsTitleGroupingEnabled(contentGroup.groupingKind === 'title');
  }, [contentGroup.groupingKind, titleGroupingIdentity?.key]);

  useEffect(
    () => () => {
      if (closeFrameRef.current !== null) {
        window.cancelAnimationFrame(closeFrameRef.current);
      }

      if (offlineNavigationResetTimerRef.current !== null) {
        window.clearTimeout(offlineNavigationResetTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!isDialogMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        dialogMenuRef.current &&
        !dialogMenuRef.current.contains(event.target as Node)
      ) {
        setIsDialogMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isDialogMenuOpen]);

  useEffect(() => {
    if (!adultCoverMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        adultCoverMenuRef.current &&
        !adultCoverMenuRef.current.contains(event.target as Node)
      ) {
        setAdultCoverMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAdultCoverMenu(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [adultCoverMenu]);

  useEffect(() => {
    setSelectedEpisodeKeys((currentState) => {
      const nextState = currentState.filter((episodeKey) =>
        allSelectableEpisodeKeys.includes(episodeKey)
      );

      return nextState.length === currentState.length
        ? currentState
        : nextState;
    });
  }, [allSelectableEpisodeKeys]);

  const handleToggleEditing = () => {
    setAdultCoverMenu(null);
    setIsEditing((currentState) => {
      if (currentState) {
        setSelectedEpisodeKeys([]);
      }

      return !currentState;
    });
    setSelectionError(null);
    setSelectionFeedback(null);
  };

  const handleToggleSelectAll = () => {
    setSelectedEpisodeKeys(allEpisodesSelected ? [] : allSelectableEpisodeKeys);
  };

  const handleToggleEpisodeSelection = (
    contentId: string,
    episodeIndex: number
  ) => {
    const targetKey = buildEpisodeSelectionKey(contentId, episodeIndex);

    setSelectedEpisodeKeys((currentState) =>
      currentState.includes(targetKey)
        ? currentState.filter((currentKey) => currentKey !== targetKey)
        : [...currentState, targetKey]
    );
  };

  const handleOpenOfflinePlayback = (params: {
    href: string;
    selectionKey: string;
    label: string;
  }) => {
    const { href, selectionKey, label } = params;

    if (offlineNavigationResetTimerRef.current !== null) {
      window.clearTimeout(offlineNavigationResetTimerRef.current);
      offlineNavigationResetTimerRef.current = null;
    }

    flushSync(() => {
      setPendingOfflineNavigationKey(selectionKey);
      beginNavigation({
        href,
        kind: 'card',
        label,
      });
    });

    router.prefetch(href);

    offlineNavigationResetTimerRef.current = window.setTimeout(() => {
      setPendingOfflineNavigationKey(null);
      offlineNavigationResetTimerRef.current = null;
    }, 8000);

    window.setTimeout(() => {
      router.push(href);
    }, 0);
  };

  const handleOpenAdultCoverMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    params: {
      poster: string;
      title: string;
    }
  ) => {
    if (!isAdultGroupedCollection || isEditing) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsDialogMenuOpen(false);

    const menuWidth = 176;
    const menuHeight = 64;
    const viewportPadding = 12;

    setAdultCoverMenu({
      poster: params.poster.trim(),
      title: params.title,
      x: Math.max(
        viewportPadding,
        Math.min(event.clientX, window.innerWidth - menuWidth - viewportPadding)
      ),
      y: Math.max(
        viewportPadding,
        Math.min(
          event.clientY,
          window.innerHeight - menuHeight - viewportPadding
        )
      ),
    });
  };

  const handleSetAdultGroupPoster = () => {
    if (!adultCoverMenu || !isAdultGroupedCollection) {
      return;
    }

    const targetPoster = adultCoverMenu.poster.trim();
    if (!targetPoster) {
      setSelectionFeedback(null);
      setSelectionError('当前资源没有可用封面');
      setAdultCoverMenu(null);
      return;
    }

    const { library: latestLibrary, upsertLibraryItem } =
      useDownloadStore.getState();
    const targetContents = groupedResolvedContents.map(
      (groupedContent) =>
        latestLibrary[groupedContent.contentId] || groupedContent
    );

    targetContents.forEach((groupedContent) => {
      upsertLibraryItem({
        ...groupedContent,
        adultGroupPoster: targetPoster,
        updatedAt: groupedContent.updatedAt,
      });
    });

    setSelectionError(null);
    setSelectionFeedback(`已将 ${adultCoverMenu.title} 设为归集封面。`);
    setAdultCoverMenu(null);
  };

  const handleDeleteSelectedEpisodes = async () => {
    if (selectedEpisodeTargets.length === 0 || isDeletingSelected) {
      return;
    }

    setSelectionError(null);
    setSelectionFeedback(null);
    setIsDeletingSelected(true);

    try {
      for (const selectedEpisode of selectedEpisodeTargets) {
        await onDeleteEpisode(
          selectedEpisode.contentId,
          selectedEpisode.episodeIndex
        );
      }

      setSelectionFeedback(
        `已删除 ${selectedEpisodeTargets.length} 条离线内容。`
      );
      setSelectedEpisodeKeys([]);
    } catch (error) {
      setSelectionError(
        error instanceof Error ? error.message : '删除离线内容失败'
      );
    } finally {
      setIsDeletingSelected(false);
    }
  };

  const resolveDownloadableContent = async (
    targetContent: DownloadedContentMeta
  ): Promise<{
    detail: SearchResult;
    availableSources: SearchResult[];
  }> => {
    const [detailResponse, matchedSources] = await Promise.all([
      (async () => {
        const searchParams = new URLSearchParams({
          source: targetContent.source,
          id: targetContent.vodId,
        });
        const response = await fetch(`/api/detail?${searchParams.toString()}`, {
          cache: 'no-store',
        });
        const payload = (await response.json()) as SearchResult & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || '获取可下载剧集失败');
        }

        return payload;
      })(),
      searchPlaybackSources({
        title: targetContent.title,
        year:
          targetContent.year && targetContent.year !== 'unknown'
            ? targetContent.year
            : undefined,
        searchType: targetContent.searchType,
        query: targetContent.searchTitle || undefined,
        doubanId: targetContent.doubanId,
        allowAdultCandidates: isAdultContentResult({
          title: targetContent.title,
          type_name: targetContent.typeName,
          source_name: targetContent.sourceName,
          desc: targetContent.desc,
        }),
      }).catch(() => []),
    ]);

    const normalizedDetail = normalizeVodDetailForPlayback(detailResponse);
    const nextAvailableSources = matchedSources.filter(
      (source) =>
        buildSearchResultKey(source) !== buildSearchResultKey(normalizedDetail)
    );

    return {
      detail: normalizedDetail,
      availableSources: nextAvailableSources,
    };
  };

  const loadDownloadableDetail = async (): Promise<{
    detail: SearchResult;
    availableSources: SearchResult[];
  } | null> => {
    if (downloadableDetail) {
      return {
        detail: downloadableDetail,
        availableSources: downloadableAvailableSources,
      };
    }

    if (isLoadingDownloadableDetail) {
      return null;
    }

    const requestKey = `${content.source}:${content.vodId}`;

    try {
      setIsLoadingDownloadableDetail(true);
      setMoreDownloadsError(null);
      const resolvedContent = await resolveDownloadableContent(content);

      if (detailRequestKeyRef.current !== requestKey) {
        return null;
      }

      setDownloadableDetail(resolvedContent.detail);
      setDownloadableAvailableSources(resolvedContent.availableSources);
      return resolvedContent;
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

  const handleRestartSelectedEpisodes = async () => {
    if (selectedEpisodeTargets.length === 0 || isRestartingSelected) {
      return;
    }

    setSelectionError(null);
    setSelectionFeedback(null);
    setIsRestartingSelected(true);

    try {
      const episodeIndexesByContentId = new Map<string, number[]>();

      selectedEpisodeTargets.forEach((selectedEpisode) => {
        const currentEpisodeIndexes =
          episodeIndexesByContentId.get(selectedEpisode.contentId) || [];
        currentEpisodeIndexes.push(selectedEpisode.episodeIndex);
        episodeIndexesByContentId.set(
          selectedEpisode.contentId,
          currentEpisodeIndexes
        );
      });

      const aggregateResult = {
        queuedCount: 0,
        restartedCount: 0,
        skippedCount: 0,
      };

      for (const [targetContentId, episodeIndexes] of Array.from(
        episodeIndexesByContentId.entries()
      )) {
        const targetContent = library[targetContentId];
        if (!targetContent) {
          aggregateResult.skippedCount += episodeIndexes.length;
          continue;
        }

        const resolvedDownloadable =
          targetContentId === content.contentId
            ? (downloadableDetail && {
                detail: downloadableDetail,
                availableSources: downloadableAvailableSources,
              }) ||
              (await loadDownloadableDetail())
            : await resolveDownloadableContent(targetContent);

        if (!resolvedDownloadable) {
          throw new Error('获取可重新下载的剧集失败');
        }

        const result = await downloadManager.restartBatchEpisodeDownloads({
          detail: resolvedDownloadable.detail,
          episodeIndexes,
          availableSources: resolvedDownloadable.availableSources,
          searchTitle: targetContent.searchTitle,
          searchType: targetContent.searchType,
        });

        aggregateResult.queuedCount += result.queuedCount;
        aggregateResult.restartedCount += result.restartedCount;
        aggregateResult.skippedCount += result.skippedCount;
      }

      setSelectionFeedback(getBatchFeedbackMessage(aggregateResult));
      setSelectedEpisodeKeys([]);
    } catch (error) {
      setSelectionError(
        error instanceof Error ? error.message : '重新下载离线内容失败'
      );
    } finally {
      setIsRestartingSelected(false);
    }
  };

  const loadAdultGroupedContents = async (): Promise<SearchResult[]> => {
    if (hasLoadedAdultGroupedContents) {
      return adultGroupedContents;
    }

    if (isLoadingAdultGroupedContents) {
      return [];
    }

    if (!adultGroupingQuery) {
      setMoreDownloadsError(
        '当前条目没有识别出可归集的人名，请用演员名搜索后再下载一次。'
      );
      return [];
    }

    const requestKey = `${content.source}:${content.vodId}`;

    try {
      setIsLoadingAdultGroupedContents(true);
      setMoreDownloadsError(null);

      const response = await apiFetch('/search', {
        cache: 'no-store',
        credentials: 'same-origin',
        searchParams: {
          q: adultGroupingQuery,
          adult: '1',
        },
      });
      const payload = (await response.json()) as {
        results?: SearchResult[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || '获取归集资源失败');
      }

      const normalizedResults = normalizeVodSearchResultsForPlayback(
        Array.isArray(payload.results) ? payload.results : []
      );
      const filteredResults = filterAdultGroupingSearchResults(
        normalizedResults,
        adultGroupingQuery,
        {
          source: content.source,
          id: content.vodId,
          title: content.title,
        }
      );

      if (detailRequestKeyRef.current !== requestKey) {
        return [];
      }

      setAdultGroupedContents(filteredResults);
      setHasLoadedAdultGroupedContents(true);
      return filteredResults;
    } catch (error) {
      if (detailRequestKeyRef.current === requestKey) {
        setMoreDownloadsError(
          error instanceof Error ? error.message : '获取归集资源失败'
        );
      }
      return [];
    } finally {
      if (detailRequestKeyRef.current === requestKey) {
        setIsLoadingAdultGroupedContents(false);
      }
    }
  };

  const handleToggleMoreDownloads = () => {
    const nextOpenState = !isMoreDownloadsOpen;
    setIsMoreDownloadsOpen(nextOpenState);
    setMoreDownloadsError(null);
    setMoreDownloadsFeedback(null);

    if (!nextOpenState) {
      return;
    }

    if (isAdultContent) {
      if (!hasLoadedAdultGroupedContents && !isLoadingAdultGroupedContents) {
        void loadAdultGroupedContents();
      }
      return;
    }

    if (!downloadableDetail && !isLoadingDownloadableDetail) {
      void loadDownloadableDetail();
    }
  };

  const handleStartMoreDownload = async (episodeIndex: number) => {
    const resolvedDownloadable =
      (downloadableDetail && {
        detail: downloadableDetail,
        availableSources: downloadableAvailableSources,
      }) ||
      (await loadDownloadableDetail());
    if (!resolvedDownloadable) {
      return;
    }

    const candidateSources = mergeDownloadableSources(
      resolvedDownloadable.detail,
      resolvedDownloadable.availableSources
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
        detail: resolvedDownloadable.detail,
        episodeIndex,
        availableSources: resolvedDownloadable.availableSources,
        searchTitle: content.searchTitle,
        searchType: content.searchType,
      });
      setMoreDownloadsFeedback(
        `已将 ${getEpisodeTitleFromSources(
          candidateSources,
          episodeIndex
        )} 加入下载队列。`
      );
    } catch (error) {
      setMoreDownloadsError(
        error instanceof Error ? error.message : '加入下载队列失败'
      );
    }
  };

  const handleStartAdultRelatedDownload = async (
    option: AdultRelatedDownloadOption
  ) => {
    if (!option.isActionable) {
      return;
    }

    try {
      setMoreDownloadsError(null);
      setMoreDownloadsFeedback(null);
      await downloadManager.startBatchEpisodeDownloads({
        detail: option.detail,
        episodeIndexes: option.actionableEpisodeIndexes,
        searchTitle: adultGroupingQuery || content.searchTitle,
        searchType: content.searchType,
      });
      setMoreDownloadsFeedback(
        option.actionableEpisodeIndexes.length > 1
          ? `已将 ${option.detail.title} 的 ${option.actionableEpisodeIndexes.length} 集加入下载队列。`
          : `已将 ${option.detail.title} 加入下载队列。`
      );
    } catch (error) {
      setMoreDownloadsError(
        error instanceof Error ? error.message : '加入归集下载队列失败'
      );
    }
  };

  const isLoadingMoreDownloads = isAdultContent
    ? isLoadingAdultGroupedContents
    : isLoadingDownloadableDetail;

  const handleRequestClose = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();

    setIsDialogMenuOpen(false);
    setIsMoreDownloadsOpen(false);
    setIsEditing(false);
    setSelectionFeedback(null);
    setSelectionError(null);
    setMoreDownloadsError(null);
    setMoreDownloadsFeedback(null);
    setAdultCoverMenu(null);

    const closeDialog = () => {
      closeFrameRef.current = null;
      onClose();
    };

    if (typeof window.requestAnimationFrame === 'function') {
      if (closeFrameRef.current !== null) {
        window.cancelAnimationFrame(closeFrameRef.current);
      }

      closeFrameRef.current = window.requestAnimationFrame(() => {
        closeDialog();
      });
      return;
    }

    closeDialog();
  };

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <>
      <div className='fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6'>
        <button
          type='button'
          aria-label='关闭离线资源详情'
          className='absolute inset-0 bg-black/75 backdrop-blur-sm'
          onClick={handleRequestClose}
        />

        <div className='relative z-[10001] flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#040b15]/95 text-white shadow-2xl shadow-black/50'>
          <div className='border-b border-white/10 px-5 py-5 lg:px-6'>
            <div className='flex items-start justify-between gap-4'>
              <div className='min-w-0 flex-1 space-y-3'>
                <div className='text-xs font-medium uppercase tracking-[0.24em] text-emerald-300/80'>
                  已下载资源
                </div>
                <div className='break-words text-2xl font-semibold text-white'>
                  {dialogTitle}
                </div>
                <div className='flex flex-wrap items-center gap-2 text-sm text-gray-300'>
                  <span>{content.sourceName}</span>
                  <span>{content.episodes.length} 集</span>
                  <span>{formatBytes(content.totalSizeBytes)}</span>
                  {isGroupedCollection ? (
                    <span className='rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200'>
                      {isAdultGroupedCollection
                        ? `已归集 ${groupedResolvedContents.length} 部资源`
                        : `${groupedCollectionLabel} · ${groupedCollectionIdentity} · ${groupedResolvedContents.length} 部资源`}
                    </span>
                  ) : null}
                  {!isAdultContent ? (
                    <button
                      type='button'
                      onClick={handleToggleMoreDownloads}
                      className='inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20'
                    >
                      {isLoadingMoreDownloads
                        ? '加载中...'
                        : isMoreDownloadsOpen
                        ? '收起更多'
                        : '下载更多'}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className='flex shrink-0 flex-wrap items-center justify-end gap-2'>
                {hasDialogMenuActions ? (
                  <div ref={dialogMenuRef} className='relative'>
                    <button
                      type='button'
                      aria-label='更多设置'
                      aria-expanded={isDialogMenuOpen}
                      onClick={() =>
                        setIsDialogMenuOpen((currentState) => !currentState)
                      }
                      className={`${dialogHeaderIconButtonClassName} ${
                        (isAdultContent && isMoreDownloadsOpen) ||
                        (canToggleLocalTitleGrouping && isTitleGroupingEnabled)
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                          : ''
                      }`}
                    >
                      <Settings2 className='h-4 w-4' />
                    </button>

                    {isDialogMenuOpen ? (
                      <div className='absolute right-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#09111d] shadow-2xl shadow-black/40'>
                        {canToggleLocalTitleGrouping ? (
                          <button
                            type='button'
                            onClick={() => {
                              setIsDialogMenuOpen(false);
                              setIsTitleGroupingEnabled(
                                (currentState) => !currentState
                              );
                            }}
                            className='flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors hover:bg-white/5'
                          >
                            <span className='text-sm font-medium text-white'>
                              {isTitleGroupingEnabled
                                ? '关闭同名聚合'
                                : '开启同名聚合'}
                            </span>
                            <span className='text-xs leading-5 text-gray-400'>
                              聚合当前离线列表中的同名不同源资源，便于统一查看和切换。
                            </span>
                          </button>
                        ) : null}

                        {isAdultContent ? (
                          <button
                            type='button'
                            onClick={() => {
                              setIsDialogMenuOpen(false);
                              handleToggleMoreDownloads();
                            }}
                            className={`flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors hover:bg-white/5 ${
                              canToggleLocalTitleGrouping
                                ? 'border-t border-white/10'
                                : ''
                            }`}
                          >
                            <span className='text-sm font-medium text-white'>
                              {isMoreDownloadsOpen
                                ? '收起人名归集'
                                : '按人名归集'}
                            </span>
                            <span className='text-xs leading-5 text-gray-400'>
                              {adultGroupingQuery
                                ? `按“${adultGroupingQuery}”归集更多可下载资源`
                                : '根据当前条目识别的人名查找更多资源'}
                            </span>
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {isEditing ? (
                  <>
                    {selectedEpisodeTargets.length > 0 && (
                      <>
                        <button
                          type='button'
                          onClick={() => void handleRestartSelectedEpisodes()}
                          disabled={isRestartingSelected || isDeletingSelected}
                          className='rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50'
                        >
                          {isRestartingSelected ? '重下中...' : '重新下载'}
                        </button>
                        <button
                          type='button'
                          onClick={() => void handleDeleteSelectedEpisodes()}
                          disabled={isDeletingSelected || isRestartingSelected}
                          className='rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50'
                        >
                          {isDeletingSelected ? '删除中...' : '删除'}
                        </button>
                      </>
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
                      className={dialogHeaderActionButtonClassName}
                    >
                      完成
                    </button>
                  </>
                ) : (
                  <button
                    type='button'
                    onClick={handleToggleEditing}
                    className={dialogHeaderActionButtonClassName}
                  >
                    编辑
                  </button>
                )}

                <button
                  type='button'
                  onClick={handleRequestClose}
                  className={dialogHeaderActionButtonClassName}
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
                  {dialogPoster ? (
                    <Image
                      src={processImageUrl(dialogPoster)}
                      alt={dialogPosterAlt}
                      fill
                      className='object-cover'
                      referrerPolicy='no-referrer'
                      sizes='260px'
                    />
                  ) : (
                    <div className='absolute inset-0 flex items-center justify-center bg-gradient-to-br from-emerald-700/70 via-gray-900 to-black text-5xl font-semibold text-white/80'>
                      {dialogPosterTitle.slice(0, 1)}
                    </div>
                  )}
                  <div className='absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent' />
                  <div className='absolute inset-x-0 bottom-0 p-4'>
                    <div className='line-clamp-2 text-xl font-semibold text-white'>
                      {dialogPosterTitle}
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
                  {isGroupedCollection ? (
                    <>
                      <span className='rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-amber-200'>
                        {isAdultGroupedCollection
                          ? `已归集 ${groupedResolvedContents.length} 部资源`
                          : `${groupedCollectionLabel}下 ${groupedResolvedContents.length} 部资源`}
                      </span>
                      <span className='rounded-full border border-white/10 bg-white/5 px-3 py-1 text-gray-300'>
                        合计 {groupedCollectionEpisodeCount} 集 ·{' '}
                        {formatBytes(groupedCollectionTotalSizeBytes)}
                      </span>
                    </>
                  ) : null}
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
                      setIsDescriptionExpanded((currentState) => !currentState)
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
                        {isDescriptionExpanded
                          ? '点击收起简介'
                          : '点击查看完整简介'}
                      </div>
                    ) : null}
                  </button>
                ) : null}
              </div>
            </div>

            <div className='min-h-0 overflow-y-auto p-4 lg:p-6'>
              <div className='space-y-4'>
                {selectionError ? (
                  <div className='rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200'>
                    {selectionError}
                  </div>
                ) : null}

                {selectionFeedback ? (
                  <div className='rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200'>
                    {selectionFeedback}
                  </div>
                ) : null}

                {shouldShowGroupedEpisodeList ? (
                  <div className='space-y-4'>
                    <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                      {isAdultGroupedCollection ? (
                        shouldShowAdultGroupedSourceSummary ? (
                          <div className='text-xs text-gray-400'>
                            来源：{groupedPlayableSourceNames.join('、')}
                          </div>
                        ) : null
                      ) : (
                        <div className='flex flex-wrap gap-2'>
                          {groupedResolvedContents.map((groupedContent) => {
                            const isCurrentContent =
                              groupedContent.contentId === content.contentId;

                            return (
                              <button
                                type='button'
                                key={groupedContent.contentId}
                                disabled={isEditing || isCurrentContent}
                                onClick={() => {
                                  if (!isEditing && !isCurrentContent) {
                                    onSelectContent(groupedContent.contentId);
                                  }
                                }}
                                title={
                                  isCurrentContent
                                    ? `${groupedContent.sourceName} 当前详情`
                                    : `切换到 ${groupedContent.sourceName} 详情`
                                }
                                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                                  isCurrentContent
                                    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                                    : 'border-white/10 bg-white/5 text-gray-300 hover:border-emerald-400/20 hover:bg-white/10'
                                }`}
                              >
                                <span>{groupedContent.sourceName}</span>
                                {groupedContent.episodes.length > 1 ? (
                                  <span className='opacity-70'>
                                    {groupedContent.episodes.length} 集
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <div className='text-xs text-gray-400'>
                        {groupedPlayableEpisodes.length} 条离线资源 · 覆盖{' '}
                        {groupedPlayableEpisodeCount} 集
                      </div>
                    </div>

                    <div className='grid gap-3 md:grid-cols-2'>
                      {groupedPlayableEpisodes.map((episode) => {
                        const selectionKey = buildEpisodeSelectionKey(
                          episode.contentId,
                          episode.episodeIndex
                        );
                        const isSelected =
                          selectedEpisodeKeySet.has(selectionKey);
                        const isPendingOfflineNavigation =
                          !isEditing &&
                          pendingOfflineNavigationKey === selectionKey;
                        const adultEpisodeActionSubject =
                          episode.contentTitle || episode.episodeTitle;
                        const adultEpisodeMarker = [
                          shouldShowAdultGroupedEpisodeCode
                            ? formatEpisodeCode(episode.episodeIndex)
                            : null,
                          shouldShowAdultGroupedEpisodeTitle
                            ? normalizeMetadataText(episode.episodeTitle)
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ');
                        const adultDurationText =
                          groupedEpisodeDurationByKey[selectionKey] ||
                          extractDurationText(episode.remarks, episode.desc);
                        const adultEpisodeRemark = adultDurationText
                          ? null
                          : getDisplayableOfflineRemark(
                              episode.remarks,
                              episode.episodeTitle
                            );
                        const adultPrimaryMeta = [
                          adultDurationText || adultEpisodeRemark,
                          episode.sourceName,
                          episode.year && episode.year !== 'unknown'
                            ? episode.year
                            : null,
                        ].filter((item): item is string => Boolean(item));
                        const adultSecondaryMeta = [adultEpisodeMarker || null]
                          .filter((item): item is string => Boolean(item))
                          .slice(0, 3);
                        const groupedEpisodeActionSubject =
                          isAdultGroupedCollection
                            ? shouldShowAdultGroupedSourceSummary
                              ? `${adultEpisodeActionSubject} · ${episode.sourceName}`
                              : adultEpisodeActionSubject
                            : `${episode.sourceName} 的 ${episode.episodeTitle}`;

                        return (
                          <button
                            type='button'
                            key={`${episode.contentId}-${episode.episodeIndex}`}
                            onClick={() => {
                              if (isEditing) {
                                handleToggleEpisodeSelection(
                                  episode.contentId,
                                  episode.episodeIndex
                                );
                                return;
                              }

                              if (pendingOfflineNavigationKey) {
                                return;
                              }

                              handleOpenOfflinePlayback({
                                href: episode.offlineHref,
                                selectionKey,
                                label: groupedEpisodeActionSubject,
                              });
                            }}
                            onContextMenu={(event) =>
                              handleOpenAdultCoverMenu(event, {
                                poster: episode.poster,
                                title: adultEpisodeActionSubject,
                              })
                            }
                            aria-pressed={isEditing ? isSelected : undefined}
                            aria-busy={isPendingOfflineNavigation || undefined}
                            aria-label={
                              isEditing
                                ? `${
                                    isSelected ? '取消选择' : '选择'
                                  } ${groupedEpisodeActionSubject}`
                                : `离线播放 ${groupedEpisodeActionSubject}`
                            }
                            className={`rounded-xl border p-3 text-left transition-colors ${
                              isEditing
                                ? isSelected
                                  ? 'border-emerald-400/60 bg-emerald-500/10'
                                  : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/5'
                                : isPendingOfflineNavigation
                                ? 'border-emerald-300/60 bg-emerald-500/15 shadow-[0_0_0_1px_rgba(110,231,183,0.2)]'
                                : episode.isCurrentContent
                                ? 'border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/15'
                                : 'border-white/10 bg-black/20 hover:border-emerald-400/30 hover:bg-white/5'
                            }`}
                          >
                            {isAdultGroupedCollection ? (
                              <div className='grid grid-cols-[92px_minmax(0,1fr)_auto] items-start gap-3'>
                                <div className='relative h-28 overflow-hidden rounded-2xl bg-black/30'>
                                  {episode.poster ? (
                                    <Image
                                      src={processImageUrl(episode.poster)}
                                      alt={`${adultEpisodeActionSubject} 封面`}
                                      fill
                                      className='object-cover'
                                      referrerPolicy='no-referrer'
                                      sizes='92px'
                                    />
                                  ) : (
                                    <div className='absolute inset-0 flex items-center justify-center bg-gradient-to-br from-emerald-700/70 via-gray-900 to-black text-3xl font-semibold text-white/70'>
                                      {adultEpisodeActionSubject.slice(0, 1)}
                                    </div>
                                  )}
                                  <div className='absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent' />
                                </div>

                                <div className='min-w-0 space-y-1'>
                                  <div
                                    className='line-clamp-2 text-sm font-semibold text-white'
                                    title={adultEpisodeActionSubject}
                                  >
                                    {adultEpisodeActionSubject}
                                  </div>

                                  {adultPrimaryMeta.length > 0 ? (
                                    <div className='flex flex-wrap items-center gap-2'>
                                      {adultPrimaryMeta.map((item, index) => (
                                        <span
                                          key={`${episode.contentId}-${item}`}
                                          title={item}
                                          className={`rounded-full px-2.5 py-1 text-[11px] ${
                                            index === 0 && adultDurationText
                                              ? 'border border-emerald-400/30 bg-emerald-500/10 font-medium text-emerald-100'
                                              : 'border border-white/10 bg-white/5 text-gray-200'
                                          }`}
                                        >
                                          {item}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}

                                  {adultSecondaryMeta.length > 0 ? (
                                    <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400'>
                                      {adultSecondaryMeta.map((item) => (
                                        <span
                                          key={`${episode.contentId}-${item}`}
                                          title={item}
                                        >
                                          {item}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}
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
                                ) : isPendingOfflineNavigation ? (
                                  <span className='inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-100'>
                                    <Loader2 className='h-3 w-3 animate-spin' />
                                    正在打开
                                  </span>
                                ) : null}

                                <div className='col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400'>
                                  <span>{formatBytes(episode.sizeBytes)}</span>
                                  <span>
                                    {formatDateTime(episode.downloadedAt)}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className='grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2'>
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

                                <div className='col-span-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-300'>
                                  <span className='rounded-full border border-white/10 bg-white/10 px-2.5 py-1 font-medium text-gray-100'>
                                    {episode.sourceName}
                                  </span>
                                  {episode.contentTitle !== dialogTitle ? (
                                    <span className='text-gray-400'>
                                      {episode.contentTitle}
                                    </span>
                                  ) : null}
                                </div>

                                <div className='col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400'>
                                  <span>{formatBytes(episode.sizeBytes)}</span>
                                  <span>
                                    {formatDateTime(episode.downloadedAt)}
                                  </span>
                                </div>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {isMoreDownloadsOpen ? (
                  <div className='rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4'>
                    <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
                      <div className='space-y-1'>
                        <div className='text-sm font-semibold text-white'>
                          {isAdultContent ? '同人名归集资源' : '未下载资源集'}
                        </div>
                        <div className='text-xs text-gray-400'>
                          {isAdultContent
                            ? adultGroupingQuery
                              ? `已按“${adultGroupingQuery}”归集相关成人资源，点击资源卡片即可把可下载内容加入队列。`
                              : '当前条目没有可用的人名归集词，建议从演员名搜索进入后再使用这个功能。'
                            : '点击剧集卡片可继续加入离线下载；已在队列中的剧集会显示当前状态。'}
                        </div>
                      </div>
                      {(
                        isAdultContent ? adultGroupingQuery : downloadableDetail
                      ) ? (
                        <span className='inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-200'>
                          {isAdultContent
                            ? `${adultRelatedDownloadOptions.length} 部相关资源`
                            : `${moreDownloadEpisodeOptions.length} 集待处理`}
                        </span>
                      ) : null}
                    </div>

                    {isLoadingMoreDownloads ? (
                      <div className='mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-6 text-sm text-gray-300'>
                        {isAdultContent
                          ? '正在按人名归集更多资源...'
                          : '正在加载可下载剧集...'}
                      </div>
                    ) : null}

                    {!isLoadingMoreDownloads && moreDownloadsError ? (
                      <div className='mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200'>
                        {moreDownloadsError}
                      </div>
                    ) : null}

                    {!isLoadingMoreDownloads &&
                    !moreDownloadsError &&
                    isAdultContent &&
                    !adultGroupingQuery ? (
                      <div className='mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-6 text-sm text-gray-300'>
                        当前条目未识别出可归集的人名。若你是通过演员名搜索进入播放页，重新下载后这里会优先使用那个搜索词来归集资源。
                      </div>
                    ) : null}

                    {!isLoadingMoreDownloads &&
                    !moreDownloadsError &&
                    isAdultContent &&
                    adultGroupingQuery &&
                    adultRelatedDownloadOptions.length === 0 ? (
                      <div className='mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-6 text-sm text-gray-300'>
                        没有找到更多与“{adultGroupingQuery}”相关的成人资源。
                      </div>
                    ) : null}

                    {!isLoadingMoreDownloads &&
                    !moreDownloadsError &&
                    !isAdultContent &&
                    downloadableDetail &&
                    moreDownloadEpisodeOptions.length === 0 ? (
                      <div className='mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-6 text-sm text-gray-300'>
                        当前内容的可下载剧集已全部缓存。
                      </div>
                    ) : null}

                    {!isLoadingMoreDownloads &&
                    !moreDownloadsError &&
                    isAdultContent &&
                    adultRelatedDownloadOptions.length > 0 ? (
                      <div className='mt-4 max-h-[320px] overflow-y-auto pr-1'>
                        <div className='space-y-3'>
                          {adultRelatedDownloadOptions.map((option) => (
                            <button
                              type='button'
                              key={`${option.contentId}-adult-group`}
                              disabled={!option.isActionable}
                              onClick={() =>
                                void handleStartAdultRelatedDownload(option)
                              }
                              className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                                option.isActionable
                                  ? 'border-emerald-500/20 bg-black/20 hover:border-emerald-400/40 hover:bg-white/5'
                                  : 'border-white/10 bg-black/20 text-gray-400'
                              }`}
                            >
                              <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
                                <div className='min-w-0 flex-1 space-y-3'>
                                  <div className='flex flex-wrap items-center gap-2 text-[11px] text-gray-300'>
                                    <span className='rounded-full border border-white/10 bg-white/10 px-2.5 py-1 font-medium text-gray-100'>
                                      {option.detail.source_name}
                                    </span>
                                    {option.detail.year &&
                                    option.detail.year !== 'unknown' ? (
                                      <span className='rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-gray-300'>
                                        {option.detail.year}
                                      </span>
                                    ) : null}
                                    <span className='rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-gray-300'>
                                      {option.totalEpisodes > 1
                                        ? `${option.totalEpisodes} 集`
                                        : '单集资源'}
                                    </span>
                                  </div>

                                  <div
                                    className='line-clamp-3 text-sm font-semibold leading-6 text-white'
                                    title={option.detail.title}
                                  >
                                    {option.detail.title}
                                  </div>
                                  <div className='text-xs text-gray-400'>
                                    {getAdultRelatedDownloadStatus(option)}
                                  </div>
                                </div>

                                <div className='flex shrink-0 items-center'>
                                  <span
                                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${getAdultRelatedDownloadActionBadgeClassName(
                                      option
                                    )}`}
                                  >
                                    {getAdultRelatedDownloadActionLabel(option)}
                                  </span>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {!isLoadingMoreDownloads &&
                    !moreDownloadsError &&
                    !isAdultContent &&
                    moreDownloadEpisodeOptions.length > 0 ? (
                      <div className='mt-4 max-h-[320px] overflow-y-auto pr-1'>
                        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
                          {moreDownloadEpisodeOptions.map((episode) => (
                            <button
                              type='button'
                              key={`${content.contentId}-more-${episode.episodeIndex}`}
                              disabled={!episode.isActionable}
                              onClick={() =>
                                void handleStartMoreDownload(
                                  episode.episodeIndex
                                )
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

                {shouldShowEpisodeGrid ? (
                  <div className='grid gap-3 md:grid-cols-2 lg:grid-cols-3'>
                    {content.episodes.map((episode) => {
                      const offlineHref = buildOfflinePlayHref({
                        content,
                        episodeIndex: episode.episodeIndex,
                      });
                      const selectionKey = buildEpisodeSelectionKey(
                        content.contentId,
                        episode.episodeIndex
                      );
                      const isSelected =
                        selectedEpisodeKeySet.has(selectionKey);
                      const isPendingOfflineNavigation =
                        !isEditing &&
                        pendingOfflineNavigationKey === selectionKey;

                      return (
                        <button
                          type='button'
                          key={`${content.contentId}-${episode.episodeIndex}`}
                          onClick={() => {
                            if (isEditing) {
                              handleToggleEpisodeSelection(
                                content.contentId,
                                episode.episodeIndex
                              );
                              return;
                            }

                            if (pendingOfflineNavigationKey) {
                              return;
                            }

                            handleOpenOfflinePlayback({
                              href: offlineHref,
                              selectionKey,
                              label: episode.episodeTitle,
                            });
                          }}
                          aria-pressed={isEditing ? isSelected : undefined}
                          aria-busy={isPendingOfflineNavigation || undefined}
                          aria-label={
                            isEditing
                              ? `${isSelected ? '取消选择' : '选择'} ${
                                  episode.episodeTitle
                                }`
                              : `离线播放 ${episode.episodeTitle}`
                          }
                          className={`rounded-xl border p-3 text-left transition-colors ${
                            isEditing
                              ? isSelected
                                ? 'border-emerald-400/60 bg-emerald-500/10'
                                : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/5'
                              : isPendingOfflineNavigation
                              ? 'border-emerald-300/60 bg-emerald-500/15 shadow-[0_0_0_1px_rgba(110,231,183,0.2)]'
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
                            ) : isPendingOfflineNavigation ? (
                              <span className='inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-100'>
                                <Loader2 className='h-3 w-3 animate-spin' />
                                正在打开
                              </span>
                            ) : null}

                            <div className='col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-300'>
                              <span>{formatBytes(episode.sizeBytes)}</span>
                              <span>
                                下载于 {formatDateTime(episode.downloadedAt)}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {adultCoverMenu ? (
        <div
          ref={adultCoverMenuRef}
          role='menu'
          aria-label='归集封面操作'
          className='fixed z-[10002] w-44 overflow-hidden rounded-2xl border border-white/10 bg-[#09111d] shadow-2xl shadow-black/50'
          style={{
            left: adultCoverMenu.x,
            top: adultCoverMenu.y,
          }}
        >
          <button
            type='button'
            role='menuitem'
            onClick={handleSetAdultGroupPoster}
            disabled={!adultCoverMenu.poster}
            className='flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-white transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:text-gray-500 disabled:hover:bg-transparent'
          >
            <span>设为封面</span>
          </button>
        </div>
      ) : null}
    </>,
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
            <div className='min-w-0 flex-1 space-y-2'>
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
              className='inline-flex h-10 min-w-[72px] shrink-0 items-center justify-center rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10'
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
                实际磁盘位置由浏览器站点沙箱托管，Web
                版暂不支持直接显示系统路径、打开系统文件夹或自定义磁盘目录。
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
  const { adultContentFilterEnabled } = useSite();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [pendingBulkAction, setPendingBulkAction] = useState<
    'resume' | 'pause' | 'cancel' | null
  >(null);
  const [groupSameTitleAcrossSources, setGroupSameTitleAcrossSources] =
    useState<boolean>(() => {
      if (typeof window === 'undefined') {
        return false;
      }

      try {
        return JSON.parse(
          localStorage.getItem('downloads-group-same-title') || 'false'
        );
      } catch {
        return false;
      }
    });
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
  const library = useDownloadStore((state) => state.library);
  const maxConcurrentTasks = useDownloadStore(
    (state) => state.maxConcurrentTasks
  );
  const setMaxConcurrentTasks = useDownloadStore(
    (state) => state.setMaxConcurrentTasks
  );
  const activeTaskGroups = useMemo(() => buildActiveTaskGroups(tasks), [tasks]);
  const activeTaskCardGroups = useMemo(
    () =>
      buildActiveTaskCardGroups(activeTaskGroups, {
        groupSameTitleAcrossSources,
      }),
    [activeTaskGroups, groupSameTitleAcrossSources]
  );
  const downloadedContents = useMemo(
    () =>
      [...Object.values(library)].sort(
        (left, right) => right.updatedAt - left.updatedAt
      ),
    [library]
  );
  const visibleDownloadedContents = useMemo(
    () =>
      adultContentFilterEnabled
        ? downloadedContents.filter(
            (content) => !isAdultDownloadedContent(content)
          )
        : downloadedContents,
    [adultContentFilterEnabled, downloadedContents]
  );
  const hiddenAdultDownloadedContentCount =
    downloadedContents.length - visibleDownloadedContents.length;
  const downloadedContentCardGroups = useMemo(
    () =>
      buildDownloadedContentCardGroups(visibleDownloadedContents, {
        groupSameTitleAcrossSources,
      }),
    [groupSameTitleAcrossSources, visibleDownloadedContents]
  );
  const pauseableTaskCount = useMemo(
    () =>
      Object.values(tasks).filter((task) =>
        ['queued', 'downloading'].includes(task.status)
      ).length,
    [tasks]
  );
  const resumableTaskCount = useMemo(
    () =>
      Object.values(tasks).filter((task) =>
        ['paused', 'error'].includes(task.status)
      ).length,
    [tasks]
  );
  const stoppableTaskCount = useMemo(
    () => Object.values(tasks).filter((task) => task.status !== 'done').length,
    [tasks]
  );
  const selectedActiveTaskGroup = useMemo(
    () =>
      selectedActiveTaskContentId
        ? activeTaskCardGroups.find((group) =>
            group.memberContentIds.includes(selectedActiveTaskContentId)
          ) || null
        : null,
    [activeTaskCardGroups, selectedActiveTaskContentId]
  );
  const selectedDownloadedContentGroup = useMemo(
    () =>
      selectedContentId
        ? downloadedContentCardGroups.find((group) =>
            group.contents.some(
              (content) => content.contentId === selectedContentId
            )
          ) || null
        : null,
    [downloadedContentCardGroups, selectedContentId]
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
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.setItem(
      'downloads-group-same-title',
      JSON.stringify(groupSameTitleAcrossSources)
    );
  }, [groupSameTitleAcrossSources]);

  useEffect(() => {
    if (selectedContentId && !selectedContent) {
      setSelectedContentId(null);
    }
  }, [selectedContentId, selectedContent]);

  useEffect(() => {
    if (selectedContentId && !selectedDownloadedContentGroup) {
      setSelectedContentId(null);
    }
  }, [selectedContentId, selectedDownloadedContentGroup]);

  useEffect(() => {
    if (selectedActiveTaskContentId && !selectedActiveTaskGroup) {
      setSelectedActiveTaskContentId(null);
    }
  }, [selectedActiveTaskContentId, selectedActiveTaskGroup]);

  useEffect(() => {
    if (!isSettingsOpen && !selectedContentId && !selectedActiveTaskContentId) {
      return;
    }

    const releaseScrollLock = acquireScrollLock();
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

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      releaseScrollLock();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSettingsOpen, selectedContentId, selectedActiveTaskContentId]);

  const handleDeleteEpisode = async (
    contentId: string,
    episodeIndex: number
  ) => {
    try {
      setActionError(null);
      setActionFeedback(null);
      await downloadManager.deleteEpisode(contentId, episodeIndex);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : '删除离线文件失败'
      );
      throw error;
    }
  };

  const handleConcurrentTaskChange = (
    event: ChangeEvent<HTMLSelectElement>
  ) => {
    const nextValue = Number(event.target.value);
    setMaxConcurrentTasks(nextValue);
    downloadManager.refreshScheduling();
  };

  const handleApplyBulkAction = async (
    action: 'resume' | 'pause' | 'cancel'
  ) => {
    try {
      setActionError(null);
      setActionFeedback(null);
      setPendingBulkAction(action);

      if (action === 'resume') {
        await downloadManager.resumeAllTasks();
        setActionFeedback('已开始恢复全部可继续的下载任务。');
        return;
      }

      if (action === 'pause') {
        await downloadManager.pauseAllTasks();
        setActionFeedback('已暂停全部进行中的下载任务。');
        return;
      }

      await downloadManager.cancelAllTasks();
      setActionFeedback('已停止全部下载任务。');
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : '批量处理下载任务失败'
      );
    } finally {
      setPendingBulkAction(null);
    }
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
        <div className='flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between'>
          <div className='space-y-2'>
            <h1 className='text-2xl font-semibold text-gray-900 dark:text-gray-100'>
              下载管理
            </h1>
            <p className='text-sm text-gray-600 dark:text-gray-400'>
              管理当前下载任务，并在断网时播放已缓存的剧集。
            </p>
          </div>

          <div className='flex flex-wrap items-center justify-end gap-2'>
            <button
              type='button'
              onClick={() =>
                setGroupSameTitleAcrossSources((currentState) => !currentState)
              }
              className={`inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                groupSameTitleAcrossSources
                  ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                  : 'border-gray-200 bg-white/85 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-200 dark:hover:bg-gray-900'
              }`}
            >
              全局同名聚合
              {groupSameTitleAcrossSources ? '：开' : '：关'}
            </button>
            <button
              type='button'
              onClick={() => void handleApplyBulkAction('resume')}
              disabled={resumableTaskCount === 0 || pendingBulkAction !== null}
              className='inline-flex items-center rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-200'
            >
              {pendingBulkAction === 'resume' ? '处理中...' : '全部开始'}
            </button>
            <button
              type='button'
              onClick={() => void handleApplyBulkAction('pause')}
              disabled={pauseableTaskCount === 0 || pendingBulkAction !== null}
              className='inline-flex items-center rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-200'
            >
              {pendingBulkAction === 'pause' ? '处理中...' : '全部暂停'}
            </button>
            <button
              type='button'
              onClick={() => void handleApplyBulkAction('cancel')}
              disabled={stoppableTaskCount === 0 || pendingBulkAction !== null}
              className='inline-flex items-center rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-200'
            >
              {pendingBulkAction === 'cancel' ? '处理中...' : '全部停止'}
            </button>
            <button
              type='button'
              onClick={handleOpenSettings}
              className='inline-flex shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white/85 px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-200 dark:hover:bg-gray-900'
            >
              <Settings2 className='h-4 w-4' />
              下载设置
            </button>
          </div>
        </div>
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

      {actionFeedback && (
        <div className='rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300'>
          {actionFeedback}
        </div>
      )}

      {adultContentFilterEnabled && hiddenAdultDownloadedContentCount > 0 ? (
        <div className='rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-200'>
          成人内容过滤已开启，已暂时隐藏 {hiddenAdultDownloadedContentCount}{' '}
          部离线成人资源。
        </div>
      ) : null}

      <ActiveTasksSection
        activeTaskGroups={activeTaskCardGroups}
        totalContentCount={activeTaskGroups.length}
        activeContentId={selectedActiveTaskContentId}
        onOpenContent={handleOpenActiveTaskContent}
      />

      <DownloadedContentsSection
        contentGroups={downloadedContentCardGroups}
        totalContentCount={visibleDownloadedContents.length}
        activeContentId={selectedContentId}
        onOpenContent={handleOpenDownloadedContent}
      />

      {selectedActiveTaskGroup ? (
        <ActiveTaskDialog
          group={selectedActiveTaskGroup}
          onClose={handleCloseActiveTaskContent}
        />
      ) : null}

      {selectedContent && selectedDownloadedContentGroup ? (
        <DownloadedContentDialog
          content={selectedContent}
          contentGroup={selectedDownloadedContentGroup}
          onSelectContent={handleOpenDownloadedContent}
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
