import { SearchResult } from '@/lib/types';
import { isAdultContentResult } from '@/lib/yellow';

import { buildAdultDownloadGroupingKey } from './adult';
import {
  hasCachedDownload,
  matchDownloadResponse,
  putDownloadResponse,
} from './cache';
import { collectMediaPlaylistResources } from './manifest';
import { getResourceIndex } from './resource-index';
import { DownloadedContentMeta, DownloadedEpisodeMeta } from './types';

export interface OfflinePlaybackEpisodeEntry {
  contentId: string;
  source: string;
  sourceName: string;
  vodId: string;
  title: string;
  searchTitle?: string;
  poster: string;
  year: string;
  desc?: string;
  typeName?: string;
  doubanId?: number;
  episodeIndex: number;
  episodeTitle: string;
  playbackManifestUrl: string;
  downloadedAt: number;
}

export interface OfflinePlaybackDetail {
  detail: SearchResult;
  episodeOrder: number[];
  episodeEntries: OfflinePlaybackEpisodeEntry[];
}

export interface OfflineRelatedVideoEntry {
  contentId: string;
  source: string;
  sourceName: string;
  vodId: string;
  title: string;
  poster: string;
  year: string;
  episodeCount: number;
  href: string;
  updatedAt: number;
}

export function sortDownloadedEpisodes(
  episodes: DownloadedEpisodeMeta[]
): DownloadedEpisodeMeta[] {
  return [...episodes].sort((a, b) => a.episodeIndex - b.episodeIndex);
}

function normalizeOfflineGroupingTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\-_.·•・:：,，!！?？'"“”‘’`~()（）[\]【】{}<>《》/\\|]/g, '');
}

function getOfflineTitleGroupingKey(title?: string | null): string | null {
  const normalizedTitle = title?.trim() || '';
  if (!normalizedTitle) {
    return null;
  }

  const key = normalizeOfflineGroupingTitle(normalizedTitle);
  return key || null;
}

export function getGroupedOfflineContents(params: {
  library: Record<string, DownloadedContentMeta>;
  activeContentId: string;
}): DownloadedContentMeta[] {
  const { library, activeContentId } = params;
  const activeContent = library[activeContentId];

  if (!activeContent) {
    return [];
  }

  const activeTitleKey = getOfflineTitleGroupingKey(activeContent.title);
  const groupedContents = Object.values(library).filter((content) => {
    if (content.contentId === activeContent.contentId) {
      return true;
    }

    if (!activeTitleKey) {
      return false;
    }

    return getOfflineTitleGroupingKey(content.title) === activeTitleKey;
  });

  return [...groupedContents].sort((left, right) => {
    if (left.contentId === activeContentId) {
      return -1;
    }

    if (right.contentId === activeContentId) {
      return 1;
    }

    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }

    return left.sourceName.localeCompare(right.sourceName, 'zh-CN');
  });
}

export function isAdultDownloadedContent(
  content: DownloadedContentMeta | null | undefined
): boolean {
  if (!content) {
    return false;
  }

  return isAdultContentResult({
    title: content.title,
    source_name: content.sourceName,
    desc: content.desc,
    type_name: content.typeName,
  });
}

export function getOfflinePlaybackContents(params: {
  library: Record<string, DownloadedContentMeta>;
  activeContentId: string;
}): DownloadedContentMeta[] {
  const { library, activeContentId } = params;
  const activeContent = library[activeContentId];

  if (!activeContent) {
    return [];
  }

  if (isAdultDownloadedContent(activeContent)) {
    return [activeContent];
  }

  const groupedContents = getGroupedOfflineContents({
    library,
    activeContentId,
  });

  return groupedContents.length > 0 ? groupedContents : [activeContent];
}

function getAdultGroupingKeyForOfflineContent(
  content: DownloadedContentMeta
): string | null {
  return buildAdultDownloadGroupingKey({
    title: content.title,
    searchTitle: content.searchTitle,
    sourceName: content.sourceName,
    desc: content.desc,
    typeName: content.typeName,
  });
}

function getOfflinePrimaryEpisodeIndex(content: DownloadedContentMeta): number {
  const firstEpisode = sortDownloadedEpisodes(content.episodes)[0];
  return firstEpisode?.episodeIndex ?? 0;
}

function buildOfflineRelatedVideoEntry(
  content: DownloadedContentMeta
): OfflineRelatedVideoEntry {
  return {
    contentId: content.contentId,
    source: content.source,
    sourceName: content.sourceName,
    vodId: content.vodId,
    title: content.title,
    poster: content.poster,
    year: content.year,
    episodeCount: content.episodes.length,
    href: buildOfflinePlayHref({
      content,
      episodeIndex: getOfflinePrimaryEpisodeIndex(content),
    }),
    updatedAt: content.updatedAt,
  };
}

export function getSameTitleOfflineVideoEntries(params: {
  library: Record<string, DownloadedContentMeta>;
  activeContentId: string;
}): OfflineRelatedVideoEntry[] {
  const { library, activeContentId } = params;

  return getGroupedOfflineContents({
    library,
    activeContentId,
  })
    .filter((content) => content.contentId !== activeContentId)
    .filter((content) => content.episodes.length > 0)
    .map(buildOfflineRelatedVideoEntry);
}

export function getAdultRelatedOfflineVideoEntries(params: {
  library: Record<string, DownloadedContentMeta>;
  activeContentId: string;
}): OfflineRelatedVideoEntry[] {
  const { library, activeContentId } = params;
  const activeContent = library[activeContentId];

  if (!activeContent) {
    return [];
  }

  const activeGroupingKey = getAdultGroupingKeyForOfflineContent(activeContent);
  if (!activeGroupingKey) {
    return [];
  }

  const activeTitleKey = getOfflineTitleGroupingKey(activeContent.title);
  const seenTitleKeys = new Set<string>();

  return Object.values(library)
    .filter((content) => content.contentId !== activeContent.contentId)
    .filter((content) => content.episodes.length > 0)
    .filter(
      (content) =>
        getAdultGroupingKeyForOfflineContent(content) === activeGroupingKey
    )
    .filter((content) => {
      const contentTitleKey = getOfflineTitleGroupingKey(content.title);
      return !activeTitleKey || contentTitleKey !== activeTitleKey;
    })
    .sort((left, right) => {
      if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }

      if (right.episodes.length !== left.episodes.length) {
        return right.episodes.length - left.episodes.length;
      }

      if (left.title !== right.title) {
        return left.title.localeCompare(right.title, 'zh-CN');
      }

      return left.sourceName.localeCompare(right.sourceName, 'zh-CN');
    })
    .filter((content) => {
      const titleKey = getOfflineTitleGroupingKey(content.title) || content.contentId;
      if (seenTitleKeys.has(titleKey)) {
        return false;
      }

      seenTitleKeys.add(titleKey);
      return true;
    })
    .map(buildOfflineRelatedVideoEntry);
}

function buildOfflinePlaybackDetailWithOwner(params: {
  contents: DownloadedContentMeta[];
  episodeEntries: OfflinePlaybackEpisodeEntry[];
  ownerContentId: string;
}): SearchResult {
  const { contents, episodeEntries, ownerContentId } = params;
  const ownerContent =
    contents.find((content) => content.contentId === ownerContentId) ||
    contents[0];

  const duplicateEpisodeCounts = new Map<number, number>();
  episodeEntries.forEach((entry) => {
    duplicateEpisodeCounts.set(
      entry.episodeIndex,
      (duplicateEpisodeCounts.get(entry.episodeIndex) || 0) + 1
    );
  });

  return {
    id: ownerContent.vodId,
    title: ownerContent.title,
    poster: ownerContent.poster,
    episodes: episodeEntries.map((episode) => episode.playbackManifestUrl),
    episodes_titles: episodeEntries.map((episode) => {
      const duplicateCount = duplicateEpisodeCounts.get(episode.episodeIndex) || 0;
      if (duplicateCount <= 1) {
        return episode.episodeTitle;
      }

      const sourceLabel = episode.sourceName || episode.source;
      return `${episode.episodeTitle} · ${sourceLabel}`;
    }),
    source: ownerContent.source,
    source_name: ownerContent.sourceName,
    year: ownerContent.year,
    desc: ownerContent.desc,
    type_name: ownerContent.typeName,
    douban_id: ownerContent.doubanId,
  };
}

export function buildGroupedOfflinePlaybackDetail(params: {
  contents: DownloadedContentMeta[];
  activeContentId: string;
}): OfflinePlaybackDetail {
  const { contents, activeContentId } = params;
  const episodeEntries = [...contents]
    .flatMap((content) =>
      sortDownloadedEpisodes(content.episodes).map((episode) => ({
        contentId: content.contentId,
        source: content.source,
        sourceName: content.sourceName,
        vodId: content.vodId,
        title: content.title,
        searchTitle: content.searchTitle,
        poster: content.poster,
        year: content.year,
        desc: content.desc,
        typeName: content.typeName,
        doubanId: content.doubanId,
        episodeIndex: episode.episodeIndex,
        episodeTitle:
          episode.episodeTitle ||
          content.episodeTitles[episode.episodeIndex] ||
          `第 ${episode.episodeIndex + 1} 集`,
        playbackManifestUrl: episode.playbackManifestUrl,
        downloadedAt: episode.downloadedAt,
      }))
    )
    .sort((left, right) => {
      if (left.episodeIndex !== right.episodeIndex) {
        return left.episodeIndex - right.episodeIndex;
      }

      if (left.contentId === activeContentId && right.contentId !== activeContentId) {
        return -1;
      }

      if (right.contentId === activeContentId && left.contentId !== activeContentId) {
        return 1;
      }

      if (right.downloadedAt !== left.downloadedAt) {
        return right.downloadedAt - left.downloadedAt;
      }

      return left.sourceName.localeCompare(right.sourceName, 'zh-CN');
    });

  return {
    detail: buildOfflinePlaybackDetailWithOwner({
      contents,
      episodeEntries,
      ownerContentId: activeContentId,
    }),
    episodeOrder: episodeEntries.map((episode) => episode.episodeIndex),
    episodeEntries,
  };
}

export function buildOfflinePlaybackDetail(
  content: DownloadedContentMeta
): OfflinePlaybackDetail {
  return buildGroupedOfflinePlaybackDetail({
    contents: [content],
    activeContentId: content.contentId,
  });
}

export function applyOfflinePlaybackOwner(params: {
  detail: SearchResult;
  contents: DownloadedContentMeta[];
  ownerContentId: string;
}): SearchResult {
  const { detail, contents, ownerContentId } = params;
  const ownerContent =
    contents.find((content) => content.contentId === ownerContentId) ||
    contents[0];

  if (!ownerContent) {
    return detail;
  }

  return {
    ...detail,
    id: ownerContent.vodId,
    title: ownerContent.title,
    poster: ownerContent.poster,
    source: ownerContent.source,
    source_name: ownerContent.sourceName,
    year: ownerContent.year,
    desc: ownerContent.desc,
    type_name: ownerContent.typeName,
    douban_id: ownerContent.doubanId,
  };
}

export function getDownloadedEpisodeMeta(
  content: DownloadedContentMeta | null | undefined,
  originalEpisodeIndex: number
): DownloadedEpisodeMeta | undefined {
  return content?.episodes.find(
    (episode) => episode.episodeIndex === originalEpisodeIndex
  );
}

export function buildOfflinePlayHref(params: {
  content: DownloadedContentMeta;
  episodeIndex: number;
}): string {
  const { content, episodeIndex } = params;
  const searchParams = new URLSearchParams({
    offline: '1',
    contentId: content.contentId,
    source: content.source,
    id: content.vodId,
    title: content.title,
    year: content.year,
    episode: String(episodeIndex + 1),
  });

  return `/play?${searchParams.toString()}`;
}

async function fetchAndCacheOfflineResource(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
    });

    if (!response.ok) {
      return false;
    }

    await putDownloadResponse(url, response.clone());
    return true;
  } catch (_) {
    return false;
  }
}

async function readCachedManifestText(url: string): Promise<string | null> {
  let cachedResponse = await matchDownloadResponse(url);

  if (!cachedResponse) {
    const repaired = await fetchAndCacheOfflineResource(url);
    if (!repaired) {
      return null;
    }

    cachedResponse = await matchDownloadResponse(url);
  }

  if (!cachedResponse) {
    return null;
  }

  try {
    return await cachedResponse.text();
  } catch (_) {
    return null;
  }
}

function resolveOfflineBootstrapResourceUrls(params: {
  manifestText: string;
  episode: DownloadedEpisodeMeta;
  resourceUrls: string[];
}): string[] {
  const { manifestText, episode, resourceUrls } = params;
  const bootstrapUrls: string[] = [];
  const playbackResources = collectMediaPlaylistResources(manifestText).filter(
    (resource) => resource.type !== 'manifest'
  );

  for (const resource of playbackResources) {
    bootstrapUrls.push(resource.url);
    if (resource.type === 'segment') {
      break;
    }
  }

  if (bootstrapUrls.length > 0) {
    return Array.from(new Set(bootstrapUrls));
  }

  return resourceUrls
    .filter((url) => {
      return (
        url !== episode.rootManifestUrl && url !== episode.playbackManifestUrl
      );
    })
    .slice(0, 3);
}

async function ensureOfflineBootstrapResources(
  episode: DownloadedEpisodeMeta
): Promise<boolean> {
  const resourceIndex = await getResourceIndex(episode.cacheIndexId);
  if (!resourceIndex || resourceIndex.urls.length === 0) {
    return false;
  }

  const manifestText = await readCachedManifestText(episode.playbackManifestUrl);
  if (!manifestText) {
    return false;
  }

  const bootstrapUrls = resolveOfflineBootstrapResourceUrls({
    manifestText,
    episode,
    resourceUrls: resourceIndex.urls,
  });

  if (bootstrapUrls.length === 0) {
    return true;
  }

  for (const url of bootstrapUrls) {
    const hasCachedResource = await hasCachedDownload(url);
    if (hasCachedResource) {
      continue;
    }

    const repaired = await fetchAndCacheOfflineResource(url);
    if (!repaired) {
      return false;
    }
  }

  return true;
}

export async function validateDownloadedEpisode(
  episode: DownloadedEpisodeMeta
): Promise<boolean> {
  const resourceIndex = await getResourceIndex(episode.cacheIndexId);
  if (!resourceIndex || resourceIndex.urls.length === 0) {
    return false;
  }

  const bootstrapReady = await ensureOfflineBootstrapResources(episode);
  if (!bootstrapReady) {
    return false;
  }

  const hasManifest = await hasCachedDownload(episode.playbackManifestUrl);

  return Boolean(hasManifest);
}
