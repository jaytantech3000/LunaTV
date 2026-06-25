import { putDownloadResponse } from './cache';
import {
  isDesktopLocalDownloadRuntimeEnabled,
  resolveDesktopDownloadManifest,
} from './desktop-runtime';
import { looksLikeManifestUrl } from './proxy-url';
import {
  createTimeoutAbortSignal,
  DownloadRequestError,
  isAbortError,
  isRetryableDownloadError,
  waitForRetry,
} from './request';
import { DownloadResource, ManifestParseResult } from './types';

const DOWNLOAD_REQUEST_INTENT_HEADER = 'x-moontv-download-intent';
const BACKGROUND_DOWNLOAD_REQUEST_INTENT = 'background';
const MANIFEST_REQUEST_TIMEOUT_MS = 20_000;
const MAX_MANIFEST_FETCH_RETRIES = 2;

function summarizeManifestErrorBody(body: string): string {
  const normalizedBody = body.replace(/\s+/g, ' ').trim();
  if (!normalizedBody) {
    return '';
  }

  return normalizedBody.length > 160
    ? `${normalizedBody.slice(0, 157)}...`
    : normalizedBody;
}

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
      return;
    }

    if (line.startsWith('#EXT-X-RENDITION-REPORT:')) {
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
  const timeoutSignal = createTimeoutAbortSignal({
    sourceSignal: signal,
    timeoutMs: MANIFEST_REQUEST_TIMEOUT_MS,
  });
  let response: Response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        [DOWNLOAD_REQUEST_INTENT_HEADER]: BACKGROUND_DOWNLOAD_REQUEST_INTENT,
      },
      signal: timeoutSignal.signal,
    });
  } catch (error) {
    if (timeoutSignal.didTimeout()) {
      throw new DownloadRequestError({
        message: `获取 manifest 超时: ${url}`,
        kind: 'timeout',
        url,
        cause: error,
      });
    }

    if (signal?.aborted || isAbortError(error)) {
      throw error;
    }

    throw new DownloadRequestError({
      message: `获取 manifest 失败: ${url} (${
        error instanceof Error ? error.message : '未知网络错误'
      })`,
      kind: 'network',
      url,
      cause: error,
    });
  } finally {
    timeoutSignal.cleanup();
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = summarizeManifestErrorBody(await response.clone().text());
    } catch {
      detail = '';
    }

    throw new DownloadRequestError({
      message: `获取 manifest 失败: ${url} (${response.status}${
        detail ? `, ${detail}` : ''
      })`,
      kind: 'http',
      url,
      status: response.status,
    });
  }

  let manifestText = '';
  try {
    manifestText = await response.clone().text();
  } catch (error) {
    throw new Error(
      `读取 manifest 失败: ${url} (${
        error instanceof Error ? error.message : '未知读取错误'
      })`
    );
  }

  if (!manifestText.includes('#EXTM3U')) {
    throw new Error(`上游返回的内容不是合法的 HLS manifest: ${url}`);
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

  if (isDesktopLocalDownloadRuntimeEnabled()) {
    return resolveDesktopDownloadManifest(candidates, {
      signal: options.signal,
    });
  }

  let lastError: Error | null = null;

  for (const candidateUrl of candidates) {
    for (
      let attempt = 1;
      attempt <= MAX_MANIFEST_FETCH_RETRIES + 1;
      attempt += 1
    ) {
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

        if (
          attempt <= MAX_MANIFEST_FETCH_RETRIES &&
          isRetryableDownloadError(error)
        ) {
          await waitForRetry(attempt);
          continue;
        }

        break;
      }
    }
  }

  throw lastError || new Error('当前内容没有可用的离线下载源');
}
