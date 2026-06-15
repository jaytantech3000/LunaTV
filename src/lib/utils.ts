/* eslint-disable @typescript-eslint/no-explicit-any,no-console */
import he from 'he';
import Hls from 'hls.js';

import { buildApiUrl } from '@/lib/transport/endpoint';

import {
  getVideoQualityFromResolution,
  parseVideoQualityFromManifest,
  parseVideoQualityHints,
  pickBetterVideoQuality,
} from './video-quality';

function getDoubanImageProxyConfig(): {
  proxyType:
    | 'server'
    | 'cmliussss-cdn-tencent'
    | 'cmliussss-cdn-ali'
    | 'custom';
  proxyUrl: string;
} {
  let doubanImageProxyType =
    localStorage.getItem('doubanImageProxyType') ||
    (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE ||
    'cmliussss-cdn-tencent';
  // 兼容历史数据：直连和豆瓣官方精品 CDN 统一使用服务器代理
  if (doubanImageProxyType === 'direct' || doubanImageProxyType === 'img3') {
    doubanImageProxyType = 'server';
  }
  const doubanImageProxy =
    localStorage.getItem('doubanImageProxyUrl') ||
    (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY ||
    '';
  return {
    proxyType: doubanImageProxyType,
    proxyUrl: doubanImageProxy,
  };
}

/**
 * 处理图片 URL，如果设置了图片代理则使用代理
 */
export function processImageUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  // 仅处理豆瓣图片代理
  if (!originalUrl.includes('doubanio.com')) {
    return originalUrl;
  }

  const { proxyType, proxyUrl } = getDoubanImageProxyConfig();
  switch (proxyType) {
    case 'server':
      return buildApiUrl('/image-proxy', { url: originalUrl });
    case 'cmliussss-cdn-tencent':
      return originalUrl.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.net'
      );
    case 'cmliussss-cdn-ali':
      return originalUrl.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.com'
      );
    case 'custom':
      return `${proxyUrl}${encodeURIComponent(originalUrl)}`;
    default:
      return buildApiUrl('/image-proxy', { url: originalUrl });
  }
}

function createDetectionFallback(): {
  quality: string;
  loadSpeed: string;
  pingTime: number;
} {
  return {
    quality: '未知',
    loadSpeed: '未知',
    pingTime: 0,
  };
}

function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '未知';
  }

  const speedInKilobytes = bytesPerSecond / 1024;

  if (speedInKilobytes >= 1024) {
    return `${(speedInKilobytes / 1024).toFixed(1)} MB/s`;
  }

  return `${speedInKilobytes.toFixed(1)} KB/s`;
}

function buildAbortSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => window.clearTimeout(timeoutId),
  };
}

function mergeVideoMetrics(
  ...candidates: Array<{
    quality?: string;
    loadSpeed?: string;
    pingTime?: number;
  } | null>
): {
  quality: string;
  loadSpeed: string;
  pingTime: number;
} {
  return candidates.reduce<{
    quality: string;
    loadSpeed: string;
    pingTime: number;
  }>((mergedMetrics, candidate) => {
    if (!candidate) {
      return mergedMetrics;
    }

    const nextQuality = candidate.quality || '未知';

    return {
      quality: pickBetterVideoQuality(mergedMetrics.quality, nextQuality),
      loadSpeed:
        mergedMetrics.loadSpeed !== '未知'
          ? mergedMetrics.loadSpeed
          : candidate.loadSpeed || '未知',
      pingTime:
        mergedMetrics.pingTime > 0
          ? mergedMetrics.pingTime
          : Math.max(0, Math.round(candidate.pingTime || 0)),
    };
  }, createDetectionFallback());
}

async function probeManifestByFetch(m3u8Url: string): Promise<{
  quality: string;
  loadSpeed: string;
  pingTime: number;
} | null> {
  if (typeof window === 'undefined' || !m3u8Url.trim()) {
    return null;
  }

  const { signal, cleanup } = buildAbortSignal(4500);
  const requestStartedAt = performance.now();

  try {
    const response = await fetch(m3u8Url, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const manifestText = await response.text();
    const elapsedMilliseconds = Math.max(
      performance.now() - requestStartedAt,
      1
    );
    const contentLength = Number(response.headers.get('content-length') || 0);
    const measuredBytes = Math.max(
      contentLength > 0 ? contentLength : 0,
      new TextEncoder().encode(manifestText).length
    );

    return {
      quality: pickBetterVideoQuality(
        parseVideoQualityHints([m3u8Url, response.url]),
        parseVideoQualityFromManifest(manifestText)
      ),
      loadSpeed: formatSpeed(measuredBytes / (elapsedMilliseconds / 1000)),
      pingTime: Math.round(elapsedMilliseconds),
    };
  } catch (error) {
    return null;
  } finally {
    cleanup();
  }
}

async function probeManifestByMediaElement(m3u8Url: string): Promise<{
  quality: string;
  loadSpeed: string;
  pingTime: number;
} | null> {
  if (typeof document === 'undefined' || !m3u8Url.trim()) {
    return null;
  }

  return new Promise((resolve) => {
    const video = document.createElement('video');
    const startedAt = performance.now();
    let quality = '未知';
    let loadSpeed = '未知';
    let pingTime = 0;
    let fragmentStartedAt = 0;
    let settled = false;
    let hls: Hls | null = null;

    const cleanup = () => {
      if (hls) {
        hls.destroy();
        hls = null;
      }

      video.removeAttribute('src');
      video.load();
      video.remove();
    };

    const settle = () => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      cleanup();

      if (quality === '未知' && loadSpeed === '未知' && pingTime <= 0) {
        resolve(null);
        return;
      }

      resolve({
        quality,
        loadSpeed,
        pingTime: Math.max(0, Math.round(pingTime)),
      });
    };

    const updateQuality = (nextQuality: string) => {
      quality = pickBetterVideoQuality(quality, nextQuality);
    };

    const timeoutId = window.setTimeout(() => {
      settle();
    }, 3500);

    video.muted = true;
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      updateQuality(
        getVideoQualityFromResolution(video.videoWidth, video.videoHeight)
      );
      if (pingTime <= 0) {
        pingTime = performance.now() - startedAt;
      }
      settle();
    };

    video.onerror = () => {
      settle();
    };

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: false,
        lowLatencyMode: false,
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (pingTime <= 0) {
          pingTime = performance.now() - startedAt;
        }

        const bestLevel = hls?.levels.reduce((bestCandidate, level) => {
          const bestArea =
            (bestCandidate?.width || 0) * (bestCandidate?.height || 0);
          const currentArea = (level.width || 0) * (level.height || 0);
          return currentArea > bestArea ? level : bestCandidate;
        }, null as { width?: number; height?: number; name?: string } | null);

        updateQuality(
          getVideoQualityFromResolution(bestLevel?.width, bestLevel?.height)
        );
        updateQuality(
          parseVideoQualityHints(
            hls?.levels.map((level) => level.name || '') || []
          )
        );

        if (quality !== '未知') {
          settle();
        }
      });

      hls.on(Hls.Events.FRAG_LOADING, () => {
        fragmentStartedAt = performance.now();
      });

      hls.on(Hls.Events.FRAG_LOADED, (_event: any, data: any) => {
        if (loadSpeed !== '未知') {
          return;
        }

        const loadedBytes =
          (typeof data?.stats?.loaded === 'number' && data.stats.loaded) ||
          data?.payload?.byteLength ||
          0;
        const elapsedMilliseconds =
          typeof data?.stats?.loading?.start === 'number' &&
          typeof data?.stats?.loading?.end === 'number'
            ? data.stats.loading.end - data.stats.loading.start
            : fragmentStartedAt > 0
            ? performance.now() - fragmentStartedAt
            : 0;

        if (loadedBytes > 0 && elapsedMilliseconds > 0) {
          loadSpeed = formatSpeed(loadedBytes / (elapsedMilliseconds / 1000));
        }

        if (pingTime <= 0) {
          pingTime = performance.now() - startedAt;
        }

        if (quality !== '未知' || loadSpeed !== '未知') {
          settle();
        }
      });

      hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
        if (data?.fatal) {
          settle();
        }
      });

      hls.loadSource(m3u8Url);
      hls.attachMedia(video);
      return;
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = m3u8Url;
      video.load();
      return;
    }

    settle();
  });
}

/**
 * 从m3u8地址获取视频质量等级和网络信息
 * @param m3u8Url m3u8播放列表的URL
 * @returns Promise<{quality: string, loadSpeed: string, pingTime: number}> 视频质量等级和网络信息
 */
export async function getVideoResolutionFromM3u8(m3u8Url: string): Promise<{
  quality: string; // 如720p、1080p等
  loadSpeed: string; // 自动转换为KB/s或MB/s
  pingTime: number; // 网络延迟（毫秒）
}> {
  if (!m3u8Url.trim()) {
    return createDetectionFallback();
  }

  const urlHintMetrics = {
    ...createDetectionFallback(),
    quality: parseVideoQualityHints([m3u8Url]),
  };
  const manifestMetrics = await probeManifestByFetch(m3u8Url);
  const needsMediaProbe =
    !manifestMetrics ||
    manifestMetrics.quality === '未知' ||
    manifestMetrics.loadSpeed === '未知';
  const mediaMetrics = needsMediaProbe
    ? await probeManifestByMediaElement(m3u8Url)
    : null;

  return mergeVideoMetrics(urlHintMetrics, manifestMetrics, mediaMetrics);
}

export function cleanHtmlTags(text: string): string {
  if (!text) return '';

  const cleanedText = text
    .replace(/<[^>]+>/g, '\n') // 将 HTML 标签替换为换行
    .replace(/\n+/g, '\n') // 将多个连续换行合并为一个
    .replace(/[ \t]+/g, ' ') // 将多个连续空格和制表符合并为一个空格，但保留换行符
    .replace(/^\n+|\n+$/g, '') // 去掉首尾换行
    .trim(); // 去掉首尾空格

  // 使用 he 库解码 HTML 实体
  return he.decode(cleanedText);
}
