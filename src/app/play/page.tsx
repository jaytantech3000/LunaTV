/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { Heart } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  startTransition,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  bindDesktopPlayerPresentationFullscreenState,
  toggleDesktopPlayerPresentationFullscreenState,
} from '@/lib/desktop/fullscreen';
import { DESKTOP_RUNTIME_UPDATED_EVENT } from '@/lib/desktop/runtime-config';
import {
  matchDownloadResponse,
  putDownloadResponse,
} from '@/lib/download/cache';
import { isDesktopLocalDownloadRuntimeEnabled } from '@/lib/download/desktop-runtime';
import { normalizeVodDetailForPlayback } from '@/lib/download/normalize';
import {
  applyOfflinePlaybackOwner,
  buildGroupedOfflinePlaybackDetail,
  getAdultRelatedOfflineVideoEntries,
  getOfflinePlaybackContents,
  getSameTitleOfflineVideoEntries,
  OfflinePlaybackEpisodeEntry,
  validateDownloadedEpisode,
} from '@/lib/download/offline';
import { looksLikeManifestUrl } from '@/lib/download/proxy-url';
import { hasExplicitExclusiveByteRange } from '@/lib/download/range';
import { sanitizeVodManifestContent } from '@/lib/download/sanitize-manifest';
import { ensureOfflineServiceWorkerReady } from '@/lib/download/service-worker';
import { buildDownloadContentId } from '@/lib/download/types';
import {
  advanceAcknowledgedEpisodeCount,
  getNewEpisodeRange,
  isDesktopFollowUpdatesEnabled,
  mergeLatestEpisodeCountWithoutRegression,
} from '@/lib/follow-updates';
import {
  preferBestPlaybackSource,
  searchPlaybackSources,
} from '@/lib/playback-source-prefetch';
import {
  AudioSpikeProtectionStatus,
  PlayerEnhancementManager,
} from '@/lib/player-enhancement-runtime';
import {
  AUDIO_SPIKE_PROTECTION_LEVEL_OPTIONS,
  AudioSpikeProtectionLevel,
  getAudioSpikeProtectionLevelLabel,
  getVisualEnhancementLevelLabel,
  VISUAL_ENHANCEMENT_LEVEL_OPTIONS,
  VisualEnhancementLevel,
} from '@/lib/player-enhancement-types';
import {
  PLAYER_ENHANCEMENTS_UPDATED_EVENT,
  readPlayerEnhancementPreferences,
  updatePlayerEnhancementPreference,
} from '@/lib/player-enhancements';
import {
  deleteFavorite,
  deletePlayRecord,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getCachedFollowRecordsSnapshot,
  getFollowRecord,
  getSkipConfig,
  isFavorited,
  saveFavorite,
  saveFollowRecord,
  savePlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/profile/client';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { acquireScrollLock } from '@/lib/scroll-lock';
import { apiFetch } from '@/lib/transport/api-client';
import { FollowRecord, SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';
import { isAdultContentResult } from '@/lib/yellow';

import CurrentEpisodeDownloadControl from '@/components/CurrentEpisodeDownloadControl';
import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';
import PlayerEnhancementStatusOverlay from '@/components/PlayerEnhancementStatusOverlay';

import { useDownloadStore } from '@/stores/downloadStore';

// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

// Wake Lock API 类型声明
interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

const EPISODE_PROGRESS_STORAGE_KEY = 'moontv-episode-progress-v1';

function buildEpisodeProgressStorageKey(
  source: string,
  id: string,
  episodeNumber: number
): string {
  return `${generateStorageKey(source, id)}:${episodeNumber}`;
}

function readEpisodeProgressSnapshot(): Record<string, number> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = localStorage.getItem(EPISODE_PROGRESS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as Record<string, number>;
  } catch (error) {
    console.warn('读取分集播放进度失败:', error);
    return {};
  }
}

function writeEpisodeProgressSnapshot(snapshot: Record<string, number>): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(
      EPISODE_PROGRESS_STORAGE_KEY,
      JSON.stringify(snapshot)
    );
  } catch (error) {
    console.warn('写入分集播放进度失败:', error);
  }
}

function readStoredEpisodeProgress(
  source: string,
  id: string,
  episodeNumber: number
): number | null {
  const snapshot = readEpisodeProgressSnapshot();
  const value =
    snapshot[buildEpisodeProgressStorageKey(source, id, episodeNumber)];

  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function persistStoredEpisodeProgress(
  source: string,
  id: string,
  episodeNumber: number,
  progressSeconds: number
): void {
  if (!Number.isFinite(progressSeconds) || progressSeconds <= 0) {
    return;
  }

  const snapshot = readEpisodeProgressSnapshot();
  snapshot[buildEpisodeProgressStorageKey(source, id, episodeNumber)] =
    Math.floor(progressSeconds);
  writeEpisodeProgressSnapshot(snapshot);
}

function readPositiveNumberSearchParam(value: string | null): number {
  const parsedValue = Number(value);

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? Math.trunc(parsedValue)
    : 0;
}

function isTransientPlaybackBootstrapError(
  message: string | null | undefined
): boolean {
  if (!message) {
    return false;
  }

  const normalizedMessage = message.toLowerCase();

  return (
    normalizedMessage.includes('empty src attribute') ||
    (normalizedMessage.includes('media_element_error') &&
      normalizedMessage.includes('empty src'))
  );
}

function buildCachedLoaderStats() {
  const start = performance.now();

  return {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: {
      start,
      first: start,
      end: 0,
    },
    parsing: {
      start: 0,
      end: 0,
    },
    buffering: {
      start: 0,
      first: 0,
      end: 0,
    },
  };
}

async function buildCachedRangeResponse(
  cachedResponse: Response,
  rangeStart?: number,
  rangeEnd?: number
): Promise<Response> {
  if (!hasExplicitExclusiveByteRange(rangeStart, rangeEnd)) {
    return cachedResponse;
  }

  const fullBuffer = await cachedResponse.arrayBuffer();
  const totalLength = fullBuffer.byteLength;
  const start = Math.max(0, rangeStart || 0);
  const endExclusive =
    rangeEnd === undefined || rangeEnd === null
      ? totalLength
      : Math.min(totalLength, rangeEnd);

  if (start >= totalLength || start >= endExclusive) {
    const headers = new Headers(cachedResponse.headers);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Range', `bytes */${totalLength}`);
    headers.set('Content-Length', '0');
    return new Response(null, {
      status: 416,
      headers,
    });
  }

  const slicedBuffer = fullBuffer.slice(start, endExclusive);
  const headers = new Headers(cachedResponse.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set(
    'Content-Range',
    `bytes ${start}-${endExclusive - 1}/${totalLength}`
  );
  headers.set('Content-Length', String(slicedBuffer.byteLength));

  return new Response(slicedBuffer, {
    status: 206,
    headers,
  });
}

async function readOfflineCachedVodResponse(
  url: string,
  options: {
    rangeStart?: number;
    rangeEnd?: number;
  } = {}
): Promise<Response | undefined> {
  let cachedResponse = await matchDownloadResponse(url);

  if (!cachedResponse && typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      const networkResponse = await fetch(url, {
        cache: 'no-store',
        credentials: 'same-origin',
      });

      if (networkResponse.ok) {
        await putDownloadResponse(url, networkResponse.clone());
        cachedResponse = networkResponse;
      }
    } catch (_) {
      // 离线兜底读取失败时交给调用方统一处理
    }
  }

  if (!cachedResponse) {
    return undefined;
  }

  return buildCachedRangeResponse(
    cachedResponse,
    options.rangeStart,
    options.rangeEnd
  );
}

function buildAvailableSourceKey(source: Pick<SearchResult, 'source' | 'id'>) {
  return `${source.source}:${source.id}`;
}

function mergeAvailableSources(
  prioritySources: SearchResult[],
  discoveredSources: SearchResult[]
): SearchResult[] {
  const mergedSources = [...prioritySources];
  const seenSourceKeys = new Set(prioritySources.map(buildAvailableSourceKey));

  discoveredSources.forEach((source) => {
    const sourceKey = buildAvailableSourceKey(source);
    if (seenSourceKeys.has(sourceKey)) {
      return;
    }

    seenSourceKeys.add(sourceKey);
    mergedSources.push(source);
  });

  return mergedSources;
}

function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const allowAdultCandidates = searchParams.get('adult') === '1';
  const isOfflineMode = searchParams.get('offline') === '1';
  const initialEpisodeQueryIndex = (() => {
    const rawEpisode = Number(searchParams.get('episode') || '1');
    if (!Number.isFinite(rawEpisode) || rawEpisode <= 0) {
      return 0;
    }
    return rawEpisode - 1;
  })();
  const offlineContentId =
    searchParams.get('contentId') ||
    (() => {
      const source = searchParams.get('source') || '';
      const id = searchParams.get('id') || '';
      if (!source || !id) {
        return '';
      }

      return buildDownloadContentId(source, id);
    })();
  const downloadStoreHydrated = useDownloadStore((state) => state.hasHydrated);
  const offlineLibrary = useDownloadStore((state) => state.library);
  const [activeOfflineContentId, setActiveOfflineContentId] =
    useState(offlineContentId);
  const offlineContent = activeOfflineContentId
    ? offlineLibrary[activeOfflineContentId]
    : undefined;
  const offlinePlaybackContents = useMemo(
    () =>
      activeOfflineContentId
        ? getOfflinePlaybackContents({
            library: offlineLibrary,
            activeContentId: activeOfflineContentId,
          })
        : [],
    [activeOfflineContentId, offlineLibrary]
  );
  const offlineAdultRelatedVideos = useMemo(
    () =>
      activeOfflineContentId
        ? getAdultRelatedOfflineVideoEntries({
            library: offlineLibrary,
            activeContentId: activeOfflineContentId,
          })
        : [],
    [activeOfflineContentId, offlineLibrary]
  );
  const offlineSameTitleVideos = useMemo(
    () =>
      activeOfflineContentId
        ? getSameTitleOfflineVideoEntries({
            library: offlineLibrary,
            activeContentId: activeOfflineContentId,
          })
        : [],
    [activeOfflineContentId, offlineLibrary]
  );
  const shouldShowOfflineAdultRelatedVideos =
    isOfflineMode && offlineAdultRelatedVideos.length > 0;

  // -----------------------------------------------------------------------------
  // 状态变量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);
  const [isOfflineSameTitleDialogOpen, setIsOfflineSameTitleDialogOpen] =
    useState(false);

  // 收藏状态
  const [favorited, setFavorited] = useState(false);
  const [followRecord, setFollowRecord] = useState<FollowRecord | null>(null);

  // 跳过片头片尾配置
  const [skipConfig, setSkipConfig] = useState<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [
    skipConfig,
    skipConfig.enable,
    skipConfig.intro_time,
    skipConfig.outro_time,
  ]);

  // 跳过检查的时间间隔控制
  const lastSkipCheckRef = useRef(0);

  // 去广告开关（从 localStorage 继承，默认 true）
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  const [audioSpikeProtectionLevel, setAudioSpikeProtectionLevel] =
    useState<AudioSpikeProtectionLevel>(() => {
      if (typeof window === 'undefined') {
        return 'off';
      }

      return readPlayerEnhancementPreferences(getRuntimeConfig())
        .audioSpikeProtectionLevel;
    });
  const [audioDynamicProtectionEnabled, setAudioDynamicProtectionEnabled] =
    useState<boolean>(() => {
      if (typeof window === 'undefined') {
        return false;
      }

      return readPlayerEnhancementPreferences(getRuntimeConfig())
        .audioDynamicProtectionEnabled;
    });
  const [audioFixedCeilingEnabled, setAudioFixedCeilingEnabled] =
    useState<boolean>(() => {
      if (typeof window === 'undefined') {
        return false;
      }

      return readPlayerEnhancementPreferences(getRuntimeConfig())
        .audioFixedCeilingEnabled;
    });
  const [visualEnhancementLevel, setVisualEnhancementLevel] =
    useState<VisualEnhancementLevel>(() => {
      if (typeof window === 'undefined') {
        return 'off';
      }

      return readPlayerEnhancementPreferences(getRuntimeConfig())
        .visualEnhancementLevel;
    });
  const [audioEnhancementStatus, setAudioEnhancementStatus] =
    useState<AudioSpikeProtectionStatus | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const syncPlayerEnhancementPreferences = () => {
      const preferences = readPlayerEnhancementPreferences(getRuntimeConfig());
      setAudioSpikeProtectionLevel(preferences.audioSpikeProtectionLevel);
      setAudioDynamicProtectionEnabled(
        preferences.audioDynamicProtectionEnabled
      );
      setAudioFixedCeilingEnabled(preferences.audioFixedCeilingEnabled);
      setVisualEnhancementLevel(preferences.visualEnhancementLevel);
    };

    window.addEventListener(
      PLAYER_ENHANCEMENTS_UPDATED_EVENT,
      syncPlayerEnhancementPreferences
    );
    window.addEventListener(
      DESKTOP_RUNTIME_UPDATED_EVENT,
      syncPlayerEnhancementPreferences
    );

    return () => {
      window.removeEventListener(
        PLAYER_ENHANCEMENTS_UPDATED_EVENT,
        syncPlayerEnhancementPreferences
      );
      window.removeEventListener(
        DESKTOP_RUNTIME_UPDATED_EVENT,
        syncPlayerEnhancementPreferences
      );
    };
  }, []);

  // 视频基本信息
  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  const [videoDoubanId, setVideoDoubanId] = useState(() =>
    readPositiveNumberSearchParam(searchParams.get('doubanId'))
  );
  // 当前源和ID
  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || ''
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  // 搜索所需信息
  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');

  // 是否需要优选
  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true'
  );
  const needPreferRef = useRef(needPrefer);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);
  // 集数相关
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(
    initialEpisodeQueryIndex
  );
  const [offlineEpisodeEntries, setOfflineEpisodeEntries] = useState<
    OfflinePlaybackEpisodeEntry[]
  >([]);

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const videoDoubanIdRef = useRef(videoDoubanId);
  const detailRef = useRef<SearchResult | null>(detail);
  const followRecordRef = useRef<FollowRecord | null>(followRecord);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);
  const offlineEpisodeEntriesRef = useRef<OfflinePlaybackEpisodeEntry[]>([]);
  const episodeProgressMapRef = useRef<Record<number, number>>({});
  const playbackHistoryRestoreKeyRef = useRef('');
  const skipNextPlaybackHistoryRestoreRef = useRef(false);

  // 同步最新值到 refs
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    followRecordRef.current = followRecord;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
    videoDoubanIdRef.current = videoDoubanId;
  }, [
    currentSource,
    currentId,
    detail,
    followRecord,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
    videoDoubanId,
  ]);
  useEffect(() => {
    offlineEpisodeEntriesRef.current = offlineEpisodeEntries;
  }, [offlineEpisodeEntries]);

  // 视频播放地址
  const [videoUrl, setVideoUrl] = useState('');

  // 总集数
  const totalEpisodes = detail?.episodes?.length || 0;

  // 用于记录是否需要在播放器 ready 后跳转到指定进度
  const resumeTimeRef = useRef<number | null>(null);
  // 上次使用的音量，默认 0.7
  const lastVolumeRef = useRef<number>(0.7);
  // 上次使用的播放速率，默认 1.0
  const lastPlaybackRateRef = useRef<number>(1.0);

  // 换源相关状态
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );

  // 优选和测速开关
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  // 保存优选时的测速结果，避免EpisodeSelector重复测速
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, { quality: string; loadSpeed: string; pingTime: number }>
  >(new Map());

  // 折叠状态（仅在 lg 及以上屏幕有效）
  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  // 换源加载状态
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');
  const [playerRecoveryNotice, setPlayerRecoveryNotice] = useState<
    string | null
  >(null);

  const currentPlaybackMode = isOfflineMode ? 'offline' : 'online';

  // 播放进度保存相关
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  const artPlayerRef = useRef<any>(null);
  const playerSessionRef = useRef<{
    isOfflineMode: boolean;
    playbackType: string;
  } | null>(null);
  const artRef = useRef<HTMLDivElement | null>(null);
  const initStartedRef = useRef(false);
  const enhancementManagerRef = useRef<PlayerEnhancementManager | null>(null);
  const removeDesktopFullscreenListenerRef = useRef<(() => void) | null>(null);

  // Wake Lock 相关
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const blockingError =
    error && !isTransientPlaybackBootstrapError(error) ? error : null;
  const playerLoadingDetailMessage =
    playerRecoveryNotice ||
    (videoLoadingStage === 'sourceChanging'
      ? '已收到切换请求，正在连接新的播放源。'
      : isOfflineMode
      ? '正在读取离线缓存并恢复播放。'
      : '正在连接播放源并准备画面。');

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  // 播放源优选函数
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    const { bestSource, videoInfoMap } = await preferBestPlaybackSource(
      sources
    );
    setPrecomputedVideoInfo(videoInfoMap);
    return bestSource;
  };

  // 更新视频地址
  const updateVideoUrl = (
    detailData: SearchResult | null,
    episodeIndex: number
  ) => {
    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      setVideoUrl('');
      return;
    }
    const newUrl = detailData?.episodes[episodeIndex] || '';
    if (newUrl !== videoUrl) {
      setVideoUrl(newUrl);
    }
  };

  const getPlaybackType = (url: string): string => {
    return looksLikeManifestUrl(url) ? 'm3u8' : '';
  };

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 移除旧的 source，保持唯一
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 始终允许远程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾经有禁用属性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  const syncPlayerEnhancements = () => {
    const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
    const host = artRef.current;

    if (!video || !host) {
      enhancementManagerRef.current?.dispose();
      enhancementManagerRef.current = null;
      setAudioEnhancementStatus(null);
      return;
    }

    const handleAudioStatusChange = (status: AudioSpikeProtectionStatus) => {
      startTransition(() => {
        setAudioEnhancementStatus(status);
      });
    };

    if (!enhancementManagerRef.current) {
      enhancementManagerRef.current = new PlayerEnhancementManager({
        onAudioStatusChange: handleAudioStatusChange,
      });
    } else {
      enhancementManagerRef.current.setAudioStatusListener(
        handleAudioStatusChange
      );
    }

    enhancementManagerRef.current.bind(video, host);
    enhancementManagerRef.current.setPreferences({
      audioSpikeProtectionLevel,
      audioDynamicProtectionEnabled,
      audioFixedCeilingEnabled,
      visualEnhancementLevel,
    });
  };

  const handleAudioSpikeProtectionLevelChange = (
    value: AudioSpikeProtectionLevel
  ) => {
    setAudioSpikeProtectionLevel(value);
    updatePlayerEnhancementPreference('audioSpikeProtectionLevel', value);
    return value === 'off'
      ? '当前关闭'
      : `当前${getAudioSpikeProtectionLevelLabel(value)}`;
  };

  const handleAudioDynamicProtectionToggle = (value: boolean) => {
    setAudioDynamicProtectionEnabled(value);
    updatePlayerEnhancementPreference('audioDynamicProtectionEnabled', value);
    return value ? '当前开启' : '当前关闭';
  };

  const handleAudioFixedCeilingToggle = (value: boolean) => {
    setAudioFixedCeilingEnabled(value);
    updatePlayerEnhancementPreference('audioFixedCeilingEnabled', value);
    return value ? '当前开启' : '当前关闭';
  };

  const handleVisualEnhancementLevelChange = (
    value: VisualEnhancementLevel
  ) => {
    setVisualEnhancementLevel(value);
    updatePlayerEnhancementPreference('visualEnhancementLevel', value);
    return value === 'off'
      ? '当前关闭'
      : `当前${getVisualEnhancementLevelLabel(value)}`;
  };

  const updateDesktopFullscreenControlState = (fullscreen: boolean) => {
    artPlayerRef.current?.controls?.update?.(
      buildDesktopFullscreenControl(fullscreen)
    );
  };

  const toggleDesktopPlayerFullscreen = async () => {
    const nextState = await toggleDesktopPlayerPresentationFullscreenState(
      artPlayerRef.current
    );
    if (nextState === null) {
      if (artPlayerRef.current?.notice) {
        artPlayerRef.current.notice.show = '当前环境不支持视频全屏';
      }
      return null;
    }

    updateDesktopFullscreenControlState(nextState);
    return nextState;
  };

  const bindDesktopFullscreenState = () => {
    removeDesktopFullscreenListenerRef.current?.();

    if (getRuntimeConfig().APP_TARGET !== 'desktop' || !artPlayerRef.current) {
      removeDesktopFullscreenListenerRef.current = null;
      return;
    }

    removeDesktopFullscreenListenerRef.current =
      bindDesktopPlayerPresentationFullscreenState(
        artPlayerRef.current,
        (fullscreen) => {
          updateDesktopFullscreenControlState(fullscreen);
        }
      );
  };

  const buildDesktopFullscreenControl = (fullscreen = false) => ({
    name: 'desktop-player-fullscreen',
    position: 'right',
    index: 70,
    tooltip: fullscreen ? '退出全屏' : '视频全屏',
    html: fullscreen
      ? '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 4H4v3M15 4h3v3M18 15v3h-3M4 15v3h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 8h6v6H8z" stroke="currentColor" stroke-width="1.8"/></svg></i>'
      : '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 4H4v4M14 4h4v4M18 14v4h-4M8 18H4v-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></i>',
    click: async function (control: any) {
      const nextState = await toggleDesktopPlayerFullscreen();
      if (nextState === null) {
        return;
      }

      control.update(buildDesktopFullscreenControl(nextState));
    },
  });

  // Wake Lock 相关函数
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request(
          'screen'
        );
        console.log('Wake Lock 已启用');
      }
    } catch (err) {
      console.warn('Wake Lock 请求失败:', err);
    }
  };

  const releaseWakeLock = async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('Wake Lock 已释放');
      }
    } catch (err) {
      console.warn('Wake Lock 释放失败:', err);
    }
  };

  // 清理播放器资源的统一函数
  const cleanupPlayer = () => {
    enhancementManagerRef.current?.dispose();
    enhancementManagerRef.current = null;
    setAudioEnhancementStatus(null);
    removeDesktopFullscreenListenerRef.current?.();
    removeDesktopFullscreenListenerRef.current = null;

    if (artPlayerRef.current) {
      try {
        // 销毁 HLS 实例
        if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
          artPlayerRef.current.video.hls.destroy();
        }

        // 销毁 ArtPlayer 实例
        artPlayerRef.current.destroy();
        artPlayerRef.current = null;
        playerSessionRef.current = null;

        console.log('播放器资源已清理');
      } catch (err) {
        console.warn('清理播放器资源时出错:', err);
        artPlayerRef.current = null;
        playerSessionRef.current = null;
      }
    }
  };

  // 去广告相关函数
  function filterAdsFromM3U8(m3u8Content: string): string {
    if (!m3u8Content) return '';
    return sanitizeVodManifestContent(m3u8Content);
  }

  function buildOfflineHlsErrorMessage(data: any): string | null {
    const detail = typeof data?.details === 'string' ? data.details : '';

    switch (detail) {
      case 'manifestLoadError':
      case 'levelLoadError':
        return '离线播放清单读取失败，请返回下载页重新下载';
      case 'fragLoadError':
        return '离线视频分片缺失或缓存异常，请返回下载页重新下载';
      case 'keyLoadError':
        return '离线解密密钥缺失或缓存异常，请返回下载页重新下载';
      case 'manifestIncompatibleCodecsError':
      case 'bufferAddCodecError':
        return '离线视频编码当前浏览器不支持，请重新下载其他清晰度后重试';
      case 'fragParsingError':
      case 'bufferAppendingError':
      case 'bufferAppendError':
        return '离线视频数据损坏或不完整，请返回下载页重新下载';
      default:
        return null;
    }
  }

  // 跳过片头片尾配置相关函数
  const handleSkipConfigChange = async (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;

    try {
      setSkipConfig(newConfig);
      if (!newConfig.enable && !newConfig.intro_time && !newConfig.outro_time) {
        await deleteSkipConfig(currentSourceRef.current, currentIdRef.current);
        artPlayerRef.current.setting.update({
          name: '跳过片头片尾',
          html: '跳过片头片尾',
          switch: skipConfigRef.current.enable,
          onSwitch: function (item: any) {
            const newConfig = {
              ...skipConfigRef.current,
              enable: !item.switch,
            };
            handleSkipConfigChange(newConfig);
            return !item.switch;
          },
        });
        artPlayerRef.current.setting.update({
          name: '设置片头',
          html: '设置片头',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
          tooltip:
            skipConfigRef.current.intro_time === 0
              ? '设置片头时间'
              : `${formatTime(skipConfigRef.current.intro_time)}`,
          onClick: function () {
            const currentTime = artPlayerRef.current?.currentTime || 0;
            if (currentTime > 0) {
              const newConfig = {
                ...skipConfigRef.current,
                intro_time: currentTime,
              };
              handleSkipConfigChange(newConfig);
              return `${formatTime(currentTime)}`;
            }
          },
        });
        artPlayerRef.current.setting.update({
          name: '设置片尾',
          html: '设置片尾',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
          tooltip:
            skipConfigRef.current.outro_time >= 0
              ? '设置片尾时间'
              : `-${formatTime(-skipConfigRef.current.outro_time)}`,
          onClick: function () {
            const outroTime =
              -(
                artPlayerRef.current?.duration -
                artPlayerRef.current?.currentTime
              ) || 0;
            if (outroTime < 0) {
              const newConfig = {
                ...skipConfigRef.current,
                outro_time: outroTime,
              };
              handleSkipConfigChange(newConfig);
              return `-${formatTime(-outroTime)}`;
            }
          },
        });
      } else {
        await saveSkipConfig(
          currentSourceRef.current,
          currentIdRef.current,
          newConfig
        );
      }
      console.log('跳过片头片尾配置已保存:', newConfig);
    } catch (err) {
      console.error('保存跳过片头片尾配置失败:', err);
    }
  };

  useEffect(() => {
    if (!artPlayerRef.current?.setting?.update) {
      return;
    }

    artPlayerRef.current.setting.update({
      name: '音量突增保护',
      html: '音量突增保护',
      tooltip: getAudioSpikeProtectionLevelLabel(audioSpikeProtectionLevel),
      selector: AUDIO_SPIKE_PROTECTION_LEVEL_OPTIONS.map((option) => ({
        value: option.value,
        name: `audio-spike-protection-${option.value}`,
        default: option.value === audioSpikeProtectionLevel,
        html: option.label,
      })),
      onSelect: function (item: any) {
        return handleAudioSpikeProtectionLevelChange(item.value);
      },
    });
    artPlayerRef.current.setting.update({
      name: '动态保护',
      html: '动态保护',
      tooltip: audioDynamicProtectionEnabled ? '当前开启' : '当前关闭',
      switch: audioDynamicProtectionEnabled,
      onSwitch: function (item: any) {
        return handleAudioDynamicProtectionToggle(!item.switch);
      },
    });
    artPlayerRef.current.setting.update({
      name: '固定峰值上限',
      html: '固定峰值上限',
      tooltip: audioFixedCeilingEnabled ? '当前开启' : '当前关闭',
      switch: audioFixedCeilingEnabled,
      onSwitch: function (item: any) {
        return handleAudioFixedCeilingToggle(!item.switch);
      },
    });
    artPlayerRef.current.setting.update({
      name: '去磨皮修正',
      html: '去磨皮修正',
      tooltip: getVisualEnhancementLevelLabel(visualEnhancementLevel),
      selector: VISUAL_ENHANCEMENT_LEVEL_OPTIONS.map((option) => ({
        value: option.value,
        name: `visual-enhancement-${option.value}`,
        default: option.value === visualEnhancementLevel,
        html: option.label,
      })),
      onSelect: function (item: any) {
        return handleVisualEnhancementLevelChange(item.value);
      },
    });
  }, [
    audioDynamicProtectionEnabled,
    audioFixedCeilingEnabled,
    audioSpikeProtectionLevel,
    visualEnhancementLevel,
  ]);

  const formatTime = (seconds: number): string => {
    if (seconds === 0) return '00:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.round(seconds % 60);

    if (hours === 0) {
      // 不到一小时，格式为 00:00
      return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
        .toString()
        .padStart(2, '0')}`;
    } else {
      // 超过一小时，格式为 00:00:00
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  };

  class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    private cacheAbortController: AbortController | null = null;

    constructor(config: any) {
      super(config);
    }

    abort() {
      this.cacheAbortController?.abort();
      this.cacheAbortController = null;

      if (typeof super.abort === 'function') {
        super.abort();
      }
    }

    destroy() {
      this.cacheAbortController?.abort();
      this.cacheAbortController = null;

      if (typeof super.destroy === 'function') {
        super.destroy();
      }
    }

    load(context: any, config: any, callbacks: any) {
      const wrappedCallbacks = {
        ...callbacks,
        onSuccess: (
          response: any,
          stats: any,
          successContext: any,
          networkDetails: any
        ) => {
          if (
            blockAdEnabledRef.current &&
            response.data &&
            typeof response.data === 'string'
          ) {
            response.data = filterAdsFromM3U8(response.data);
          }

          return callbacks.onSuccess(
            response,
            stats,
            successContext,
            networkDetails ?? null
          );
        },
      };

      if (!isOfflineMode) {
        super.load(context, config, wrappedCallbacks);
        return;
      }

      const controller = new AbortController();
      const stats = buildCachedLoaderStats();
      this.context = context;
      (this as any).config = config;
      (this as any).callbacks = wrappedCallbacks;
      this.stats = stats;
      this.cacheAbortController = controller;

      void (async () => {
        try {
          const cachedResponse = await readOfflineCachedVodResponse(
            context.url,
            {
              rangeStart: context.rangeStart,
              rangeEnd: context.rangeEnd,
            }
          );

          if (controller.signal.aborted) {
            stats.aborted = true;
            callbacks.onAbort?.(stats, context, null);
            return;
          }

          if (!cachedResponse) {
            setIsVideoLoading(false);
            setError('离线缓存缺失，无法继续播放');
            callbacks.onError(
              {
                code: 404,
                text: '离线缓存缺失，无法继续播放',
              },
              context,
              null,
              stats
            );
            return;
          }

          (this as any).response = cachedResponse;

          const responseData =
            context.responseType === 'arraybuffer'
              ? await cachedResponse.arrayBuffer()
              : await cachedResponse.text();

          if (controller.signal.aborted) {
            stats.aborted = true;
            callbacks.onAbort?.(stats, context, null);
            return;
          }

          const end = performance.now();
          const responseSize =
            responseData instanceof ArrayBuffer
              ? responseData.byteLength
              : responseData.length;
          stats.loading.first = end;
          stats.loading.end = end;
          stats.chunkCount = 1;
          stats.total = responseSize;
          stats.loaded = stats.total;

          wrappedCallbacks.onProgress?.(
            stats,
            context,
            responseData,
            cachedResponse
          );
          wrappedCallbacks.onSuccess(
            {
              url: cachedResponse.url || context.url,
              data: responseData,
              code: cachedResponse.status,
            },
            stats,
            context,
            cachedResponse
          );
        } catch (error) {
          if (controller.signal.aborted) {
            stats.aborted = true;
            callbacks.onAbort?.(stats, context, null);
            return;
          }

          callbacks.onError(
            {
              code: 0,
              text: error instanceof Error ? error.message : '读取离线缓存失败',
            },
            context,
            null,
            stats
          );
          setIsVideoLoading(false);
          setError(error instanceof Error ? error.message : '读取离线缓存失败');
        } finally {
          if (this.cacheAbortController === controller) {
            this.cacheAbortController = null;
          }
        }
      })();
    }
  }

  // 当集数索引变化时自动更新视频地址
  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex);
  }, [detail, currentEpisodeIndex]);

  // 进入页面时直接获取全部源信息
  useEffect(() => {
    if (initStartedRef.current) {
      return;
    }

    if (isOfflineMode && !downloadStoreHydrated) {
      return;
    }

    const fetchSourceDetail = async (
      source: string,
      id: string
    ): Promise<SearchResult[]> => {
      try {
        const detailResponse = await apiFetch('/detail', {
          searchParams: { source, id },
        });
        if (!detailResponse.ok) {
          throw new Error('获取视频详情失败');
        }
        const detailData = normalizeVodDetailForPlayback(
          (await detailResponse.json()) as SearchResult
        );
        setAvailableSources([detailData]);
        return [detailData];
      } catch (err) {
        console.error('获取视频详情失败:', err);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };
    const fetchSourcesData = async (
      query: string,
      options: {
        apply?: boolean;
      } = {}
    ): Promise<SearchResult[]> => {
      const applyResults = options.apply !== false;

      // 根据搜索词获取全部源信息
      try {
        const results = await searchPlaybackSources({
          title: videoTitleRef.current,
          year: videoYearRef.current,
          searchType,
          query,
          doubanId: videoDoubanIdRef.current || undefined,
          preferBest: optimizationEnabled,
          allowAdultCandidates,
        });
        if (applyResults) {
          setAvailableSources(results);
        }
        return results;
      } catch (err) {
        if (applyResults) {
          setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
          setAvailableSources([]);
        }
        return [];
      } finally {
        if (applyResults) {
          setSourceSearchLoading(false);
        }
      }
    };

    const initOfflinePlayback = async () => {
      if (!offlineContent) {
        setError('未找到离线内容');
        setLoading(false);
        return;
      }

      const effectiveOfflinePlaybackContents =
        offlinePlaybackContents.length > 0
          ? offlinePlaybackContents
          : [offlineContent];
      const { detail: offlineDetail, episodeEntries } =
        buildGroupedOfflinePlaybackDetail({
          contents: effectiveOfflinePlaybackContents,
          activeContentId: offlineContent.contentId,
        });

      if (!offlineDetail.episodes.length) {
        setError('当前离线内容没有可播放剧集');
        setLoading(false);
        return;
      }

      let targetIndex = 0;
      const mappedTargetIndex = episodeEntries.findIndex(
        (episode) =>
          episode.contentId === offlineContent.contentId &&
          episode.episodeIndex === initialEpisodeQueryIndex
      );
      if (mappedTargetIndex >= 0) {
        targetIndex = mappedTargetIndex;
      } else {
        const fallbackTargetIndex = episodeEntries.findIndex(
          (episode) => episode.episodeIndex === initialEpisodeQueryIndex
        );
        if (fallbackTargetIndex >= 0) {
          targetIndex = fallbackTargetIndex;
        }
      }

      const targetEpisodeEntry = episodeEntries[targetIndex];
      const targetContent =
        effectiveOfflinePlaybackContents.find(
          (content) => content.contentId === targetEpisodeEntry?.contentId
        ) || offlineContent;
      const targetEpisodeMeta = targetContent.episodes.find(
        (episode) => episode.episodeIndex === targetEpisodeEntry?.episodeIndex
      );

      if (
        !targetEpisodeMeta ||
        !(await validateDownloadedEpisode(targetEpisodeMeta))
      ) {
        router.replace('/downloads?error=missing');
        return;
      }

      const playableDetail = normalizeVodDetailForPlayback(
        applyOfflinePlaybackOwner({
          detail: offlineDetail,
          contents: effectiveOfflinePlaybackContents,
          ownerContentId: targetContent.contentId,
        })
      );

      setNeedPrefer(false);
      setActiveOfflineContentId(targetContent.contentId);
      setOfflineEpisodeEntries(episodeEntries);
      setCurrentSource(playableDetail.source);
      setCurrentId(playableDetail.id);
      setVideoYear(playableDetail.year);
      setVideoTitle(playableDetail.title || videoTitleRef.current);
      setVideoCover(playableDetail.poster);
      setVideoDoubanId(playableDetail.douban_id || 0);
      setAvailableSources([]);
      setDetail(playableDetail);
      setCurrentEpisodeIndex(targetIndex);

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('offline', '1');
      newUrl.searchParams.set('contentId', targetContent.contentId);
      newUrl.searchParams.set('source', playableDetail.source);
      newUrl.searchParams.set('id', playableDetail.id);
      newUrl.searchParams.set('year', playableDetail.year);
      newUrl.searchParams.set('title', playableDetail.title);
      if (playableDetail.douban_id) {
        newUrl.searchParams.set('doubanId', String(playableDetail.douban_id));
      } else {
        newUrl.searchParams.delete('doubanId');
      }
      newUrl.searchParams.set(
        'episode',
        String((targetEpisodeEntry?.episodeIndex || 0) + 1)
      );
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('✨ 离线内容已就绪，即将开始播放...');

      setTimeout(() => {
        setLoading(false);
      }, 300);
    };

    const initAll = async () => {
      initStartedRef.current = true;

      if (isOfflineMode) {
        setLoading(true);
        setLoadingStage('fetching');
        setLoadingMessage('📦 正在读取离线内容...');
        await initOfflinePlayback();
        return;
      }

      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要参数');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId
          ? '🎬 正在获取视频详情...'
          : '🔍 正在搜索播放源...'
      );

      setPrecomputedVideoInfo(new Map());

      const discoveryQuery = searchTitle || videoTitle;
      const shouldLoadSelectedSourceFirst = Boolean(
        currentSource && currentId && !needPreferRef.current
      );
      let selectedSourceLoaded = false;
      let sourcesInfo: SearchResult[] = [];

      if (shouldLoadSelectedSourceFirst) {
        sourcesInfo = await fetchSourceDetail(currentSource, currentId);
        selectedSourceLoaded = sourcesInfo.length > 0;

        if (selectedSourceLoaded && discoveryQuery) {
          const selectedSource = sourcesInfo[0];
          const selectedSourceKey = buildAvailableSourceKey(selectedSource);

          void (async () => {
            const discoveredSources = await fetchSourcesData(discoveryQuery, {
              apply: false,
            });
            if (
              discoveredSources.length === 0 ||
              buildAvailableSourceKey({
                source: currentSourceRef.current,
                id: currentIdRef.current,
              }) !== selectedSourceKey
            ) {
              return;
            }

            setAvailableSources(
              mergeAvailableSources(sourcesInfo, discoveredSources)
            );
          })();
        } else if (discoveryQuery) {
          sourcesInfo = await fetchSourcesData(discoveryQuery);
        }
      } else {
        sourcesInfo = await fetchSourcesData(discoveryQuery);
        if (
          currentSource &&
          currentId &&
          !sourcesInfo.some(
            (source) =>
              source.source === currentSource && source.id === currentId
          )
        ) {
          sourcesInfo = await fetchSourceDetail(currentSource, currentId);
          selectedSourceLoaded = sourcesInfo.length > 0;
        }
      }
      if (sourcesInfo.length === 0) {
        setError('未找到匹配结果');
        setLoading(false);
        return;
      }

      let detailData: SearchResult = sourcesInfo[0];
      // 指定源和id且无需优选
      if (
        currentSource &&
        currentId &&
        !needPreferRef.current &&
        selectedSourceLoaded
      ) {
        const target = sourcesInfo.find(
          (source) => source.source === currentSource && source.id === currentId
        );
        if (target) {
          detailData = target;
        } else {
          setError('未找到匹配结果');
          setLoading(false);
          return;
        }
      }

      // 未指定源和 id 或需要优选，且开启优选开关
      if (
        (!currentSource || !currentId || needPreferRef.current) &&
        optimizationEnabled
      ) {
        setLoadingStage('preferring');
        setLoadingMessage('⚡ 正在优选最佳播放源...');

        detailData = await preferBestSource(sourcesInfo);
      }

      console.log(detailData.source, detailData.id);

      const playableDetail = normalizeVodDetailForPlayback(detailData);

      setNeedPrefer(false);
      setOfflineEpisodeEntries([]);
      setCurrentSource(playableDetail.source);
      setCurrentId(playableDetail.id);
      setVideoYear(playableDetail.year);
      setVideoTitle(playableDetail.title || videoTitleRef.current);
      setVideoCover(playableDetail.poster);
      setVideoDoubanId(playableDetail.douban_id || 0);
      setDetail(playableDetail);
      if (currentEpisodeIndex >= playableDetail.episodes.length) {
        setCurrentEpisodeIndex(0);
      }

      // 规范URL参数
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', playableDetail.source);
      newUrl.searchParams.set('id', playableDetail.id);
      newUrl.searchParams.set('year', playableDetail.year);
      newUrl.searchParams.set('title', playableDetail.title);
      if (playableDetail.douban_id) {
        newUrl.searchParams.set('doubanId', String(playableDetail.douban_id));
      } else {
        newUrl.searchParams.delete('doubanId');
      }
      newUrl.searchParams.delete('prefer');
      newUrl.searchParams.delete('offline');
      newUrl.searchParams.delete('contentId');
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('✨ 准备就绪，即将开始播放...');

      // 短暂延迟让用户看到完成状态
      setTimeout(() => {
        setLoading(false);
      }, 1000);
    };

    void initAll();
  }, [
    currentId,
    currentSource,
    downloadStoreHydrated,
    initialEpisodeQueryIndex,
    isOfflineMode,
    offlineContent,
    offlinePlaybackContents,
    router,
    searchTitle,
    searchType,
    videoTitle,
    allowAdultCandidates,
  ]);

  useEffect(() => {
    episodeProgressMapRef.current = {};
    playbackHistoryRestoreKeyRef.current = '';
  }, [currentSource, currentId]);

  useEffect(() => {
    setIsOfflineSameTitleDialogOpen(false);
  }, [activeOfflineContentId]);

  useEffect(() => {
    if (!isOfflineSameTitleDialogOpen) {
      return;
    }

    const releaseScrollLock = acquireScrollLock({
      freezeBody: true,
      lockHtml: true,
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOfflineSameTitleDialogOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      releaseScrollLock();
    };
  }, [isOfflineSameTitleDialogOpen]);

  // 播放记录处理
  useEffect(() => {
    const initFromHistory = async () => {
      if (!currentSource || !currentId || !detail) {
        return;
      }

      if (isOfflineMode && offlineEpisodeEntries.length === 0) {
        return;
      }

      if (skipNextPlaybackHistoryRestoreRef.current) {
        skipNextPlaybackHistoryRestoreRef.current = false;
        return;
      }

      const restoreKey = `${currentSource}:${currentId}:${
        isOfflineMode
          ? offlineEpisodeEntries
              .map(
                (episode) => `${episode.contentId}:${episode.episodeIndex + 1}`
              )
              .join('|')
          : 'online'
      }`;

      if (playbackHistoryRestoreKeyRef.current === restoreKey) {
        return;
      }

      playbackHistoryRestoreKeyRef.current = restoreKey;

      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(currentSource, currentId);
        const record = allRecords[key];

        if (record) {
          const targetIndex = getPlaybackRecordEpisodeIndex(record.index);
          const targetTime =
            readStoredEpisodeProgress(currentSource, currentId, record.index) ||
            record.play_time;

          if (targetTime > 0) {
            episodeProgressMapRef.current[record.index] = targetTime;
          }

          if (
            targetIndex >= 0 &&
            targetIndex < (detail.episodes?.length || 0)
          ) {
            if (targetIndex !== currentEpisodeIndexRef.current) {
              setCurrentEpisodeIndex(targetIndex);
              updateEpisodeQueryParam(targetIndex);
            }
            resumeTimeRef.current = targetTime > 0 ? targetTime : null;
            return;
          }
        }

        const currentEpisodeResumeTime = getEpisodeResumeTime(
          currentEpisodeIndexRef.current
        );
        if (currentEpisodeResumeTime > 0) {
          resumeTimeRef.current = currentEpisodeResumeTime;
        }
      } catch (err) {
        console.error('读取播放记录失败:', err);
      }
    };

    initFromHistory();
  }, [currentId, currentSource, detail, isOfflineMode, offlineEpisodeEntries]);

  // 跳过片头片尾配置处理
  useEffect(() => {
    // 仅在初次挂载时检查跳过片头片尾配置
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;

      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) {
          setSkipConfig(config);
        }
      } catch (err) {
        console.error('读取跳过片头片尾配置失败:', err);
      }
    };

    initSkipConfig();
  }, []);

  // 处理换源
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string
  ) => {
    try {
      // 显示换源加载状态
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);

      // 记录当前播放进度（仅在同一集数切换时恢复）
      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      console.log('换源前当前播放时间:', currentPlayTime);

      // 清除前一个历史记录
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deletePlayRecord(
            currentSourceRef.current,
            currentIdRef.current
          );
          console.log('已清除前一个播放记录');
        } catch (err) {
          console.error('清除播放记录失败:', err);
        }
      }

      // 清除并设置下一个跳过片头片尾配置
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deleteSkipConfig(
            currentSourceRef.current,
            currentIdRef.current
          );
          await saveSkipConfig(newSource, newId, skipConfigRef.current);
        } catch (err) {
          console.error('清除跳过片头片尾配置失败:', err);
        }
      }

      const newDetail = availableSources.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!newDetail) {
        setError('未找到匹配结果');
        return;
      }

      // 尝试跳转到当前正在播放的集数
      let targetIndex = currentEpisodeIndex;

      // 如果当前集数超出新源的范围，则跳转到第一集
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }

      // 如果仍然是同一集数且播放进度有效，则在播放器就绪后恢复到原始进度
      if (targetIndex !== currentEpisodeIndex) {
        resumeTimeRef.current = 0;
      } else if (
        (!resumeTimeRef.current || resumeTimeRef.current === 0) &&
        currentPlayTime > 1
      ) {
        resumeTimeRef.current = currentPlayTime;
      }

      // 更新URL参数（不刷新页面）
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      if (newDetail.douban_id) {
        newUrl.searchParams.set('doubanId', String(newDetail.douban_id));
      } else {
        newUrl.searchParams.delete('doubanId');
      }
      window.history.replaceState({}, '', newUrl.toString());

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setVideoDoubanId(newDetail.douban_id || 0);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);
    } catch (err) {
      // 隐藏换源加载状态
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 集数切换
  // ---------------------------------------------------------------------------
  const getPlaybackRecordEpisodeNumber = (episodeIndex: number): number => {
    if (isOfflineMode && offlineEpisodeEntriesRef.current[episodeIndex]) {
      return offlineEpisodeEntriesRef.current[episodeIndex].episodeIndex + 1;
    }

    return episodeIndex + 1;
  };

  const getPlaybackRecordEpisodeIndex = (episodeNumber: number): number => {
    if (isOfflineMode) {
      const currentOfflinePlaybackContentId =
        currentSourceRef.current && currentIdRef.current
          ? buildDownloadContentId(
              currentSourceRef.current,
              currentIdRef.current
            )
          : activeOfflineContentId;
      const exactMatchIndex = offlineEpisodeEntriesRef.current.findIndex(
        (episode) =>
          episode.contentId === currentOfflinePlaybackContentId &&
          episode.episodeIndex + 1 === episodeNumber
      );
      if (exactMatchIndex >= 0) {
        return exactMatchIndex;
      }

      return offlineEpisodeEntriesRef.current.findIndex(
        (episode) => episode.episodeIndex + 1 === episodeNumber
      );
    }

    return episodeNumber - 1;
  };

  const rememberEpisodeProgress = (
    episodeIndex: number,
    progressSeconds: number
  ): void => {
    if (
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !Number.isFinite(progressSeconds) ||
      progressSeconds <= 0
    ) {
      return;
    }

    const episodeNumber = getPlaybackRecordEpisodeNumber(episodeIndex);
    const normalizedProgress = Math.floor(progressSeconds);

    episodeProgressMapRef.current[episodeNumber] = normalizedProgress;
    persistStoredEpisodeProgress(
      currentSourceRef.current,
      currentIdRef.current,
      episodeNumber,
      normalizedProgress
    );
  };

  const getEpisodeResumeTime = (
    episodeIndex: number,
    options: {
      source?: string;
      id?: string;
    } = {}
  ): number => {
    const targetSource = options.source || currentSourceRef.current;
    const targetId = options.id || currentIdRef.current;
    const episodeNumber = getPlaybackRecordEpisodeNumber(episodeIndex);
    const shouldReuseCachedProgress =
      targetSource === currentSourceRef.current &&
      targetId === currentIdRef.current;
    const cachedProgress = shouldReuseCachedProgress
      ? episodeProgressMapRef.current[episodeNumber]
      : undefined;

    if (
      typeof cachedProgress === 'number' &&
      Number.isFinite(cachedProgress) &&
      cachedProgress > 0
    ) {
      return cachedProgress;
    }

    if (!targetSource || !targetId) {
      return 0;
    }

    const storedProgress = readStoredEpisodeProgress(
      targetSource,
      targetId,
      episodeNumber
    );

    if (storedProgress && storedProgress > 0) {
      if (shouldReuseCachedProgress) {
        episodeProgressMapRef.current[episodeNumber] = storedProgress;
      }
      return storedProgress;
    }

    return 0;
  };

  const handleOfflineRelatedVideoSelect = (contentId: string) => {
    if (!isOfflineMode) {
      return;
    }

    const targetOfflineContent = offlineLibrary[contentId];
    if (!targetOfflineContent) {
      setError('未找到离线内容');
      return;
    }

    const targetPlaybackContents = getOfflinePlaybackContents({
      library: offlineLibrary,
      activeContentId: contentId,
    });
    const effectiveTargetPlaybackContents =
      targetPlaybackContents.length > 0
        ? targetPlaybackContents
        : [targetOfflineContent];
    const { detail: offlineDetail, episodeEntries } =
      buildGroupedOfflinePlaybackDetail({
        contents: effectiveTargetPlaybackContents,
        activeContentId: targetOfflineContent.contentId,
      });

    if (!offlineDetail.episodes.length) {
      setError('当前离线内容没有可播放剧集');
      return;
    }

    const requestedEpisodeIndex =
      targetOfflineContent.episodes[0]?.episodeIndex ?? 0;
    const mappedTargetIndex = episodeEntries.findIndex(
      (episode) =>
        episode.contentId === targetOfflineContent.contentId &&
        episode.episodeIndex === requestedEpisodeIndex
    );
    const targetIndex = mappedTargetIndex >= 0 ? mappedTargetIndex : 0;
    const targetEpisodeEntry = episodeEntries[targetIndex];
    const targetContent =
      effectiveTargetPlaybackContents.find(
        (content) => content.contentId === targetEpisodeEntry?.contentId
      ) || targetOfflineContent;
    const targetEpisodeMeta = targetContent.episodes.find(
      (episode) => episode.episodeIndex === targetEpisodeEntry?.episodeIndex
    );

    if (!targetEpisodeEntry || !targetEpisodeMeta) {
      setError('当前离线剧集不存在，请返回下载页重新下载');
      return;
    }

    setError(null);
    setIsVideoLoading(true);

    void (async () => {
      const isEpisodeReady = await validateDownloadedEpisode(targetEpisodeMeta);
      if (!isEpisodeReady) {
        setIsVideoLoading(false);
        setError('离线资源缺失或首片段不可用，请返回下载页重新下载');
        return;
      }

      const playableDetail = normalizeVodDetailForPlayback(
        applyOfflinePlaybackOwner({
          detail: offlineDetail,
          contents: effectiveTargetPlaybackContents,
          ownerContentId: targetContent.contentId,
        })
      );
      const episodeNumber = (targetEpisodeEntry.episodeIndex || 0) + 1;
      const storedProgress = readStoredEpisodeProgress(
        targetContent.source,
        targetContent.vodId,
        episodeNumber
      );

      resumeTimeRef.current =
        storedProgress && storedProgress > 0 ? storedProgress : null;

      setNeedPrefer(false);
      setActiveOfflineContentId(targetContent.contentId);
      setOfflineEpisodeEntries(episodeEntries);
      setCurrentSource(playableDetail.source);
      setCurrentId(playableDetail.id);
      setVideoYear(playableDetail.year);
      setVideoTitle(playableDetail.title || targetContent.title);
      setVideoCover(playableDetail.poster);
      setVideoDoubanId(playableDetail.douban_id || 0);
      setAvailableSources([]);
      setDetail(playableDetail);
      setCurrentEpisodeIndex(targetIndex);

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('offline', '1');
      newUrl.searchParams.set('contentId', targetContent.contentId);
      newUrl.searchParams.set('source', playableDetail.source);
      newUrl.searchParams.set('id', playableDetail.id);
      newUrl.searchParams.set('year', playableDetail.year);
      newUrl.searchParams.set('title', playableDetail.title);
      if (playableDetail.douban_id) {
        newUrl.searchParams.set('doubanId', String(playableDetail.douban_id));
      } else {
        newUrl.searchParams.delete('doubanId');
      }
      newUrl.searchParams.set('episode', String(episodeNumber));
      window.history.replaceState({}, '', newUrl.toString());
    })();
  };

  const handleOpenOfflineSameTitleDialog = () => {
    if (!shouldShowOfflineAdultRelatedVideos) {
      return;
    }

    setIsOfflineSameTitleDialogOpen(true);
  };

  const handleOfflineSameTitleVideoSelect = (contentId: string) => {
    setIsOfflineSameTitleDialogOpen(false);
    handleOfflineRelatedVideoSelect(contentId);
  };

  const updateEpisodeQueryParam = (episodeIndex: number): void => {
    if (typeof window === 'undefined') {
      return;
    }

    const newUrl = new URL(window.location.href);
    if (isOfflineMode) {
      const targetEpisode = offlineEpisodeEntriesRef.current[episodeIndex];
      const targetContent = offlinePlaybackContents.find(
        (content) => content.contentId === targetEpisode?.contentId
      );

      if (targetEpisode && targetContent) {
        newUrl.searchParams.set('offline', '1');
        newUrl.searchParams.set('contentId', targetContent.contentId);
        newUrl.searchParams.set('source', targetContent.source);
        newUrl.searchParams.set('id', targetContent.vodId);
        newUrl.searchParams.set('title', targetContent.title);
        newUrl.searchParams.set('year', targetContent.year);
        if (targetContent.doubanId) {
          newUrl.searchParams.set('doubanId', String(targetContent.doubanId));
        } else {
          newUrl.searchParams.delete('doubanId');
        }
        newUrl.searchParams.set(
          'episode',
          String(targetEpisode.episodeIndex + 1)
        );
      }
    } else {
      const nextEpisodeNumber = getPlaybackRecordEpisodeNumber(episodeIndex);
      newUrl.searchParams.set('episode', String(nextEpisodeNumber));
    }
    window.history.replaceState({}, '', newUrl.toString());
  };

  // 保存播放进度
  const saveCurrentPlayProgress = async () => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    ) {
      return;
    }

    const player = artPlayerRef.current;
    const currentTime = player.currentTime || 0;
    const duration = player.duration || 0;

    // 如果播放时间太短（少于5秒）或者视频时长无效，不保存
    if (currentTime < 1 || !duration) {
      return;
    }

    rememberEpisodeProgress(currentEpisodeIndexRef.current, currentTime);

    try {
      await savePlayRecord(currentSourceRef.current, currentIdRef.current, {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year,
        cover: detailRef.current?.poster || '',
        index: getPlaybackRecordEpisodeNumber(currentEpisodeIndexRef.current),
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitle,
        playback_mode: currentPlaybackMode,
        offline_content_id: isOfflineMode
          ? activeOfflineContentId || undefined
          : undefined,
        is_adult: isAdultContentResult({
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          type_name: detailRef.current?.type_name,
          class: detailRef.current?.class,
          desc: detailRef.current?.desc,
        }),
      });

      const currentFollowRecord = followRecordRef.current;
      if (currentFollowRecord) {
        const nextFollowRecord = advanceAcknowledgedEpisodeCount(
          currentFollowRecord,
          getPlaybackRecordEpisodeNumber(currentEpisodeIndexRef.current),
          {
            latestEpisodeCount: detailRef.current?.episodes.length || 1,
            checkedAt: Date.now(),
          }
        );

        if (
          nextFollowRecord.acknowledged_episode_count !==
            currentFollowRecord.acknowledged_episode_count ||
          nextFollowRecord.latest_episode_count !==
            currentFollowRecord.latest_episode_count ||
          nextFollowRecord.last_checked_at !==
            currentFollowRecord.last_checked_at
        ) {
          await saveFollowRecord(
            currentSourceRef.current,
            currentIdRef.current,
            nextFollowRecord
          );
          setFollowRecord(nextFollowRecord);
        }
      }

      lastSaveTimeRef.current = Date.now();
      console.log('播放进度已保存:', {
        title: videoTitleRef.current,
        episode: getPlaybackRecordEpisodeNumber(currentEpisodeIndexRef.current),
        year: detailRef.current?.year,
        progress: `${Math.floor(currentTime)}/${Math.floor(duration)}`,
      });
    } catch (err) {
      console.error('保存播放进度失败:', err);
    }
  };

  const switchEpisode = (episodeIndex: number) => {
    const currentDetail = detailRef.current;
    if (
      !currentDetail?.episodes ||
      episodeIndex < 0 ||
      episodeIndex >= currentDetail.episodes.length ||
      episodeIndex === currentEpisodeIndexRef.current
    ) {
      return;
    }

    void (async () => {
      let resumeTime = 0;

      if (isOfflineMode) {
        const targetEpisode = offlineEpisodeEntriesRef.current[episodeIndex];
        const targetContent = offlinePlaybackContents.find(
          (content) => content.contentId === targetEpisode?.contentId
        );
        const targetEpisodeMeta = targetContent?.episodes.find(
          (episode) => episode.episodeIndex === targetEpisode?.episodeIndex
        );

        if (!targetEpisode || !targetContent || !targetEpisodeMeta) {
          setError('当前离线剧集不存在，请返回下载页重新下载');
          return;
        }

        setIsVideoLoading(true);
        const isEpisodeReady = await validateDownloadedEpisode(
          targetEpisodeMeta
        );
        if (!isEpisodeReady) {
          setIsVideoLoading(false);
          setError('离线资源缺失或首片段不可用，请返回下载页重新下载');
          return;
        }

        resumeTime = getEpisodeResumeTime(episodeIndex, {
          source: targetContent.source,
          id: targetContent.vodId,
        });

        const currentOfflinePlaybackContentId =
          currentSourceRef.current && currentIdRef.current
            ? buildDownloadContentId(
                currentSourceRef.current,
                currentIdRef.current
              )
            : '';

        if (currentOfflinePlaybackContentId !== targetContent.contentId) {
          const currentOfflineDetail = detailRef.current;
          if (!currentOfflineDetail) {
            setError('离线播放信息缺失，请刷新后重试');
            return;
          }

          skipNextPlaybackHistoryRestoreRef.current = true;
          const nextOfflineDetail = normalizeVodDetailForPlayback(
            applyOfflinePlaybackOwner({
              detail: currentOfflineDetail,
              contents: offlinePlaybackContents,
              ownerContentId: targetContent.contentId,
            })
          );

          setActiveOfflineContentId(targetContent.contentId);
          setCurrentSource(targetContent.source);
          setCurrentId(targetContent.vodId);
          setVideoYear(targetContent.year);
          setVideoTitle(targetContent.title || videoTitleRef.current);
          setVideoCover(targetContent.poster);
          setVideoDoubanId(targetContent.doubanId || 0);
          setDetail(nextOfflineDetail);
        }
      } else {
        resumeTime = getEpisodeResumeTime(episodeIndex);
      }

      void saveCurrentPlayProgress();
      resumeTimeRef.current = resumeTime || 0;
      setCurrentEpisodeIndex(episodeIndex);
      updateEpisodeQueryParam(episodeIndex);
      setError(null);
    })();
  };

  // 处理集数切换
  const handleEpisodeChange = (episodeNumber: number) => {
    switchEpisode(episodeNumber);
  };

  const handlePreviousEpisode = () => {
    const idx = currentEpisodeIndexRef.current;
    if (idx > 0) {
      switchEpisode(idx - 1);
    }
  };

  const handleNextEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      switchEpisode(idx + 1);
    }
  };

  // ---------------------------------------------------------------------------
  // 键盘快捷键
  // ---------------------------------------------------------------------------
  // 处理全局快捷键
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    // 忽略输入框中的按键事件
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }

    // 上箭头 = 音量+
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 下箭头 = 音量-
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 空格 = 播放/暂停
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }

    // f 键 = 切换全屏
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        if (getRuntimeConfig().APP_TARGET === 'desktop') {
          void toggleDesktopPlayerFullscreen();
        } else {
          artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        }
        e.preventDefault();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 播放记录相关
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // 页面即将卸载时保存播放进度和清理资源
    const handleBeforeUnload = () => {
      saveCurrentPlayProgress();
      releaseWakeLock();
      cleanupPlayer();
    };

    // 页面可见性变化时保存播放进度和释放 Wake Lock
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
        releaseWakeLock();
      } else if (document.visibilityState === 'visible') {
        // 页面重新可见时，如果正在播放则重新请求 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
      }
    };

    // 添加事件监听器
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // 清理事件监听器
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail, artPlayerRef.current]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 收藏相关
  // ---------------------------------------------------------------------------
  // 每当 source 或 id 变化时检查收藏状态
  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [currentSource, currentId]);

  // 监听收藏数据更新事件
  useEffect(() => {
    if (!currentSource || !currentId) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        const isFav = !!favorites[key];
        setFavorited(isFav);
      }
    );

    return unsubscribe;
  }, [currentSource, currentId]);

  useEffect(() => {
    if (
      !isDesktopFollowUpdatesEnabled() ||
      isOfflineMode ||
      !currentSource ||
      !currentId
    ) {
      setFollowRecord(null);
      return;
    }

    let active = true;
    const key = generateStorageKey(currentSource, currentId);
    const snapshot = getCachedFollowRecordsSnapshot();

    if (snapshot) {
      setFollowRecord(snapshot[key] || null);
    }

    void (async () => {
      try {
        const follow = await getFollowRecord(currentSource, currentId);
        if (active) {
          setFollowRecord(follow);
        }
      } catch (error) {
        if (active) {
          console.error('读取追更状态失败:', error);
        }
      }
    })();

    const unsubscribe = subscribeToDataUpdates<Record<string, FollowRecord>>(
      'followRecordsUpdated',
      (followRecords) => {
        setFollowRecord(followRecords[key] || null);
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [currentSource, currentId, isOfflineMode]);

  useEffect(() => {
    if (
      !followRecord ||
      !currentSource ||
      !currentId ||
      !detail ||
      !isDesktopFollowUpdatesEnabled()
    ) {
      return;
    }

    const nextFollowRecord = mergeLatestEpisodeCountWithoutRegression(
      {
        ...followRecord,
        title: detail.title || followRecord.title,
        source_name: detail.source_name || followRecord.source_name,
        year: detail.year || followRecord.year,
        cover: detail.poster || followRecord.cover,
      },
      detail.episodes.length || 1,
      followRecord.last_checked_at
    );
    const shouldSave =
      nextFollowRecord.title !== followRecord.title ||
      nextFollowRecord.source_name !== followRecord.source_name ||
      nextFollowRecord.year !== followRecord.year ||
      nextFollowRecord.cover !== followRecord.cover ||
      nextFollowRecord.latest_episode_count !==
        followRecord.latest_episode_count;

    if (!shouldSave) {
      return;
    }

    void (async () => {
      try {
        await saveFollowRecord(currentSource, currentId, nextFollowRecord);
        setFollowRecord(nextFollowRecord);
      } catch (error) {
        console.error('同步追更最新集数失败:', error);
      }
    })();
  }, [currentSource, currentId, detail, followRecord]);

  // 切换收藏
  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        // 如果已收藏，删除收藏
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        // 如果未收藏，添加收藏
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
          playback_mode: currentPlaybackMode,
          offline_content_id: isOfflineMode
            ? activeOfflineContentId || undefined
            : undefined,
          is_adult: isAdultContentResult({
            title: videoTitleRef.current,
            source_name: detailRef.current?.source_name || '',
            type_name: detailRef.current?.type_name,
            class: detailRef.current?.class,
            desc: detailRef.current?.desc,
          }),
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  const markTransientPlaybackRecovery = (message?: string | null) => {
    console.warn('检测到可恢复的播放器启动异常:', message);
    setPlayerRecoveryNotice(
      isOfflineMode
        ? '正在恢复离线播放资源，强制刷新后通常需要几秒重新连接。'
        : '正在恢复播放资源，强制刷新后通常需要几秒重新连接。'
    );
    setIsVideoLoading(true);
    setError((currentError) =>
      isTransientPlaybackBootstrapError(currentError) ? null : currentError
    );
  };

  useEffect(() => {
    let loadingWatchdogTimer: number | null = null;
    let removeVideoEventListeners: (() => void) | null = null;

    const markVideoReady = () => {
      if (loadingWatchdogTimer) {
        window.clearTimeout(loadingWatchdogTimer);
        loadingWatchdogTimer = null;
      }
      setPlayerRecoveryNotice(null);
      setError(null);
      setIsVideoLoading(false);
    };

    const attachNativeVideoListeners = (video: HTMLVideoElement | null) => {
      if (!video) {
        return () => undefined;
      }

      const minimumReadyState = isOfflineMode
        ? HTMLMediaElement.HAVE_FUTURE_DATA
        : HTMLMediaElement.HAVE_METADATA;

      const handleReady = () => {
        markVideoReady();
      };

      const handleMetadata = () => {
        if (!isOfflineMode) {
          markVideoReady();
        }
      };

      const handleError = () => {
        const errorMessage = video.error?.message;
        if (!errorMessage) {
          return;
        }

        if (isTransientPlaybackBootstrapError(errorMessage)) {
          markTransientPlaybackRecovery(errorMessage);
          return;
        }

        setPlayerRecoveryNotice(null);
        setError(errorMessage);
      };

      video.addEventListener('loadedmetadata', handleMetadata);
      video.addEventListener('loadeddata', handleReady);
      video.addEventListener('canplay', handleReady);
      video.addEventListener('playing', handleReady);
      video.addEventListener('error', handleError);

      if (video.readyState >= minimumReadyState) {
        handleReady();
      } else {
        requestAnimationFrame(() => {
          if (video.readyState >= minimumReadyState) {
            handleReady();
          }
        });
      }

      return () => {
        video.removeEventListener('loadedmetadata', handleMetadata);
        video.removeEventListener('loadeddata', handleReady);
        video.removeEventListener('canplay', handleReady);
        video.removeEventListener('playing', handleReady);
        video.removeEventListener('error', handleError);
      };
    };

    if (
      !Artplayer ||
      !Hls ||
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    // 确保选集索引有效
    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }
    console.log(videoUrl);

    const playbackType = getPlaybackType(videoUrl);
    setIsVideoLoading(true);
    setPlayerRecoveryNotice(null);

    // 检测是否为WebKit浏览器
    const isWebkit =
      typeof window !== 'undefined' &&
      typeof (window as any).webkitConvertPointFromNodeToPage === 'function';

    // 非 WebKit 且播放模式未切换时，复用现有播放器减少重建成本
    const canReuseExistingPlayer =
      !isWebkit &&
      artPlayerRef.current &&
      playerSessionRef.current?.isOfflineMode === isOfflineMode &&
      playerSessionRef.current?.playbackType === playbackType;

    if (canReuseExistingPlayer) {
      artPlayerRef.current.option.type = playbackType;
      artPlayerRef.current.switch = videoUrl;
      artPlayerRef.current.title = `${videoTitle} - 第${
        currentEpisodeIndex + 1
      }集`;
      artPlayerRef.current.poster = videoCover;
      playerSessionRef.current = {
        isOfflineMode,
        playbackType,
      };
      if (artPlayerRef.current?.video && playbackType !== 'm3u8') {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }
      syncPlayerEnhancements();
      return;
    }

    // WebKit浏览器或首次创建：销毁之前的播放器实例并创建新的
    if (artPlayerRef.current) {
      cleanupPlayer();
    }

    const isDesktopPlayer = getRuntimeConfig().APP_TARGET === 'desktop';

    try {
      // 创建新的播放器实例
      Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
      Artplayer.USE_RAF = false;
      Artplayer.FULLSCREEN_WEB_IN_BODY = true;

      artPlayerRef.current = new Artplayer({
        container: artRef.current,
        url: videoUrl,
        poster: videoCover,
        volume: 0.7,
        isLive: false,
        muted: false,
        autoplay: true,
        pip: true,
        autoSize: false,
        autoMini: false,
        screenshot: false,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: !isDesktopPlayer,
        fullscreenWeb: !isDesktopPlayer,
        subtitleOffset: false,
        miniProgressBar: false,
        mutex: true,
        playsInline: true,
        autoPlayback: false,
        airplay: true,
        theme: '#22c55e',
        lang: 'zh-cn',
        hotkey: false,
        fastForward: true,
        autoOrientation: true,
        lock: true,
        moreVideoAttr: {
          crossOrigin: 'anonymous',
        },
        type: playbackType,
        // HLS 支持配置
        customType: {
          m3u8: function (video: HTMLVideoElement, url: string) {
            if (!Hls) {
              console.error('HLS.js 未加载');
              setIsVideoLoading(false);
              setError('HLS.js 未加载');
              return;
            }

            if (typeof Hls.isSupported === 'function' && !Hls.isSupported()) {
              if (video.canPlayType('application/vnd.apple.mpegurl')) {
                void (async () => {
                  if (isOfflineMode) {
                    const serviceWorkerReady =
                      isDesktopLocalDownloadRuntimeEnabled()
                        ? true
                        : await ensureOfflineServiceWorkerReady();
                    if (!serviceWorkerReady) {
                      setIsVideoLoading(false);
                      setError(
                        process.env.NODE_ENV === 'development'
                          ? '当前开发模式不提供完整离线缓存，请改用 pnpm preview:offline 后重试'
                          : '离线代理尚未就绪，请刷新页面后重试'
                      );
                      return;
                    }
                  }

                  ensureVideoSource(video, url);
                  video.src = url;
                  video.load();
                  void video.play().catch(() => undefined);
                  if (!isOfflineMode) {
                    markVideoReady();
                  }
                })();
                return;
              }

              setIsVideoLoading(false);
              setError('当前浏览器不支持 HLS 播放');
              return;
            }

            if (video.hls) {
              video.hls.destroy();
            }
            const hlsConfig: Record<string, any> = {
              debug: false, // 关闭日志
              enableWorker: !isOfflineMode, // 离线场景优先稳定性，减少 Worker 变量
              lowLatencyMode: !isOfflineMode, // 离线场景不需要 LL-HLS，避免请求 part/preload 资源

              /* 缓冲/内存相关 */
              maxBufferLength: 30, // 前向缓冲最大 30s，过大容易导致高延迟
              backBufferLength: 30, // 仅保留 30s 已播放内容，避免内存占用
              maxBufferSize: 60 * 1000 * 1000, // 约 60MB，超出后触发清理
              loader: CustomHlsJsLoader,
            };

            const hls = new Hls(hlsConfig);

            hls.on(Hls.Events.MEDIA_ATTACHED, () => {
              if (
                !isOfflineMode &&
                video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
              ) {
                markVideoReady();
              }
            });

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              void video.play().catch(() => undefined);
              if (!isOfflineMode) {
                markVideoReady();
              }
            });

            hls.on(Hls.Events.FRAG_BUFFERED, () => {
              markVideoReady();
            });

            hls.loadSource(url);
            hls.attachMedia(video);
            video.hls = hls;

            hls.on(Hls.Events.ERROR, function (event: any, data: any) {
              console.error('HLS Error:', event, data);
              const offlineErrorMessage = isOfflineMode
                ? buildOfflineHlsErrorMessage(data)
                : null;

              if (isOfflineMode && offlineErrorMessage) {
                setIsVideoLoading(false);
                setError(offlineErrorMessage);
                hls.destroy();
                return;
              }

              if (data.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    if (isOfflineMode) {
                      setIsVideoLoading(false);
                      setError('离线资源缺失或缓存异常，请返回下载页重新下载');
                      hls.destroy();
                      break;
                    }
                    console.log('网络错误，尝试恢复...');
                    hls.startLoad();
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    console.log('媒体错误，尝试恢复...');
                    hls.recoverMediaError();
                    break;
                  default:
                    console.log('无法恢复的错误');
                    hls.destroy();
                    break;
                }
              }
            });
          },
        },
        icons: {
          loading:
            '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
        },
        settings: [
          {
            html: '去广告',
            icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
            tooltip: blockAdEnabled ? '已开启' : '已关闭',
            onClick() {
              const newVal = !blockAdEnabled;
              try {
                localStorage.setItem('enable_blockad', String(newVal));
                if (artPlayerRef.current) {
                  resumeTimeRef.current = artPlayerRef.current.currentTime;
                  if (
                    artPlayerRef.current.video &&
                    artPlayerRef.current.video.hls
                  ) {
                    artPlayerRef.current.video.hls.destroy();
                  }
                  artPlayerRef.current.destroy();
                  artPlayerRef.current = null;
                  playerSessionRef.current = null;
                }
                setBlockAdEnabled(newVal);
              } catch (_) {
                // ignore
              }
              return newVal ? '当前开启' : '当前关闭';
            },
          },
          {
            name: '音量突增保护',
            html: '音量突增保护',
            tooltip: getAudioSpikeProtectionLevelLabel(
              audioSpikeProtectionLevel
            ),
            selector: AUDIO_SPIKE_PROTECTION_LEVEL_OPTIONS.map((option) => ({
              value: option.value,
              name: `audio-spike-protection-${option.value}`,
              default: option.value === audioSpikeProtectionLevel,
              html: option.label,
            })),
            onSelect: function (item) {
              return handleAudioSpikeProtectionLevelChange(item.value);
            },
          },
          {
            name: '动态保护',
            html: '动态保护',
            tooltip: audioDynamicProtectionEnabled ? '当前开启' : '当前关闭',
            switch: audioDynamicProtectionEnabled,
            onSwitch: function (item) {
              return handleAudioDynamicProtectionToggle(!item.switch);
            },
          },
          {
            name: '固定峰值上限',
            html: '固定峰值上限',
            tooltip: audioFixedCeilingEnabled ? '当前开启' : '当前关闭',
            switch: audioFixedCeilingEnabled,
            onSwitch: function (item) {
              return handleAudioFixedCeilingToggle(!item.switch);
            },
          },
          {
            name: '去磨皮修正',
            html: '去磨皮修正',
            tooltip: getVisualEnhancementLevelLabel(visualEnhancementLevel),
            selector: VISUAL_ENHANCEMENT_LEVEL_OPTIONS.map((option) => ({
              value: option.value,
              name: `visual-enhancement-${option.value}`,
              default: option.value === visualEnhancementLevel,
              html: option.label,
            })),
            onSelect: function (item) {
              return handleVisualEnhancementLevelChange(item.value);
            },
          },
          {
            name: '跳过片头片尾',
            html: '跳过片头片尾',
            switch: skipConfigRef.current.enable,
            onSwitch: function (item) {
              const newConfig = {
                ...skipConfigRef.current,
                enable: !item.switch,
              };
              handleSkipConfigChange(newConfig);
              return !item.switch;
            },
          },
          {
            html: '删除跳过配置',
            onClick: function () {
              handleSkipConfigChange({
                enable: false,
                intro_time: 0,
                outro_time: 0,
              });
              return '';
            },
          },
          {
            name: '设置片头',
            html: '设置片头',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
            tooltip:
              skipConfigRef.current.intro_time === 0
                ? '设置片头时间'
                : `${formatTime(skipConfigRef.current.intro_time)}`,
            onClick: function () {
              const currentTime = artPlayerRef.current?.currentTime || 0;
              if (currentTime > 0) {
                const newConfig = {
                  ...skipConfigRef.current,
                  intro_time: currentTime,
                };
                handleSkipConfigChange(newConfig);
                return `${formatTime(currentTime)}`;
              }
            },
          },
          {
            name: '设置片尾',
            html: '设置片尾',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
            tooltip:
              skipConfigRef.current.outro_time >= 0
                ? '设置片尾时间'
                : `-${formatTime(-skipConfigRef.current.outro_time)}`,
            onClick: function () {
              const outroTime =
                -(
                  artPlayerRef.current?.duration -
                  artPlayerRef.current?.currentTime
                ) || 0;
              if (outroTime < 0) {
                const newConfig = {
                  ...skipConfigRef.current,
                  outro_time: outroTime,
                };
                handleSkipConfigChange(newConfig);
                return `-${formatTime(-outroTime)}`;
              }
            },
          },
        ],
        // 控制栏配置
        controls: [
          {
            position: 'left',
            index: 13,
            html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
            tooltip: '播放下一集',
            click: function () {
              handleNextEpisode();
            },
          },
          ...(isDesktopPlayer ? [buildDesktopFullscreenControl()] : []),
        ],
      });
      playerSessionRef.current = {
        isOfflineMode,
        playbackType,
      };
      syncPlayerEnhancements();
      bindDesktopFullscreenState();

      removeVideoEventListeners = attachNativeVideoListeners(
        artPlayerRef.current?.video as HTMLVideoElement | null
      );

      // 监听播放器事件
      artPlayerRef.current.on('ready', () => {
        syncPlayerEnhancements();
        const video = artPlayerRef.current?.video as
          | HTMLVideoElement
          | undefined;
        if (
          !isOfflineMode &&
          video?.readyState &&
          video.readyState >= HTMLMediaElement.HAVE_METADATA
        ) {
          markVideoReady();
        }

        // 播放器就绪后，如果正在播放则请求 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
      });

      // 监听播放状态变化，控制 Wake Lock
      artPlayerRef.current.on('play', () => {
        requestWakeLock();
      });

      artPlayerRef.current.on('pause', () => {
        releaseWakeLock();
        saveCurrentPlayProgress();
      });

      artPlayerRef.current.on('video:ended', () => {
        releaseWakeLock();
      });

      // 如果播放器初始化时已经在播放状态，则请求 Wake Lock
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        requestWakeLock();
      }

      artPlayerRef.current.on('video:volumechange', () => {
        lastVolumeRef.current = artPlayerRef.current.volume;
      });
      artPlayerRef.current.on('video:ratechange', () => {
        lastPlaybackRateRef.current = artPlayerRef.current.playbackRate;
      });

      artPlayerRef.current.on('video:loadedmetadata', () => {
        syncPlayerEnhancements();
        if (!isOfflineMode) {
          markVideoReady();
        }
      });

      // 监听视频可播放事件，这时恢复播放进度更可靠
      artPlayerRef.current.on('video:canplay', () => {
        syncPlayerEnhancements();
        // 若存在需要恢复的播放进度，则跳转
        if (resumeTimeRef.current && resumeTimeRef.current > 0) {
          try {
            const duration = artPlayerRef.current.duration || 0;
            let target = resumeTimeRef.current;
            if (duration && target >= duration - 2) {
              target = Math.max(0, duration - 5);
            }
            artPlayerRef.current.currentTime = target;
            console.log('成功恢复播放进度到:', resumeTimeRef.current);
          } catch (err) {
            console.warn('恢复播放进度失败:', err);
          }
        }
        resumeTimeRef.current = null;

        setTimeout(() => {
          if (
            Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) > 0.01
          ) {
            artPlayerRef.current.volume = lastVolumeRef.current;
          }
          if (
            Math.abs(
              artPlayerRef.current.playbackRate - lastPlaybackRateRef.current
            ) > 0.01 &&
            isWebkit
          ) {
            artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
          }
          artPlayerRef.current.notice.show = '';
        }, 0);

        // 隐藏换源加载状态
        markVideoReady();
      });

      // 监听视频时间更新事件，实现跳过片头片尾
      artPlayerRef.current.on('video:timeupdate', () => {
        if (!skipConfigRef.current.enable) return;

        const currentTime = artPlayerRef.current.currentTime || 0;
        const duration = artPlayerRef.current.duration || 0;
        const now = Date.now();

        // 限制跳过检查频率为1.5秒一次
        if (now - lastSkipCheckRef.current < 1500) return;
        lastSkipCheckRef.current = now;

        // 跳过片头
        if (
          skipConfigRef.current.intro_time > 0 &&
          currentTime < skipConfigRef.current.intro_time
        ) {
          artPlayerRef.current.currentTime = skipConfigRef.current.intro_time;
          artPlayerRef.current.notice.show = `已跳过片头 (${formatTime(
            skipConfigRef.current.intro_time
          )})`;
        }

        // 跳过片尾
        if (
          skipConfigRef.current.outro_time < 0 &&
          duration > 0 &&
          currentTime >
            artPlayerRef.current.duration + skipConfigRef.current.outro_time
        ) {
          if (
            currentEpisodeIndexRef.current <
            (detailRef.current?.episodes?.length || 1) - 1
          ) {
            handleNextEpisode();
          } else {
            artPlayerRef.current.pause();
          }
          artPlayerRef.current.notice.show = `已跳过片尾 (${formatTime(
            skipConfigRef.current.outro_time
          )})`;
        }
      });

      artPlayerRef.current.on('error', (err: any) => {
        console.error('播放器错误:', err);
        const errorMessage =
          typeof err === 'string'
            ? err
            : err?.message || err?.text || err?.error?.message || null;
        if (isTransientPlaybackBootstrapError(errorMessage)) {
          markTransientPlaybackRecovery(errorMessage);
          return;
        }
        if (artPlayerRef.current.currentTime > 0) {
          return;
        }
      });

      // 监听视频播放结束事件，自动播放下一集
      artPlayerRef.current.on('video:ended', () => {
        const d = detailRef.current;
        const idx = currentEpisodeIndexRef.current;
        if (d && d.episodes && idx < d.episodes.length - 1) {
          setTimeout(() => {
            switchEpisode(idx + 1);
          }, 1000);
        }
      });

      artPlayerRef.current.on('video:timeupdate', () => {
        const now = Date.now();
        let interval = 5000;
        if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'upstash') {
          interval = 20000;
        }
        if (now - lastSaveTimeRef.current > interval) {
          saveCurrentPlayProgress();
          lastSaveTimeRef.current = now;
        }
      });

      artPlayerRef.current.on('pause', () => {
        saveCurrentPlayProgress();
      });

      if (artPlayerRef.current?.video && playbackType !== 'm3u8') {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }

      if (isOfflineMode) {
        loadingWatchdogTimer = window.setTimeout(() => {
          const video = artPlayerRef.current?.video as
            | HTMLVideoElement
            | undefined;

          if (
            video &&
            (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ||
              video.buffered.length > 0)
          ) {
            markVideoReady();
            return;
          }

          setIsVideoLoading(false);
          setError('离线视频首片段加载超时，请返回下载页重新下载');
        }, 20000);
      }
    } catch (err) {
      console.error('创建播放器失败:', err);
      setIsVideoLoading(false);
      setError('播放器初始化失败');
    }

    return () => {
      if (loadingWatchdogTimer) {
        window.clearTimeout(loadingWatchdogTimer);
      }

      removeVideoEventListeners?.();
    };
  }, [Artplayer, Hls, videoUrl, loading, blockAdEnabled, isOfflineMode]);

  useEffect(() => {
    syncPlayerEnhancements();
  }, [
    audioDynamicProtectionEnabled,
    audioFixedCeilingEnabled,
    audioSpikeProtectionLevel,
    visualEnhancementLevel,
    videoUrl,
  ]);

  // 当组件卸载时清理定时器、Wake Lock 和播放器资源
  useEffect(() => {
    return () => {
      // 清理定时器
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }

      // 释放 Wake Lock
      releaseWakeLock();

      // 销毁播放器实例
      cleanupPlayer();
    };
  }, []);

  if (loading) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 动画影院图标 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>
                  {loadingStage === 'searching' && '🔍'}
                  {loadingStage === 'preferring' && '⚡'}
                  {loadingStage === 'fetching' && '🎬'}
                  {loadingStage === 'ready' && '✨'}
                </div>
                {/* 旋转光环 */}
                <div className='absolute -inset-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
              </div>

              {/* 浮动粒子效果 */}
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            {/* 进度指示器 */}
            <div className='mb-6 w-80 mx-auto'>
              <div className='flex justify-center space-x-2 mb-4'>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'searching' || loadingStage === 'fetching'
                      ? 'bg-green-500 scale-125'
                      : loadingStage === 'preferring' ||
                        loadingStage === 'ready'
                      ? 'bg-green-500'
                      : 'bg-gray-300'
                  }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'preferring'
                      ? 'bg-green-500 scale-125'
                      : loadingStage === 'ready'
                      ? 'bg-green-500'
                      : 'bg-gray-300'
                  }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'ready'
                      ? 'bg-green-500 scale-125'
                      : 'bg-gray-300'
                  }`}
                ></div>
              </div>

              {/* 进度条 */}
              <div className='w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden'>
                <div
                  className='h-full bg-gradient-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-1000 ease-out'
                  style={{
                    width:
                      loadingStage === 'searching' ||
                      loadingStage === 'fetching'
                        ? '33%'
                        : loadingStage === 'preferring'
                        ? '66%'
                        : '100%',
                  }}
                ></div>
              </div>
            </div>

            {/* 加载消息 */}
            <div className='space-y-2'>
              <p className='text-xl font-semibold text-gray-800 dark:text-gray-200 animate-pulse'>
                {loadingMessage}
              </p>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (blockingError) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 错误图标 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>😵</div>
                {/* 脉冲效果 */}
                <div className='absolute -inset-2 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl opacity-20 animate-pulse'></div>
              </div>

              {/* 浮动错误粒子 */}
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-red-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-yellow-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            {/* 错误信息 */}
            <div className='space-y-4 mb-8'>
              <h2 className='text-2xl font-bold text-gray-800 dark:text-gray-200'>
                哎呀，出现了一些问题
              </h2>
              <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4'>
                <p className='text-red-600 dark:text-red-400 font-medium'>
                  {blockingError}
                </p>
              </div>
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                请检查网络连接或尝试刷新页面
              </p>
            </div>

            {/* 操作按钮 */}
            <div className='space-y-3'>
              <button
                onClick={() =>
                  videoTitle
                    ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                    : router.back()
                }
                className='w-full px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:from-green-600 hover:to-emerald-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl'
              >
                {videoTitle ? '🔍 返回搜索' : '← 返回上页'}
              </button>

              <button
                onClick={() => window.location.reload()}
                className='w-full px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200'
              >
                🔄 重新尝试
              </button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  const resolvedVideoTitle = videoTitle || '影片标题';
  const currentEpisodeLabel =
    totalEpisodes > 1
      ? detail?.episodes_titles?.[currentEpisodeIndex] ||
        `第 ${currentEpisodeIndex + 1} 集`
      : '';
  const canShowPlaybackInfoControl =
    !!detail &&
    detail.episodes.length > 0 &&
    currentEpisodeIndex >= 0 &&
    currentEpisodeIndex < detail.episodes.length;
  const followNewEpisodeRange = getNewEpisodeRange(followRecord);
  const playbackInfoSearchTitle =
    offlineContent?.searchTitle || searchTitle || resolvedVideoTitle;
  const playbackInfoSearchType = offlineContent?.searchType || searchType;

  return (
    <PageLayout activePath='/play'>
      <div className='flex flex-col gap-4 py-4 px-5 lg:px-[3rem] 2xl:px-20'>
        <div
          className={`grid gap-4 transition-all duration-300 ease-in-out ${
            isEpisodeSelectorCollapsed
              ? 'grid-cols-1'
              : 'grid-cols-1 md:grid-cols-4'
          }`}
        >
          {/* 播放器 */}
          <div
            className={`transition-all duration-300 ease-in-out rounded-xl border border-white/0 dark:border-white/30 ${
              isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
            }`}
          >
            <div className='relative h-[300px] w-full lg:h-[500px] xl:h-[650px] 2xl:h-[750px]'>
              <div
                ref={artRef}
                className='relative h-full w-full overflow-hidden rounded-xl bg-black shadow-lg'
              ></div>
              <PlayerEnhancementStatusOverlay status={audioEnhancementStatus} />

              {/* 换源加载蒙层 */}
              {isVideoLoading && (
                <div className='absolute inset-0 z-[500] flex items-center justify-center rounded-xl bg-black/85 backdrop-blur-sm transition-all duration-300'>
                  <div className='mx-auto max-w-md px-6 text-center'>
                    {/* 动画影院图标 */}
                    <div className='relative mb-8'>
                      <div className='relative mx-auto flex h-24 w-24 transform items-center justify-center rounded-2xl bg-gradient-to-r from-green-500 to-emerald-600 shadow-2xl transition-transform duration-300 hover:scale-105'>
                        <div className='text-4xl text-white'>🎬</div>
                        {/* 旋转光环 */}
                        <div className='absolute -inset-2 animate-spin rounded-2xl bg-gradient-to-r from-green-500 to-emerald-600 opacity-20'></div>
                      </div>

                      {/* 浮动粒子效果 */}
                      <div className='pointer-events-none absolute left-0 top-0 h-full w-full'>
                        <div className='absolute left-2 top-2 h-2 w-2 animate-bounce rounded-full bg-green-400'></div>
                        <div
                          className='absolute right-4 top-4 h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400'
                          style={{ animationDelay: '0.5s' }}
                        ></div>
                        <div
                          className='absolute bottom-3 left-6 h-1 w-1 animate-bounce rounded-full bg-lime-400'
                          style={{ animationDelay: '1s' }}
                        ></div>
                      </div>
                    </div>

                    {/* 换源消息 */}
                    <div className='space-y-2'>
                      <p className='animate-pulse text-xl font-semibold text-white'>
                        {videoLoadingStage === 'sourceChanging'
                          ? '🔄 切换播放源...'
                          : '🔄 视频加载中...'}
                      </p>
                      <p className='text-sm text-white/70'>
                        {playerLoadingDetailMessage}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 选集和换源 - 在移动端始终显示，在 lg 及以上可折叠 */}
          <div
            className={`h-[300px] md:overflow-hidden transition-all duration-300 ease-in-out lg:h-[500px] xl:h-[650px] 2xl:h-[750px] ${
              isEpisodeSelectorCollapsed
                ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                : 'md:col-span-1 lg:opacity-100 lg:scale-100'
            }`}
          >
            <EpisodeSelector
              totalEpisodes={totalEpisodes}
              episodes_titles={detail?.episodes_titles || []}
              value={currentEpisodeIndex + 1}
              onChange={handleEpisodeChange}
              onSourceChange={isOfflineMode ? undefined : handleSourceChange}
              currentSource={currentSource}
              currentId={currentId}
              videoTitle={searchTitle || videoTitle}
              availableSources={isOfflineMode ? [] : availableSources}
              sourceSearchLoading={sourceSearchLoading}
              sourceSearchError={sourceSearchError}
              precomputedVideoInfo={precomputedVideoInfo}
              sourceSwitchEnabled={!isOfflineMode}
              episodeTabLabel={
                shouldShowOfflineAdultRelatedVideos ? '相关视频' : '选集'
              }
              episodeListVariant={
                shouldShowOfflineAdultRelatedVideos
                  ? 'related-videos'
                  : 'episodes'
              }
              relatedVideos={offlineAdultRelatedVideos}
              relatedVideosEmptyText='暂无可直接播放的相关离线视频'
              onRelatedVideoSelect={
                shouldShowOfflineAdultRelatedVideos
                  ? (contentId) => handleOfflineRelatedVideoSelect(contentId)
                  : undefined
              }
              episodeHeaderActionLabel={
                shouldShowOfflineAdultRelatedVideos ? '更多' : undefined
              }
              onEpisodeHeaderAction={
                shouldShowOfflineAdultRelatedVideos
                  ? handleOpenOfflineSameTitleDialog
                  : undefined
              }
              episodeHeaderActionDisabled={
                shouldShowOfflineAdultRelatedVideos &&
                offlineSameTitleVideos.length === 0
              }
              episodeHeaderActionTitle='查看同名的其他离线视频'
              newEpisodeStart={followNewEpisodeRange?.start}
              newEpisodeEnd={followNewEpisodeRange?.end}
            />
          </div>

          <div
            className={`${
              isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
            }`}
          >
            <div className='rounded-2xl border border-gray-200/50 bg-white/75 px-4 py-3 shadow-sm backdrop-blur-sm dark:border-gray-700/50 dark:bg-gray-900/75'>
              <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
                <div className='min-w-0 flex-1'>
                  <div className='flex items-start gap-3'>
                    <h1 className='min-w-0 flex-1 text-lg font-semibold leading-snug text-gray-900 dark:text-gray-100 sm:text-xl'>
                      {resolvedVideoTitle}
                    </h1>
                    <button
                      type='button'
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleToggleFavorite();
                      }}
                      aria-label={favorited ? '取消收藏' : '添加收藏'}
                      className='mt-0.5 flex-shrink-0 rounded-full p-1 text-gray-600 transition-opacity hover:opacity-80 dark:text-gray-300'
                    >
                      <FavoriteIcon filled={favorited} />
                    </button>
                  </div>

                  {currentEpisodeLabel ? (
                    <div className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                      {currentEpisodeLabel}
                    </div>
                  ) : null}
                </div>

                <div className='flex shrink-0 items-center gap-2 self-end sm:self-start'>
                  {canShowPlaybackInfoControl && detail ? (
                    <CurrentEpisodeDownloadControl
                      detail={detail}
                      availableSources={isOfflineMode ? [] : availableSources}
                      episodeIndex={currentEpisodeIndex}
                      downloadEpisodeIndex={
                        isOfflineMode
                          ? offlineEpisodeEntries[currentEpisodeIndex]
                              ?.episodeIndex ?? currentEpisodeIndex
                          : currentEpisodeIndex
                      }
                      isOfflineMode={isOfflineMode}
                      compact
                      searchTitle={playbackInfoSearchTitle}
                      searchType={playbackInfoSearchType || undefined}
                    />
                  ) : null}

                  <button
                    onClick={() =>
                      setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
                    }
                    className='group relative hidden lg:flex items-center space-x-1.5 rounded-full border border-gray-200/50 bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-white hover:shadow-md dark:border-gray-700/50 dark:bg-gray-800/80 dark:hover:bg-gray-800'
                    title={
                      isEpisodeSelectorCollapsed
                        ? '显示选集面板'
                        : '隐藏选集面板'
                    }
                  >
                    <svg
                      className={`h-3.5 w-3.5 text-gray-500 transition-transform duration-200 dark:text-gray-400 ${
                        isEpisodeSelectorCollapsed ? 'rotate-180' : 'rotate-0'
                      }`}
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth='2'
                        d='M9 5l7 7-7 7'
                      />
                    </svg>
                    <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                      {isEpisodeSelectorCollapsed ? '显示' : '隐藏'}
                    </span>

                    <div
                      className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full transition-all duration-200 ${
                        isEpisodeSelectorCollapsed
                          ? 'animate-pulse bg-orange-400'
                          : 'bg-green-400'
                      }`}
                    ></div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 详情展示 */}
        <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
          {/* 文字区 */}
          <div className='md:col-span-3'>
            <div className='p-6 flex flex-col min-h-0'>
              {/* 关键信息行 */}
              <div className='mb-4 flex flex-wrap items-center gap-3 text-base opacity-80 flex-shrink-0'>
                {detail?.class && (
                  <span className='text-green-600 font-semibold'>
                    {detail.class}
                  </span>
                )}
                {(detail?.year || videoYear) && (
                  <span>{detail?.year || videoYear}</span>
                )}
                {detail?.source_name && (
                  <span className='border border-gray-500/60 px-2 py-[1px] rounded'>
                    {detail.source_name}
                  </span>
                )}
                {detail?.type_name && <span>{detail.type_name}</span>}
              </div>
              {/* 剧情简介 */}
              {detail?.desc && (
                <div
                  className='mt-0 text-base leading-relaxed opacity-90 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide'
                  style={{ whiteSpace: 'pre-line' }}
                >
                  {detail.desc}
                </div>
              )}
            </div>
          </div>

          {/* 封面展示 */}
          <div className='hidden md:block md:col-span-1 md:order-first'>
            <div className='pl-0 py-4 pr-6'>
              <div className='relative bg-gray-300 dark:bg-gray-700 aspect-[2/3] flex items-center justify-center rounded-xl overflow-hidden'>
                {videoCover ? (
                  <>
                    <img
                      src={processImageUrl(videoCover)}
                      alt={videoTitle}
                      className='w-full h-full object-cover'
                    />

                    {/* 豆瓣链接按钮 */}
                    {videoDoubanId !== 0 && (
                      <a
                        href={`https://movie.douban.com/subject/${videoDoubanId.toString()}`}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='absolute top-3 left-3'
                      >
                        <div className='bg-green-500 text-white text-xs font-bold w-8 h-8 rounded-full flex items-center justify-center shadow-md hover:bg-green-600 hover:scale-[1.1] transition-all duration-300 ease-out'>
                          <svg
                            width='16'
                            height='16'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                          >
                            <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'></path>
                            <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'></path>
                          </svg>
                        </div>
                      </a>
                    )}
                  </>
                ) : (
                  <span className='text-gray-600 dark:text-gray-400'>
                    封面图片
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isOfflineSameTitleDialogOpen ? (
        <div
          className='fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm'
          onClick={() => setIsOfflineSameTitleDialogOpen(false)}
        >
          <div
            className='w-full max-w-3xl overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0b0b] shadow-2xl'
            onClick={(event) => event.stopPropagation()}
          >
            <div className='flex items-center justify-between border-b border-white/10 px-6 py-5'>
              <div className='space-y-1'>
                <h2 className='text-xl font-semibold text-white'>
                  同名离线视频
                </h2>
                <p className='text-sm text-gray-400'>
                  {offlineSameTitleVideos.length > 0
                    ? `共 ${offlineSameTitleVideos.length} 部同名离线资源，点击即可直接播放。`
                    : '当前没有其他同名离线视频。'}
                </p>
              </div>
              <button
                type='button'
                onClick={() => setIsOfflineSameTitleDialogOpen(false)}
                className='inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg text-gray-300 transition-colors hover:bg-white/10 hover:text-white'
                aria-label='关闭同名离线视频弹窗'
              >
                ×
              </button>
            </div>

            <div className='max-h-[70vh] overflow-y-auto px-6 py-5'>
              {offlineSameTitleVideos.length === 0 ? (
                <div className='rounded-2xl border border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-gray-400'>
                  暂无可播放的同名离线视频
                </div>
              ) : (
                <div className='grid gap-4 md:grid-cols-2'>
                  {offlineSameTitleVideos.map((video) => (
                    <button
                      key={`${video.contentId}-same-title`}
                      type='button'
                      onClick={() =>
                        handleOfflineSameTitleVideoSelect(video.contentId)
                      }
                      className='w-full rounded-2xl border border-white/10 bg-black/20 p-4 text-left transition-colors hover:border-emerald-400/40 hover:bg-white/5'
                    >
                      <div className='flex items-start gap-4'>
                        <div className='h-24 w-16 flex-shrink-0 overflow-hidden rounded-2xl bg-gray-200 dark:bg-white/10'>
                          {video.poster ? (
                            <img
                              src={processImageUrl(video.poster)}
                              alt={video.title}
                              className='h-full w-full object-cover'
                              onError={(event) => {
                                const target = event.target as HTMLImageElement;
                                target.style.display = 'none';
                              }}
                            />
                          ) : null}
                        </div>

                        <div className='min-w-0 flex-1 space-y-3'>
                          <div className='line-clamp-2 text-base font-semibold leading-6 text-white'>
                            {video.title}
                          </div>

                          <div className='flex flex-wrap items-center gap-2 text-xs text-gray-400'>
                            <span className='rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-gray-200'>
                              {video.sourceName}
                            </span>
                            {video.year && video.year !== 'unknown' ? (
                              <span>{video.year}</span>
                            ) : null}
                            <span>
                              {video.episodeCount > 1
                                ? `${video.episodeCount} 集`
                                : '单集'}
                            </span>
                          </div>

                          <div className='text-sm font-medium text-emerald-400'>
                            点击直接播放
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </PageLayout>
  );
}

// FavoriteIcon 组件
const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-7 w-7'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='#ef4444' /* Tailwind red-500 */
          stroke='#ef4444'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-7 w-7 stroke-[1] text-gray-600 dark:text-gray-300' />
  );
};

export default function PlayPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayPageClient />
    </Suspense>
  );
}
