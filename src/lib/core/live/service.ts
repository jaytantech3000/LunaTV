import { AdminConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';
import { getCachedLiveChannels, LiveChannels } from '@/lib/live';

type LiveSource = NonNullable<AdminConfig['LiveConfig']>[number];
type LiveStreamType = 'm3u8' | 'mp4' | 'flv';

const DEFAULT_LIVE_USER_AGENT = 'AptvPlayer/1.4.10';

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

export class LiveServiceError extends Error {
  status: number;
  payload?: Record<string, unknown>;

  constructor(
    message: string,
    status = 500,
    payload?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'LiveServiceError';
    this.status = status;
    this.payload = payload;
  }
}

async function getEnabledLiveSources(): Promise<LiveSource[]> {
  const config = await getConfig();
  return (config.LiveConfig || []).filter((source) => !source.disabled);
}

async function getLiveSourceByKey(sourceKey: string): Promise<LiveSource> {
  const normalizedSourceKey = sourceKey.trim();
  const liveSource = (await getEnabledLiveSources()).find(
    (source) => source.key === normalizedSourceKey
  );

  if (!liveSource) {
    throw new LiveServiceError('Source not found', 404);
  }

  return liveSource;
}

function detectLiveStreamType(contentType: string | null): LiveStreamType {
  if (contentType?.includes('video/mp4')) {
    return 'mp4';
  }

  if (contentType?.includes('video/x-flv')) {
    return 'flv';
  }

  return 'm3u8';
}

export async function getLiveSources(): Promise<LiveSource[]> {
  return getEnabledLiveSources();
}

export async function getLiveChannels(
  sourceKey: string
): Promise<LiveChannels['channels']> {
  const normalizedSourceKey = sourceKey.trim();

  if (!normalizedSourceKey) {
    throw new LiveServiceError('缺少直播源参数', 400);
  }

  const channelData = await getCachedLiveChannels(normalizedSourceKey);

  if (!channelData) {
    throw new LiveServiceError('频道信息未找到', 404);
  }

  return channelData.channels;
}

export async function getLiveEpg(
  sourceKey: string,
  tvgId: string
): Promise<LiveEpgData> {
  const normalizedSourceKey = sourceKey.trim();
  const normalizedTvgId = tvgId.trim();

  if (!normalizedSourceKey) {
    throw new LiveServiceError('缺少直播源参数', 400);
  }

  if (!normalizedTvgId) {
    throw new LiveServiceError('缺少频道tvg-id参数', 400);
  }

  const channelData = await getCachedLiveChannels(normalizedSourceKey);

  if (!channelData) {
    return {
      tvgId: normalizedTvgId,
      source: normalizedSourceKey,
      epgUrl: '',
      programs: [],
    };
  }

  return {
    tvgId: normalizedTvgId,
    source: normalizedSourceKey,
    epgUrl: channelData.epgUrl,
    programs: channelData.epgs[normalizedTvgId] || [],
  };
}

export async function precheckLiveStream(params: {
  url: string;
  sourceKey: string;
}): Promise<{
  type: LiveStreamType;
}> {
  const normalizedUrl = params.url.trim();

  if (!normalizedUrl) {
    throw new LiveServiceError('Missing url', 400);
  }

  const liveSource = await getLiveSourceByKey(params.sourceKey);
  const response = await fetch(decodeURIComponent(normalizedUrl), {
    cache: 'no-cache',
    redirect: 'follow',
    credentials: 'same-origin',
    headers: {
      'User-Agent': liveSource.ua || DEFAULT_LIVE_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new LiveServiceError('Failed to fetch', 500, {
      message: response.statusText,
    });
  }

  const type = detectLiveStreamType(response.headers.get('Content-Type'));
  if (response.body) {
    response.body.cancel();
  }

  return {
    type,
  };
}
