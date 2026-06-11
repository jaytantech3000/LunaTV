import { ApiSearchParams, buildApiUrl, getApiBaseUrl } from './endpoint';

import { getRuntimeConfig } from '@/lib/runtime-config';

export const LIVE_PROXY_PATHS = {
  m3u8: '/api/proxy/m3u8',
  segment: '/api/proxy/segment',
  key: '/api/proxy/key',
  logo: '/api/proxy/logo',
} as const;

export const VOD_PROXY_PATHS = {
  m3u8: '/api/proxy/vod/m3u8',
  segment: '/api/proxy/vod/segment',
  key: '/api/proxy/vod/key',
} as const;

function toMediaSearchParams(
  searchParams?: ApiSearchParams | URLSearchParams
): URLSearchParams {
  if (!searchParams) {
    return new URLSearchParams();
  }

  if (searchParams instanceof URLSearchParams) {
    return new URLSearchParams(searchParams);
  }

  const nextSearchParams = new URLSearchParams();
  Object.entries(searchParams).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    nextSearchParams.set(key, String(value));
  });

  return nextSearchParams;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export function getMediaProxyBaseUrl(): string {
  const runtimeBaseUrl = getRuntimeConfig().MEDIA_PROXY_BASE_URL?.trim();
  const envBaseUrl = process.env.NEXT_PUBLIC_MEDIA_PROXY_BASE_URL?.trim();

  return normalizeBaseUrl(runtimeBaseUrl || envBaseUrl || getApiBaseUrl());
}

export function buildMediaProxyUrl(
  path: string,
  searchParams?: ApiSearchParams | URLSearchParams,
  options: {
    baseUrl?: string;
  } = {}
): string {
  const baseUrl = options.baseUrl ?? getMediaProxyBaseUrl();

  if (!baseUrl) {
    return buildApiUrl(path.replace(/^\/api/, ''), searchParams);
  }

  const query = toMediaSearchParams(searchParams);
  const queryString = query.toString();

  return `${normalizeBaseUrl(baseUrl)}${path}${
    queryString ? `?${queryString}` : ''
  }`;
}

export function buildLiveProxyM3u8Url(params: {
  url: string;
  sourceKey: string;
  allowCORS?: boolean;
  baseUrl?: string;
}): string {
  return buildMediaProxyUrl(
    LIVE_PROXY_PATHS.m3u8,
    {
      url: params.url,
      'moontv-source': params.sourceKey,
      allowCORS: params.allowCORS,
    },
    {
      baseUrl: params.baseUrl,
    }
  );
}

export function buildLiveProxySegmentUrl(params: {
  url: string;
  sourceKey?: string;
  baseUrl?: string;
}): string {
  return buildMediaProxyUrl(
    LIVE_PROXY_PATHS.segment,
    {
      url: params.url,
      'moontv-source': params.sourceKey,
    },
    {
      baseUrl: params.baseUrl,
    }
  );
}

export function buildLiveProxyKeyUrl(params: {
  url: string;
  sourceKey?: string;
  baseUrl?: string;
}): string {
  return buildMediaProxyUrl(
    LIVE_PROXY_PATHS.key,
    {
      url: params.url,
      'moontv-source': params.sourceKey,
    },
    {
      baseUrl: params.baseUrl,
    }
  );
}

export function buildLiveLogoProxyUrl(params: {
  url: string;
  sourceKey?: string | null;
  baseUrl?: string;
}): string {
  const normalizedUrl = params.url?.trim();
  const normalizedSourceKey = params.sourceKey?.trim() || undefined;

  if (!normalizedUrl) {
    return '';
  }

  if (!normalizedSourceKey) {
    return normalizedUrl;
  }

  return buildMediaProxyUrl(
    LIVE_PROXY_PATHS.logo,
    {
      url: normalizedUrl,
      'moontv-source': normalizedSourceKey,
    },
    {
      baseUrl: params.baseUrl,
    }
  );
}

export function buildVodProxyM3u8MediaUrl(params: {
  source: string;
  url: string;
  baseUrl?: string;
}): string {
  return buildMediaProxyUrl(
    VOD_PROXY_PATHS.m3u8,
    {
      source: params.source,
      url: params.url,
    },
    {
      baseUrl: params.baseUrl,
    }
  );
}

export function buildVodProxySegmentMediaUrl(params: {
  source: string;
  url: string;
  baseUrl?: string;
}): string {
  return buildMediaProxyUrl(
    VOD_PROXY_PATHS.segment,
    {
      source: params.source,
      url: params.url,
    },
    {
      baseUrl: params.baseUrl,
    }
  );
}

export function buildVodProxyKeyMediaUrl(params: {
  source: string;
  url: string;
  baseUrl?: string;
}): string {
  return buildMediaProxyUrl(
    VOD_PROXY_PATHS.key,
    {
      source: params.source,
      url: params.url,
    },
    {
      baseUrl: params.baseUrl,
    }
  );
}

export function getVodProxyBasePath(): string {
  return VOD_PROXY_PATHS.m3u8.replace(/\/m3u8$/, '');
}
