import { apiFetch } from './api-client';
import { buildLiveLogoProxyUrl, buildLiveProxyM3u8Url } from './media-proxy';

export interface LiveSource {
  key: string;
  name: string;
  url: string;
  ua?: string;
  epg?: string;
  from: 'config' | 'custom';
  channelNumber?: number;
  disabled?: boolean;
}

export interface LiveChannel {
  id: string;
  tvgId: string;
  name: string;
  logo: string;
  group: string;
  url: string;
}

export interface LiveEpgData {
  tvgId: string;
  source: string;
  epgUrl: string;
  programs: Array<{
    start: string;
    end: string;
    title: string;
  }>;
}

export type LiveStreamType = 'm3u8' | 'mp4' | 'flv';

async function parseJsonResponse<T>(
  response: Response,
  fallbackMessage: string
): Promise<T> {
  if (!response.ok) {
    throw new Error(fallbackMessage);
  }

  return (await response.json()) as T;
}

export function buildLiveLogoUrl(
  logoUrl: string,
  sourceKey?: string | null
): string {
  return buildLiveLogoProxyUrl({
    url: logoUrl,
    sourceKey,
  });
}

export function buildLiveStreamProxyUrl(
  videoUrl: string,
  sourceKey: string
): string {
  return buildLiveProxyM3u8Url({
    url: videoUrl,
    sourceKey,
  });
}

export async function fetchLiveSources(): Promise<LiveSource[]> {
  const result = await parseJsonResponse<{
    success?: boolean;
    error?: string;
    data?: LiveSource[];
  }>(await apiFetch('/live/sources'), '获取直播源失败');

  if (!result.success) {
    throw new Error(result.error || '获取直播源失败');
  }

  return result.data || [];
}

export async function fetchLiveChannels(
  sourceKey: string
): Promise<LiveChannel[]> {
  const result = await parseJsonResponse<{
    success?: boolean;
    error?: string;
    data?: LiveChannel[];
  }>(
    await apiFetch('/live/channels', {
      searchParams: {
        source: sourceKey,
      },
    }),
    '获取频道列表失败'
  );

  if (!result.success) {
    throw new Error(result.error || '获取频道列表失败');
  }

  return result.data || [];
}

export async function fetchLiveEpg(
  sourceKey: string,
  tvgId: string
): Promise<LiveEpgData> {
  const result = await parseJsonResponse<{
    success?: boolean;
    error?: string;
    data?: LiveEpgData;
  }>(
    await apiFetch('/live/epg', {
      searchParams: {
        source: sourceKey,
        tvgId,
      },
    }),
    '获取节目单信息失败'
  );

  if (!result.success || !result.data) {
    throw new Error(result.error || '获取节目单信息失败');
  }

  return result.data;
}

export async function precheckLiveStream(
  videoUrl: string,
  sourceKey: string
): Promise<LiveStreamType> {
  const result = await parseJsonResponse<{
    success?: boolean;
    error?: string;
    type?: LiveStreamType;
  }>(
    await apiFetch('/live/precheck', {
      searchParams: {
        url: videoUrl,
        'moontv-source': sourceKey,
      },
    }),
    '预检查失败'
  );

  if (!result.success || !result.type) {
    throw new Error(result.error || '预检查失败');
  }

  return result.type;
}
