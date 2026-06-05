import { putDownloadResponse } from './cache';
import { looksLikeManifestUrl } from './proxy-url';
import { DownloadResource, ManifestParseResult } from './types';

const DOWNLOAD_REQUEST_INTENT_HEADER = 'x-moontv-download-intent';
const BACKGROUND_DOWNLOAD_REQUEST_INTENT = 'background';

function splitManifestLines(content: string): string[] {
  return content.split(/\r?\n/).map((line) => line.trim());
}

function parseAttributeList(line: string): Record<string, string> {
  const separatorIndex = line.indexOf(':');
  const attributeLine =
    separatorIndex >= 0 ? line.slice(separatorIndex + 1) : line;
  const attributes: Record<string, string> = {};
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(attributeLine)) !== null) {
    const [, key, rawValue] = match;
    attributes[key] = rawValue.replace(/^"|"$/g, '');
  }

  return attributes;
}

function extractUriAttribute(line: string): string | null {
  const attributes = parseAttributeList(line);
  return attributes.URI || null;
}

function getKeyMethod(line: string): string | null {
  const attributes = parseAttributeList(line);
  return attributes.METHOD || null;
}

function getPreloadHintType(line: string): string | null {
  const attributes = parseAttributeList(line);
  return attributes.TYPE || null;
}

export function isMasterPlaylist(content: string): boolean {
  return splitManifestLines(content).some((line) =>
    line.startsWith('#EXT-X-STREAM-INF:')
  );
}

export function selectPlaybackManifestUrl(content: string): string | null {
  const lines = splitManifestLines(content);
  const variants: Array<{ url: string; bandwidth: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('#EXT-X-STREAM-INF:')) {
      continue;
    }

    const attributes = parseAttributeList(line);
    const nextLine = lines[index + 1]?.trim();
    if (!nextLine || nextLine.startsWith('#')) {
      continue;
    }

    variants.push({
      url: nextLine,
      bandwidth: Number(attributes.BANDWIDTH || 0),
    });
  }

  if (variants.length === 0) {
    return null;
  }

  variants.sort((left, right) => right.bandwidth - left.bandwidth);
  return variants[0].url;
}

export function collectMediaPlaylistResources(
  content: string
): DownloadResource[] {
  const lines = splitManifestLines(content);
  const resources: DownloadResource[] = [];

  lines.forEach((line) => {
    if (!line) {
      return;
    }

    if (
      line.startsWith('#EXT-X-KEY:') ||
      line.startsWith('#EXT-X-SESSION-KEY:')
    ) {
      const method = getKeyMethod(line);
      if (method && !['AES-128', 'NONE'].includes(method.toUpperCase())) {
        throw new Error(`暂不支持 DRM/HLS 加密方式: ${method}`);
      }

      const uri = extractUriAttribute(line);
      if (uri) {
        resources.push({
          url: uri,
          type: 'key',
        });
      }
      return;
    }

    if (line.startsWith('#EXT-X-MAP:')) {
      const uri = extractUriAttribute(line);
      if (uri) {
        resources.push({
          url: uri,
          type: 'map',
        });
      }
      return;
    }

    if (line.startsWith('#EXT-X-PART:')) {
      const uri = extractUriAttribute(line);
      if (uri) {
        resources.push({
          url: uri,
          type: 'segment',
        });
      }
      return;
    }

    if (line.startsWith('#EXT-X-PRELOAD-HINT:')) {
      const uri = extractUriAttribute(line);
      if (uri) {
        resources.push({
          url: uri,
          type:
            getPreloadHintType(line)?.toUpperCase() === 'MAP'
              ? 'map'
              : 'segment',
        });
      }
      return;
    }

    if (line.startsWith('#EXT-X-RENDITION-REPORT:')) {
      const uri = extractUriAttribute(line);
      if (uri) {
        resources.push({
          url: uri,
          type: 'manifest',
        });
      }
      return;
    }

    if (!line.startsWith('#')) {
      resources.push({
        url: line,
        type: looksLikeManifestUrl(line) ? 'manifest' : 'segment',
      });
    }
  });

  return resources;
}

function dedupeResources(resources: DownloadResource[]): DownloadResource[] {
  const seen = new Set<string>();
  const deduped: DownloadResource[] = [];

  resources.forEach((resource) => {
    if (seen.has(resource.url)) {
      return;
    }
    seen.add(resource.url);
    deduped.push(resource);
  });

  return deduped;
}

async function fetchManifestText(
  url: string,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      [DOWNLOAD_REQUEST_INTENT_HEADER]: BACKGROUND_DOWNLOAD_REQUEST_INTENT,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`获取 manifest 失败: ${response.status}`);
  }

  const responseClone = response.clone();
  const manifestText = await responseClone.text();

  if (!manifestText.includes('#EXTM3U')) {
    throw new Error('上游返回的内容不是合法的 HLS manifest');
  }

  await putDownloadResponse(url, response.clone());
  return manifestText;
}

export async function parseManifestForDownload(
  entryManifestUrl: string,
  options: {
    signal?: AbortSignal;
  } = {}
): Promise<ManifestParseResult> {
  const rootManifestText = await fetchManifestText(
    entryManifestUrl,
    options.signal
  );
  const masterPlaylist = isMasterPlaylist(rootManifestText);

  if (!masterPlaylist) {
    const resources = dedupeResources([
      { url: entryManifestUrl, type: 'manifest' },
      ...collectMediaPlaylistResources(rootManifestText),
    ]);

    return {
      rootManifestUrl: entryManifestUrl,
      playbackManifestUrl: entryManifestUrl,
      resources,
      resourceUrls: resources.map((resource) => resource.url),
      isMasterPlaylist: false,
    };
  }

  const selectedPlaybackManifestUrl =
    selectPlaybackManifestUrl(rootManifestText);

  if (!selectedPlaybackManifestUrl) {
    throw new Error('未找到可离线播放的 media playlist');
  }

  const playbackManifestText = await fetchManifestText(
    selectedPlaybackManifestUrl,
    options.signal
  );
  const resources = dedupeResources([
    { url: entryManifestUrl, type: 'manifest' },
    { url: selectedPlaybackManifestUrl, type: 'manifest' },
    ...collectMediaPlaylistResources(playbackManifestText),
  ]);

  return {
    rootManifestUrl: entryManifestUrl,
    playbackManifestUrl: selectedPlaybackManifestUrl,
    resources,
    resourceUrls: resources.map((resource) => resource.url),
    isMasterPlaylist: true,
  };
}

export async function parseManifestForDownloadWithFallback(
  entryManifestUrls: string[],
  options: {
    signal?: AbortSignal;
  } = {}
): Promise<ManifestParseResult> {
  const candidates = Array.from(
    new Set(entryManifestUrls.map((url) => url.trim()).filter(Boolean))
  );

  if (candidates.length === 0) {
    throw new Error('当前剧集缺少可下载的播放地址');
  }

  let lastError: Error | null = null;

  for (const candidateUrl of candidates) {
    if (options.signal?.aborted) {
      throw lastError || new Error('下载已取消');
    }

    try {
      return await parseManifestForDownload(candidateUrl, options);
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }

      lastError =
        error instanceof Error ? error : new Error('获取 manifest 失败');
    }
  }

  throw lastError || new Error('当前内容没有可用的离线下载源');
}
