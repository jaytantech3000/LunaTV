export type DownloadTaskStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'done'
  | 'error';

export type DownloadResourceType = 'manifest' | 'segment' | 'key' | 'map';

export interface DownloadResource {
  url: string;
  type: DownloadResourceType;
}

export interface DownloadTask {
  id: string;
  contentId: string;
  source: string;
  sourceName: string;
  vodId: string;
  episodeIndex: number;
  title: string;
  poster: string;
  year: string;
  desc?: string;
  typeName?: string;
  doubanId?: number;
  episodeTitle: string;
  originalM3u8Url: string;
  entryManifestUrl: string;
  manifestCandidateUrls?: string[];
  playbackManifestUrl?: string;
  cacheIndexId: string;
  status: DownloadTaskStatus;
  progress: number;
  totalResources: number;
  downloadedResources: number;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
  errorMessage?: string;
}

export interface DownloadedEpisodeMeta {
  episodeIndex: number;
  episodeTitle: string;
  rootManifestUrl: string;
  playbackManifestUrl: string;
  cacheIndexId: string;
  resourceCount: number;
  sizeBytes: number;
  downloadedAt: number;
}

export interface DownloadedContentMeta {
  contentId: string;
  source: string;
  vodId: string;
  sourceName: string;
  title: string;
  poster: string;
  year: string;
  desc?: string;
  typeName?: string;
  doubanId?: number;
  episodeTitles: string[];
  ownerUsername: string;
  episodes: DownloadedEpisodeMeta[];
  totalSizeBytes: number;
  updatedAt: number;
}

export interface ResourceIndexRecord {
  id: string;
  ownerUsername: string;
  taskId: string;
  contentId: string;
  source: string;
  vodId: string;
  episodeIndex: number;
  urls: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ManifestParseResult {
  rootManifestUrl: string;
  playbackManifestUrl: string;
  resources: DownloadResource[];
  resourceUrls: string[];
  isMasterPlaylist: boolean;
}

export const MIN_CONCURRENT_DOWNLOAD_TASKS = 1;
export const MAX_CONCURRENT_DOWNLOAD_TASKS = 5;
export const DEFAULT_CONCURRENT_DOWNLOAD_TASKS = MIN_CONCURRENT_DOWNLOAD_TASKS;

export function normalizeConcurrentDownloadTasks(value: unknown): number {
  const numericValue =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.round(value)
      : DEFAULT_CONCURRENT_DOWNLOAD_TASKS;

  return Math.min(
    MAX_CONCURRENT_DOWNLOAD_TASKS,
    Math.max(MIN_CONCURRENT_DOWNLOAD_TASKS, numericValue)
  );
}

export const DOWNLOAD_CACHE_NAME = 'moontv-vod-download-v1';
export const DOWNLOAD_STORE_KEY = 'moontv-download-store-v1';
export const DOWNLOAD_RESOURCE_DB_NAME = 'moontv-download-db-v1';
export const DOWNLOAD_RESOURCE_STORE_NAME = 'resource-indexes';

export function buildDownloadContentId(source: string, vodId: string): string {
  return `${source}:${vodId}`;
}

export function buildDownloadTaskId(
  contentId: string,
  episodeIndex: number
): string {
  return `${contentId}:${episodeIndex}`;
}

export function buildDownloadCacheIndexId(taskId: string): string {
  return `task:${taskId}`;
}
