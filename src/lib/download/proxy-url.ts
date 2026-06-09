import {
  buildVodProxyKeyMediaUrl,
  buildVodProxyM3u8MediaUrl,
  buildVodProxySegmentMediaUrl,
  getVodProxyBasePath as getTransportVodProxyBasePath,
  VOD_PROXY_PATHS,
} from '@/lib/transport/media-proxy';
import { getRuntimeConfig } from '@/lib/runtime-config';

const VOD_PROXY_BASE_PATH = getTransportVodProxyBasePath();
const VOD_PROXY_M3U8_PATH = VOD_PROXY_PATHS.m3u8;

export type VodProxyAssetKind = 'm3u8' | 'segment' | 'key';

function isDesktopDownloadSameOriginProxyEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY === 'true';
}

function buildVodProxyUrl(
  kind: VodProxyAssetKind,
  source: string,
  url: string
): string {
  switch (kind) {
    case 'm3u8':
      return buildVodProxyM3u8MediaUrl({
        source,
        url,
      });
    case 'segment':
      return buildVodProxySegmentMediaUrl({
        source,
        url,
      });
    case 'key':
      return buildVodProxyKeyMediaUrl({
        source,
        url,
      });
    default:
      return buildVodProxyM3u8MediaUrl({
        source,
        url,
      });
  }
}

function buildSameOriginVodProxyUrl(
  kind: VodProxyAssetKind,
  source: string,
  url: string
): string {
  const searchParams = new URLSearchParams({
    source,
    url,
  });
  const path =
    kind === 'segment'
      ? VOD_PROXY_PATHS.segment
      : kind === 'key'
      ? VOD_PROXY_PATHS.key
      : VOD_PROXY_PATHS.m3u8;

  return `${path}?${searchParams.toString()}`;
}

function readVodProxyRequestParams(
  url: string
): {
  source: string;
  upstreamUrl: string;
  assetKind: VodProxyAssetKind;
} | null {
  try {
    const parsedUrl = new URL(url, 'https://moontv.local');
    const source = parsedUrl.searchParams.get('source')?.trim() || '';
    const upstreamUrl = parsedUrl.searchParams.get('url')?.trim() || '';

    if (!source || !upstreamUrl) {
      return null;
    }

    let assetKind: VodProxyAssetKind = 'segment';
    if (parsedUrl.pathname === VOD_PROXY_PATHS.m3u8) {
      assetKind = 'm3u8';
    } else if (parsedUrl.pathname === VOD_PROXY_PATHS.key) {
      assetKind = 'key';
    }

    return {
      source,
      upstreamUrl,
      assetKind,
    };
  } catch {
    return null;
  }
}

export function shouldUseSameOriginDesktopDownloadProxy(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    isDesktopDownloadSameOriginProxyEnabled() &&
    process.env.NODE_ENV === 'development' &&
    getRuntimeConfig().APP_TARGET === 'desktop'
  );
}

export function buildVodProxyM3u8Url(params: {
  source: string;
  url: string;
}): string {
  return buildVodProxyUrl('m3u8', params.source, params.url);
}

export function buildVodProxySegmentUrl(params: {
  source: string;
  url: string;
}): string {
  return buildVodProxyUrl('segment', params.source, params.url);
}

export function buildVodProxyKeyUrl(params: {
  source: string;
  url: string;
}): string {
  return buildVodProxyUrl('key', params.source, params.url);
}

export function buildDownloadVodProxyM3u8Url(params: {
  source: string;
  url: string;
}): string {
  if (shouldUseSameOriginDesktopDownloadProxy()) {
    return buildSameOriginVodProxyUrl('m3u8', params.source, params.url);
  }

  return buildVodProxyM3u8Url(params);
}

export function normalizeVodProxyUrlForDesktopDownload(url: string): string {
  if (!shouldUseSameOriginDesktopDownloadProxy()) {
    return url;
  }

  const proxyRequest = readVodProxyRequestParams(url);
  if (!proxyRequest) {
    return url;
  }

  return buildSameOriginVodProxyUrl(
    proxyRequest.assetKind,
    proxyRequest.source,
    proxyRequest.upstreamUrl
  );
}

export function isAbsoluteHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

export function isVodProxyUrl(url: string): boolean {
  try {
    if (url.startsWith(VOD_PROXY_BASE_PATH)) {
      return true;
    }

    const parsedUrl = new URL(url, 'https://moontv.local');
    return parsedUrl.pathname.startsWith(VOD_PROXY_BASE_PATH);
  } catch (error) {
    return false;
  }
}

export function looksLikeManifestUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url, 'https://moontv.local');
    return (
      parsedUrl.pathname.startsWith(VOD_PROXY_M3U8_PATH) ||
      /\.m3u8($|[?#])/i.test(parsedUrl.pathname + parsedUrl.search)
    );
  } catch (error) {
    return url.includes(VOD_PROXY_M3U8_PATH) || /\.m3u8($|[?#])/i.test(url);
  }
}

export function getVodProxyAssetKind(url: string): VodProxyAssetKind {
  return looksLikeManifestUrl(url) ? 'm3u8' : 'segment';
}

export function getVodProxyBasePath(): string {
  return VOD_PROXY_BASE_PATH;
}
