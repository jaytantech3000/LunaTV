const VOD_PROXY_BASE_PATH = '/api/proxy/vod';
const VOD_PROXY_M3U8_PATH = `${VOD_PROXY_BASE_PATH}/m3u8`;

export type VodProxyAssetKind = 'm3u8' | 'segment' | 'key';

function buildVodProxyUrl(
  kind: VodProxyAssetKind,
  source: string,
  url: string
): string {
  const searchParams = new URLSearchParams({
    source,
    url,
  });
  return `${VOD_PROXY_BASE_PATH}/${kind}?${searchParams.toString()}`;
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
    return (
      url.includes(VOD_PROXY_M3U8_PATH) || /\.m3u8($|[?#])/i.test(url)
    );
  }
}

export function getVodProxyAssetKind(url: string): VodProxyAssetKind {
  return looksLikeManifestUrl(url) ? 'm3u8' : 'segment';
}

export function getVodProxyBasePath(): string {
  return VOD_PROXY_BASE_PATH;
}
