import { DownloadedContentMeta, DownloadTask } from './types';

function now(): number {
  return Date.now();
}

function pickPreferredTextValue(
  primaryValue: string | undefined,
  fallbackValue: string | undefined
): string {
  const normalizedPrimaryValue = primaryValue?.trim();
  if (normalizedPrimaryValue) {
    return normalizedPrimaryValue;
  }

  return fallbackValue?.trim() || '';
}

export function pickPreferredOptionalTextValue(
  primaryValue: string | undefined,
  fallbackValue: string | undefined
): string | undefined {
  const nextValue = pickPreferredTextValue(primaryValue, fallbackValue);
  return nextValue || undefined;
}

function pickPreferredDoubanId(
  primaryValue: number | undefined,
  fallbackValue: number | undefined
): number | undefined {
  if (
    typeof primaryValue === 'number' &&
    Number.isFinite(primaryValue) &&
    primaryValue > 0
  ) {
    return primaryValue;
  }

  if (
    typeof fallbackValue === 'number' &&
    Number.isFinite(fallbackValue) &&
    fallbackValue > 0
  ) {
    return fallbackValue;
  }

  return undefined;
}

export function applyLibraryMetadataFallback(
  task: DownloadTask,
  previousItem: DownloadedContentMeta | undefined
): DownloadTask {
  if (!previousItem) {
    return task;
  }

  return {
    ...task,
    sourceName: pickPreferredTextValue(
      task.sourceName,
      previousItem.sourceName
    ),
    title: pickPreferredTextValue(task.title, previousItem.title),
    searchTitle: pickPreferredOptionalTextValue(
      task.searchTitle,
      previousItem.searchTitle
    ),
    searchType: pickPreferredOptionalTextValue(
      task.searchType,
      previousItem.searchType
    ),
    poster: pickPreferredTextValue(task.poster, previousItem.poster),
    remarks: pickPreferredOptionalTextValue(task.remarks, previousItem.remarks),
    year: pickPreferredTextValue(task.year, previousItem.year),
    desc: pickPreferredOptionalTextValue(task.desc, previousItem.desc),
    typeName: pickPreferredOptionalTextValue(
      task.typeName,
      previousItem.typeName
    ),
    doubanId: pickPreferredDoubanId(task.doubanId, previousItem.doubanId),
  };
}

export function mergeLibraryItem(
  previousItem: DownloadedContentMeta | undefined,
  task: DownloadTask,
  ownerUsername: string,
  playbackManifestUrl: string,
  rootManifestUrl: string,
  resourceCount: number,
  episodeSizeBytes: number
): DownloadedContentMeta {
  const episodeTitles = previousItem?.episodeTitles?.length
    ? [...previousItem.episodeTitles]
    : [];
  episodeTitles[task.episodeIndex] = task.episodeTitle;

  const nextEpisodes = [
    ...(previousItem?.episodes || []).filter(
      (episode) => episode.episodeIndex !== task.episodeIndex
    ),
    {
      episodeIndex: task.episodeIndex,
      episodeTitle: task.episodeTitle,
      rootManifestUrl,
      playbackManifestUrl,
      cacheIndexId: task.cacheIndexId,
      resourceCount,
      sizeBytes: episodeSizeBytes,
      downloadedAt: now(),
    },
  ].sort((left, right) => left.episodeIndex - right.episodeIndex);

  const totalSizeBytes = nextEpisodes.reduce(
    (sum, episode) => sum + episode.sizeBytes,
    0
  );

  return {
    contentId: task.contentId,
    source: task.source,
    vodId: task.vodId,
    sourceName: pickPreferredTextValue(
      task.sourceName,
      previousItem?.sourceName
    ),
    title: pickPreferredTextValue(task.title, previousItem?.title),
    searchTitle: pickPreferredOptionalTextValue(
      task.searchTitle,
      previousItem?.searchTitle
    ),
    searchType: pickPreferredOptionalTextValue(
      task.searchType,
      previousItem?.searchType
    ),
    poster: pickPreferredTextValue(task.poster, previousItem?.poster),
    adultGroupPoster: previousItem?.adultGroupPoster?.trim() || undefined,
    remarks: pickPreferredOptionalTextValue(
      task.remarks,
      previousItem?.remarks
    ),
    year: pickPreferredTextValue(task.year, previousItem?.year),
    desc: pickPreferredOptionalTextValue(task.desc, previousItem?.desc),
    typeName: pickPreferredOptionalTextValue(
      task.typeName,
      previousItem?.typeName
    ),
    doubanId: pickPreferredDoubanId(task.doubanId, previousItem?.doubanId),
    episodeTitles,
    ownerUsername,
    episodes: nextEpisodes,
    totalSizeBytes,
    updatedAt: now(),
  };
}
