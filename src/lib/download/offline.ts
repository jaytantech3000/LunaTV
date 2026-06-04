import { SearchResult } from '@/lib/types';

import {
  hasCachedDownload,
  matchDownloadResponse,
  putDownloadResponse,
} from './cache';
import { collectMediaPlaylistResources } from './manifest';
import { getResourceIndex } from './resource-index';
import { DownloadedContentMeta, DownloadedEpisodeMeta } from './types';

export interface OfflinePlaybackDetail {
  detail: SearchResult;
  episodeOrder: number[];
}

export function sortDownloadedEpisodes(
  episodes: DownloadedEpisodeMeta[]
): DownloadedEpisodeMeta[] {
  return [...episodes].sort((a, b) => a.episodeIndex - b.episodeIndex);
}

export function buildOfflinePlaybackDetail(
  content: DownloadedContentMeta
): OfflinePlaybackDetail {
  const sortedEpisodes = sortDownloadedEpisodes(content.episodes);
  const episodeOrder = sortedEpisodes.map((episode) => episode.episodeIndex);

  return {
    detail: {
      id: content.vodId,
      title: content.title,
      poster: content.poster,
      episodes: sortedEpisodes.map((episode) => episode.playbackManifestUrl),
      episodes_titles: sortedEpisodes.map(
        (episode) =>
          episode.episodeTitle ||
          content.episodeTitles[episode.episodeIndex] ||
          `第 ${episode.episodeIndex + 1} 集`
      ),
      source: content.source,
      source_name: content.sourceName,
      year: content.year,
      desc: content.desc,
      type_name: content.typeName,
      douban_id: content.doubanId,
    },
    episodeOrder,
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
