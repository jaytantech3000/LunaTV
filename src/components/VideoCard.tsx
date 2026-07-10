/* eslint-disable @typescript-eslint/no-explicit-any,react-hooks/exhaustive-deps,@typescript-eslint/no-empty-function */

import {
  Bell,
  BellOff,
  Download,
  ExternalLink,
  Heart,
  Link,
  Loader2,
  Play,
  Radio,
  Trash2,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { createPortal } from 'react-dom';

import { getOfflineDownloadSupportState } from '@/lib/download/cache';
import { resolveDownloadablePlaybackSources } from '@/lib/download/downloadable';
import {
  canManageFollowUpdates,
  disableFollowUpdatesWithFeedback,
  enableFollowUpdatesWithFeedback,
  hasNewEpisodes,
  isDesktopFollowUpdatesEnabled,
} from '@/lib/follow-updates';
import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  getCachedFollowRecordsSnapshot,
  getFollowRecord,
  isFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/profile/client';
import { FollowRecord, SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';
import { isAdultContentResult, isAdultSourceCandidate } from '@/lib/yellow';
import { useLongPress } from '@/hooks/useLongPress';

import BatchEpisodeDownloadDialog from '@/components/BatchEpisodeDownloadDialog';
import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import MobileActionSheet from '@/components/MobileActionSheet';
import { useNavigationFeedback } from '@/components/NavigationFeedbackProvider';

export interface VideoCardProps {
  id?: string;
  source?: string;
  title?: string;
  query?: string;
  poster?: string;
  episodes?: number;
  source_name?: string;
  source_names?: string[];
  progress?: number;
  year?: string;
  from: 'playrecord' | 'favorite' | 'search' | 'douban';
  currentEpisode?: number;
  douban_id?: number;
  onDelete?: () => void;
  rate?: string;
  type?: string;
  isBangumi?: boolean;
  isAggregate?: boolean;
  playbackMode?: 'online' | 'offline';
  offlineContentId?: string;
  origin?: 'vod' | 'live';
}

export type VideoCardHandle = {
  setEpisodes: (episodes?: number) => void;
  setSourceNames: (names?: string[]) => void;
  setDoubanId: (id?: number) => void;
};

interface ResolvedFollowTarget {
  source: string;
  id: string;
  title: string;
  sourceName: string;
  year: string;
  cover: string;
  episodes: number;
}

function emitFollowUpdatesError(message: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent('globalError', {
      detail: { message },
    })
  );
}

function getVideoTypeLabel(
  type?: string,
  episodes?: number,
  origin: 'vod' | 'live' = 'vod'
): string | null {
  if (origin === 'live') {
    return '直播';
  }

  switch (type) {
    case 'movie':
      return '电影';
    case 'tv':
      return '剧集';
    case 'anime':
      return '动漫';
    case 'show':
      return '综艺';
    default:
      if (typeof episodes === 'number' && episodes > 1) {
        return '剧集';
      }

      return null;
  }
}

const VideoCard = forwardRef<VideoCardHandle, VideoCardProps>(
  function VideoCard(
    {
      id,
      title = '',
      query = '',
      poster = '',
      episodes,
      progress,
      source,
      source_name,
      source_names,
      year,
      from,
      currentEpisode,
      douban_id,
      onDelete,
      rate,
      type = '',
      isBangumi = false,
      isAggregate = false,
      playbackMode,
      offlineContentId,
      origin = 'vod',
    }: VideoCardProps,
    ref
  ) {
    const router = useRouter();
    const { beginNavigation } = useNavigationFeedback();
    const [favorited, setFavorited] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isNavigating, setIsNavigating] = useState(false);
    const [showMobileActions, setShowMobileActions] = useState(false);
    const [searchFavorited, setSearchFavorited] = useState<boolean | null>(
      null
    ); // 搜索结果的收藏状态
    const [followRecord, setFollowRecord] = useState<FollowRecord | null>(null);
    const [isFollowLoading, setIsFollowLoading] = useState(false);
    const [resolvedFollowTarget, setResolvedFollowTarget] =
      useState<ResolvedFollowTarget | null>(null);
    const [downloadDialogDetail, setDownloadDialogDetail] =
      useState<SearchResult | null>(null);
    const [downloadDialogAvailableSources, setDownloadDialogAvailableSources] =
      useState<SearchResult[]>([]);
    const [downloadDialogError, setDownloadDialogError] = useState<
      string | null
    >(null);
    const [downloadDialogFeedback, setDownloadDialogFeedback] = useState<
      string | null
    >(null);
    const [isDownloadDialogLoading, setIsDownloadDialogLoading] =
      useState(false);
    const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);

    // 可外部修改的可控字段
    const [dynamicEpisodes, setDynamicEpisodes] = useState<number | undefined>(
      episodes
    );
    const [dynamicSourceNames, setDynamicSourceNames] = useState<
      string[] | undefined
    >(source_names);
    const [dynamicDoubanId, setDynamicDoubanId] = useState<number | undefined>(
      douban_id
    );

    useEffect(() => {
      setDynamicEpisodes(episodes);
    }, [episodes]);

    useEffect(() => {
      setDynamicSourceNames(source_names);
    }, [source_names]);

    useEffect(() => {
      setDynamicDoubanId(douban_id);
    }, [douban_id]);

    useEffect(() => {
      if (!downloadDialogFeedback) {
        return;
      }

      const timeoutId = window.setTimeout(() => {
        setDownloadDialogFeedback(null);
      }, 2800);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }, [downloadDialogFeedback]);

    useImperativeHandle(ref, () => ({
      setEpisodes: (eps?: number) => setDynamicEpisodes(eps),
      setSourceNames: (names?: string[]) => setDynamicSourceNames(names),
      setDoubanId: (id?: number) => setDynamicDoubanId(id),
    }));

    const actualTitle = title;
    const actualPoster = poster;
    const actualSource = source;
    const actualId = id;
    const actualDoubanId = dynamicDoubanId;
    const actualEpisodes = dynamicEpisodes;
    const actualYear = year;
    const actualQuery = query || '';
    const actualSearchType = isAggregate
      ? actualEpisodes && actualEpisodes === 1
        ? 'movie'
        : 'tv'
      : type;
    const followLookupSource = resolvedFollowTarget?.source || actualSource;
    const followLookupId = resolvedFollowTarget?.id || actualId;
    const hasStableFollowLookupKey = Boolean(
      followLookupSource && followLookupId
    );
    const effectivePlaybackMode =
      origin === 'vod' ? playbackMode || 'online' : undefined;
    const shouldAllowAdultPlayback = useMemo(() => {
      if (origin !== 'vod') {
        return false;
      }

      const sourceNameTokens = [source_name, ...(dynamicSourceNames || [])]
        .filter(Boolean)
        .join(' ');

      if (
        isAdultSourceCandidate({
          name: sourceNameTokens,
          key: actualSource,
        })
      ) {
        return true;
      }

      return isAdultContentResult({
        title: actualTitle,
        source_name: sourceNameTokens,
      });
    }, [actualSource, actualTitle, dynamicSourceNames, origin, source_name]);

    useEffect(() => {
      if (actualSource && actualId) {
        setResolvedFollowTarget({
          source: actualSource,
          id: actualId,
          title: actualTitle,
          sourceName: source_name || '',
          year: actualYear || '',
          cover: actualPoster,
          episodes: Math.max(1, actualEpisodes ?? 1),
        });
        return;
      }

      setResolvedFollowTarget(null);
    }, [
      actualId,
      actualEpisodes,
      actualPoster,
      actualSource,
      actualTitle,
      actualYear,
      source_name,
    ]);

    useEffect(() => {
      setDownloadDialogDetail(null);
      setDownloadDialogAvailableSources([]);
      setDownloadDialogError(null);
      setDownloadDialogFeedback(null);
      setIsDownloadDialogLoading(false);
      setIsDownloadDialogOpen(false);
    }, [
      douban_id,
      episodes,
      id,
      query,
      shouldAllowAdultPlayback,
      source,
      title,
      type,
      year,
    ]);

    const destinationUrl = useMemo(() => {
      const doubanIdParam =
        actualDoubanId && actualDoubanId > 0
          ? `&doubanId=${actualDoubanId}`
          : '';
      const adultParam = shouldAllowAdultPlayback ? '&adult=1' : '';

      if (origin === 'live' && actualSource && actualId) {
        return `/live?source=${actualSource.replace(
          'live_',
          ''
        )}&id=${actualId.replace('live_', '')}`;
      }

      if (from === 'douban' || (isAggregate && !actualSource && !actualId)) {
        return `/play?title=${encodeURIComponent(actualTitle.trim())}${
          actualYear ? `&year=${actualYear}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}${
          isAggregate ? '&prefer=true' : ''
        }${
          actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
        }${doubanIdParam}${adultParam}`;
      }

      if (actualSource && actualId) {
        if (effectivePlaybackMode === 'offline' && offlineContentId) {
          const searchParams = new URLSearchParams({
            offline: '1',
            contentId: offlineContentId,
            source: actualSource,
            id: actualId,
            title: actualTitle,
            year: actualYear || '',
            episode: String(Math.max(1, currentEpisode || 1)),
          });

          return `/play?${searchParams.toString()}`;
        }

        return `/play?source=${actualSource}&id=${actualId}&title=${encodeURIComponent(
          actualTitle
        )}${actualYear ? `&year=${actualYear}` : ''}${
          isAggregate ? '&prefer=true' : ''
        }${
          actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
        }${
          actualSearchType ? `&stype=${actualSearchType}` : ''
        }${doubanIdParam}${adultParam}`;
      }

      return null;
    }, [
      actualDoubanId,
      actualId,
      actualQuery,
      actualSearchType,
      actualSource,
      actualTitle,
      actualYear,
      currentEpisode,
      effectivePlaybackMode,
      from,
      isAggregate,
      offlineContentId,
      origin,
      shouldAllowAdultPlayback,
    ]);

    const prefetchDestination = useCallback(() => {
      if (!destinationUrl) {
        return;
      }

      router.prefetch(destinationUrl);
    }, [destinationUrl, router]);

    const beginCardNavigation = useCallback(() => {
      if (!destinationUrl) {
        return;
      }

      flushSync(() => {
        setIsNavigating(true);
        beginNavigation({
          href: destinationUrl,
          kind: 'card',
          label: actualTitle.trim() || (origin === 'live' ? '直播' : '视频'),
        });
      });
      prefetchDestination();
    }, [
      actualTitle,
      beginNavigation,
      destinationUrl,
      origin,
      prefetchDestination,
    ]);

    const pushDestinationWithPaint = useCallback(() => {
      if (!destinationUrl) {
        return;
      }

      window.setTimeout(() => {
        router.push(destinationUrl);
      }, 0);
    }, [destinationUrl, router]);

    useEffect(() => {
      setIsNavigating(false);
    }, [destinationUrl]);

    useEffect(() => {
      if (!isNavigating) {
        return;
      }

      const timeoutId = window.setTimeout(() => {
        setIsNavigating(false);
      }, 8000);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }, [isNavigating]);

    // 获取收藏状态（搜索结果页面不检查）
    useEffect(() => {
      if (from === 'douban' || from === 'search' || !actualSource || !actualId)
        return;

      const fetchFavoriteStatus = async () => {
        try {
          const fav = await isFavorited(actualSource, actualId);
          setFavorited(fav);
        } catch (err) {
          throw new Error('检查收藏状态失败');
        }
      };

      fetchFavoriteStatus();

      // 监听收藏状态更新事件
      const storageKey = generateStorageKey(actualSource, actualId);
      const unsubscribe = subscribeToDataUpdates(
        'favoritesUpdated',
        (newFavorites: Record<string, any>) => {
          // 检查当前项目是否在新的收藏列表中
          const isNowFavorited = !!newFavorites[storageKey];
          setFavorited(isNowFavorited);
        }
      );

      return unsubscribe;
    }, [from, actualSource, actualId]);

    useEffect(() => {
      if (from !== 'douban' && !(from === 'search' && isAggregate)) {
        return;
      }

      if (!followLookupSource || !followLookupId) {
        if (from === 'search') {
          setSearchFavorited(null);
        } else {
          setFavorited(false);
        }
        return;
      }

      let active = true;
      const applyFavoriteState = (nextFavorited: boolean) => {
        if (!active) {
          return;
        }

        if (from === 'search') {
          setSearchFavorited(nextFavorited);
          return;
        }

        setFavorited(nextFavorited);
      };

      const fetchFavoriteStatus = async () => {
        try {
          const fav = await isFavorited(followLookupSource, followLookupId);
          applyFavoriteState(fav);
        } catch {
          applyFavoriteState(false);
        }
      };

      void fetchFavoriteStatus();

      const storageKey = generateStorageKey(followLookupSource, followLookupId);
      const unsubscribe = subscribeToDataUpdates<Record<string, unknown>>(
        'favoritesUpdated',
        (newFavorites) => {
          applyFavoriteState(Boolean(newFavorites[storageKey]));
        }
      );

      return () => {
        active = false;
        unsubscribe();
      };
    }, [
      actualId,
      actualSource,
      followLookupId,
      followLookupSource,
      from,
      isAggregate,
    ]);

    useEffect(() => {
      const canFollow =
        isDesktopFollowUpdatesEnabled() &&
        canManageFollowUpdates({
          source: actualSource,
          id: actualId,
          title: actualTitle,
          origin,
          from,
          isAggregate,
        });

      if (!canFollow || !hasStableFollowLookupKey) {
        setFollowRecord(null);
        return;
      }

      let active = true;
      const followSource = followLookupSource;
      const followId = followLookupId;

      if (!followSource || !followId) {
        setFollowRecord(null);
        return;
      }

      const storageKey = generateStorageKey(followSource, followId);
      const snapshot = getCachedFollowRecordsSnapshot();

      if (snapshot) {
        setFollowRecord(snapshot[storageKey] || null);
      }

      const fetchFollowStatus = async () => {
        try {
          const follow = await getFollowRecord(followSource, followId);
          if (active) {
            setFollowRecord(follow);
          }
        } catch {
          if (active) {
            setFollowRecord(null);
          }
        }
      };

      void fetchFollowStatus();

      const unsubscribe = subscribeToDataUpdates<Record<string, FollowRecord>>(
        'followRecordsUpdated',
        (newFollows) => {
          setFollowRecord(newFollows[storageKey] || null);
        }
      );

      return () => {
        active = false;
        unsubscribe();
      };
    }, [
      actualId,
      actualSource,
      actualTitle,
      followLookupId,
      followLookupSource,
      from,
      hasStableFollowLookupKey,
      isAggregate,
      origin,
    ]);

    const resolveFollowTarget = useCallback(async () => {
      if (resolvedFollowTarget) {
        return resolvedFollowTarget;
      }

      if (actualSource && actualId) {
        const stableTarget = {
          source: actualSource,
          id: actualId,
          title: actualTitle,
          sourceName: source_name || '',
          year: actualYear || '',
          cover: actualPoster,
          episodes: Math.max(1, actualEpisodes ?? 1),
        } satisfies ResolvedFollowTarget;
        setResolvedFollowTarget(stableTarget);
        return stableTarget;
      }

      if (!actualTitle.trim()) {
        throw new Error('当前卡片缺少可用标题，暂时无法开启追更');
      }

      const { detail } = await resolveDownloadablePlaybackSources({
        title: actualTitle.trim(),
        year: actualYear || undefined,
        searchType: actualSearchType || undefined,
        query: actualQuery || undefined,
        doubanId: actualDoubanId,
        allowAdultCandidates: shouldAllowAdultPlayback,
      });

      if (!detail.source || !detail.id) {
        throw new Error('当前卡片暂时无法定位到可追更片源');
      }

      const resolvedTarget = {
        source: detail.source,
        id: detail.id,
        title: detail.title || actualTitle,
        sourceName: detail.source_name || source_name || '',
        year: detail.year || actualYear || '',
        cover: detail.poster || actualPoster,
        episodes: Math.max(1, detail.episodes?.length || actualEpisodes || 1),
      } satisfies ResolvedFollowTarget;

      setResolvedFollowTarget(resolvedTarget);
      return resolvedTarget;
    }, [
      actualDoubanId,
      actualId,
      actualEpisodes,
      actualPoster,
      actualQuery,
      resolvedFollowTarget,
      actualSearchType,
      actualSource,
      actualTitle,
      actualYear,
      shouldAllowAdultPlayback,
      source_name,
    ]);

    const handleToggleFavorite = useCallback(
      async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (
          !actualSource &&
          !actualId &&
          (origin !== 'vod' || !actualTitle.trim())
        ) {
          return;
        }

        let favoriteTarget: ResolvedFollowTarget;

        try {
          favoriteTarget = await resolveFollowTarget();
        } catch (error) {
          emitFollowUpdatesError(
            error instanceof Error ? error.message : '当前卡片暂时无法收藏'
          );
          return;
        }

        try {
          // 确定当前收藏状态
          const currentFavorited =
            from === 'search' ? searchFavorited : favorited;

          if (currentFavorited) {
            // 如果已收藏，删除收藏
            await deleteFavorite(favoriteTarget.source, favoriteTarget.id);
            if (from === 'search') {
              setSearchFavorited(false);
            } else {
              setFavorited(false);
            }
          } else {
            // 如果未收藏，添加收藏
            await saveFavorite(favoriteTarget.source, favoriteTarget.id, {
              title: favoriteTarget.title,
              source_name: favoriteTarget.sourceName,
              year: favoriteTarget.year || '',
              cover: favoriteTarget.cover || '',
              total_episodes: favoriteTarget.episodes,
              save_time: Date.now(),
              search_title: actualQuery || actualTitle,
              playback_mode: origin === 'vod' ? 'online' : undefined,
              is_adult: origin === 'vod' ? shouldAllowAdultPlayback : undefined,
              origin,
            });
            if (from === 'search') {
              setSearchFavorited(true);
            } else {
              setFavorited(true);
            }
          }
        } catch (err) {
          throw new Error('切换收藏状态失败');
        }
      },
      [
        actualId,
        actualQuery,
        actualSource,
        actualTitle,
        favorited,
        from,
        origin,
        resolveFollowTarget,
        searchFavorited,
        shouldAllowAdultPlayback,
      ]
    );

    const handleDeleteRecord = useCallback(
      async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (from !== 'playrecord' || !actualSource || !actualId) return;
        try {
          await deletePlayRecord(actualSource, actualId);
          onDelete?.();
        } catch (err) {
          throw new Error('删除播放记录失败');
        }
      },
      [from, actualSource, actualId, onDelete]
    );

    const handleToggleFollowUpdates = useCallback(async () => {
      const canFollow =
        isDesktopFollowUpdatesEnabled() &&
        canManageFollowUpdates({
          source: actualSource,
          id: actualId,
          title: actualTitle,
          origin,
          from,
          isAggregate,
        });

      if (!canFollow) {
        return;
      }

      let followTarget: ResolvedFollowTarget;

      try {
        followTarget = await resolveFollowTarget();
      } catch (error) {
        emitFollowUpdatesError(
          error instanceof Error ? error.message : '当前卡片暂时无法开启追更'
        );
        return;
      }

      try {
        setIsFollowLoading(true);

        if (followRecord) {
          await disableFollowUpdatesWithFeedback(
            followTarget.source,
            followTarget.id
          );
          setFollowRecord(null);
          return;
        }

        const nextFollowRecord = await enableFollowUpdatesWithFeedback({
          source: followTarget.source,
          id: followTarget.id,
          title: followTarget.title,
          sourceName: followTarget.sourceName,
          year: followTarget.year || undefined,
          cover: followTarget.cover || undefined,
          searchTitle: actualQuery || actualTitle,
        });
        setFollowRecord(nextFollowRecord);
      } catch {
        // 具体失败提示由 follow-updates helper 统一发到全局错误提示。
      } finally {
        setIsFollowLoading(false);
      }
    }, [
      actualId,
      actualQuery,
      actualSource,
      actualTitle,
      origin,
      from,
      isAggregate,
      followRecord,
      resolveFollowTarget,
    ]);

    const handleClick = useCallback(() => {
      if (!destinationUrl || isNavigating) {
        return;
      }

      beginCardNavigation();
      pushDestinationWithPaint();
    }, [
      beginCardNavigation,
      destinationUrl,
      isNavigating,
      pushDestinationWithPaint,
    ]);

    // 新标签页播放处理函数
    const handlePlayInNewTab = useCallback(() => {
      if (!destinationUrl) {
        return;
      }

      prefetchDestination();
      window.open(destinationUrl, '_blank');
    }, [destinationUrl, prefetchDestination]);

    // 检查搜索结果的收藏状态
    const checkSearchFavoriteStatus = useCallback(async () => {
      if (
        from === 'search' &&
        !isAggregate &&
        actualSource &&
        actualId &&
        searchFavorited === null
      ) {
        try {
          const fav = await isFavorited(actualSource, actualId);
          setSearchFavorited(fav);
        } catch (err) {
          setSearchFavorited(false);
        }
      }
    }, [from, isAggregate, actualSource, actualId, searchFavorited]);

    const handleOpenDownloadDialog = useCallback(async () => {
      if (origin !== 'vod') {
        return;
      }

      const supportState = getOfflineDownloadSupportState();
      if (!supportState.supported) {
        setDownloadDialogError(supportState.reason || '当前环境不支持离线下载');
        return;
      }

      if (downloadDialogDetail) {
        setDownloadDialogError(null);
        setDownloadDialogFeedback(null);
        setIsDownloadDialogOpen(true);
        return;
      }

      try {
        setDownloadDialogError(null);
        setDownloadDialogFeedback(null);
        setIsDownloadDialogLoading(true);

        const { detail, availableSources } =
          await resolveDownloadablePlaybackSources({
            source: actualSource,
            id: actualId,
            title: actualTitle.trim(),
            year: actualYear || undefined,
            searchType: actualSearchType || undefined,
            query: actualQuery || undefined,
            doubanId: actualDoubanId,
            allowAdultCandidates: shouldAllowAdultPlayback,
          });

        setDownloadDialogDetail(detail);
        setDownloadDialogAvailableSources(availableSources);
        setIsDownloadDialogOpen(true);
      } catch (error) {
        setDownloadDialogError(
          error instanceof Error ? error.message : '获取可下载剧集失败'
        );
      } finally {
        setIsDownloadDialogLoading(false);
      }
    }, [
      actualDoubanId,
      actualId,
      actualQuery,
      actualSearchType,
      actualSource,
      actualTitle,
      actualYear,
      downloadDialogDetail,
      origin,
      shouldAllowAdultPlayback,
    ]);

    const showFollowUpdatesAction =
      isDesktopFollowUpdatesEnabled() &&
      canManageFollowUpdates({
        source: actualSource,
        id: actualId,
        title: actualTitle,
        origin,
        from,
        isAggregate,
      });
    const showFavoriteAction = Boolean(
      (actualSource && actualId) || (origin === 'vod' && actualTitle.trim())
    );

    const openActionSheet = useCallback(() => {
      if (!showMobileActions) {
        setShowMobileActions(true);
      }

      if (
        from === 'search' &&
        !isAggregate &&
        actualSource &&
        actualId &&
        searchFavorited === null
      ) {
        void checkSearchFavoriteStatus();
      }

      if (
        (showFavoriteAction || showFollowUpdatesAction) &&
        !hasStableFollowLookupKey
      ) {
        void resolveFollowTarget().catch(() => {});
      }
    }, [
      actualId,
      actualTitle,
      actualSource,
      checkSearchFavoriteStatus,
      from,
      hasStableFollowLookupKey,
      isAggregate,
      origin,
      resolveFollowTarget,
      searchFavorited,
      showFavoriteAction,
      showFollowUpdatesAction,
      showMobileActions,
    ]);

    // 长按操作
    const handleLongPress = useCallback(() => {
      openActionSheet();
    }, [openActionSheet]);

    // 长按手势hook
    const longPressProps = useLongPress({
      onLongPress: handleLongPress,
      onClick: handleClick, // 保持点击播放功能
      longPressDelay: 500,
    });

    const config = useMemo(() => {
      const configs = {
        playrecord: {
          showSourceName: true,
          showPlayButton: true,
          showHeart: true,
          showCheckCircle: true,
          showDoubanLink: false,
          showRating: false,
          showYear: false,
        },
        favorite: {
          showSourceName: true,
          showPlayButton: true,
          showHeart: true,
          showCheckCircle: false,
          showDoubanLink: false,
          showRating: false,
          showYear: false,
        },
        search: {
          showSourceName: true,
          showPlayButton: true,
          showHeart: true, // 移动端菜单中需要显示收藏选项
          showCheckCircle: false,
          showDoubanLink: true, // 移动端菜单中显示豆瓣链接
          showRating: !!rate,
          showYear: true,
        },
        douban: {
          showSourceName: false,
          showPlayButton: true,
          showHeart: false,
          showCheckCircle: false,
          showDoubanLink: true,
          showRating: !!rate,
          showYear: false,
        },
      };
      return configs[from] || configs.search;
    }, [from, rate]);

    const showRatingBadge = config.showRating && !!rate;
    const showEpisodesBadge = Boolean(actualEpisodes && actualEpisodes > 1);
    const hasFollowNewEpisodes = hasNewEpisodes(followRecord);

    // 移动端操作菜单配置
    const mobileActions = useMemo(() => {
      const actions = [];

      // 播放操作
      if (config.showPlayButton) {
        actions.push({
          id: 'play',
          label: origin === 'live' ? '观看直播' : '播放',
          icon: <Play size={20} />,
          onClick: handleClick,
          color: 'primary' as const,
        });

        // 新标签页播放
        actions.push({
          id: 'play-new-tab',
          label: origin === 'live' ? '新标签页观看' : '新标签页播放',
          icon: <ExternalLink size={20} />,
          onClick: handlePlayInNewTab,
          color: 'default' as const,
        });
      }

      if (origin === 'vod' && actualTitle.trim()) {
        actions.push({
          id: 'download',
          label: '下载',
          icon: <Download size={20} />,
          onClick: handleOpenDownloadDialog,
          color: 'default' as const,
        });
      }

      if (showFollowUpdatesAction) {
        actions.push({
          id: 'follow-updates',
          label: isFollowLoading
            ? '追更处理中...'
            : followRecord
            ? '取消追更'
            : '开启追更',
          icon: isFollowLoading ? (
            <Loader2 size={20} className='animate-spin' />
          ) : followRecord ? (
            <BellOff size={20} />
          ) : (
            <Bell size={20} />
          ),
          onClick: handleToggleFollowUpdates,
          color: followRecord ? ('danger' as const) : ('default' as const),
          disabled: isFollowLoading,
        });
      }

      // 聚合源信息 - 直接在菜单中展示，不需要单独的操作项

      // 收藏/取消收藏操作
      if (showFavoriteAction) {
        const currentFavorited =
          from === 'search' ? searchFavorited : favorited;

        if (from === 'search') {
          // 搜索结果：根据加载状态显示不同的选项
          if (searchFavorited !== null) {
            // 已加载完成，显示实际的收藏状态
            actions.push({
              id: 'favorite',
              label: currentFavorited ? '取消收藏' : '添加收藏',
              icon: currentFavorited ? (
                <Heart size={20} className='fill-red-600 stroke-red-600' />
              ) : (
                <Heart size={20} className='fill-transparent stroke-red-500' />
              ),
              onClick: () => {
                const mockEvent = {
                  preventDefault: () => {},
                  stopPropagation: () => {},
                } as React.MouseEvent;
                handleToggleFavorite(mockEvent);
              },
              color: currentFavorited
                ? ('danger' as const)
                : ('default' as const),
            });
          } else {
            // 正在加载中，显示占位项
            actions.push({
              id: 'favorite-loading',
              label: '收藏加载中...',
              icon: <Heart size={20} />,
              onClick: () => {}, // 加载中时不响应点击
              disabled: true,
            });
          }
        } else {
          // 非搜索结果：直接显示收藏选项
          actions.push({
            id: 'favorite',
            label: currentFavorited ? '取消收藏' : '添加收藏',
            icon: currentFavorited ? (
              <Heart size={20} className='fill-red-600 stroke-red-600' />
            ) : (
              <Heart size={20} className='fill-transparent stroke-red-500' />
            ),
            onClick: () => {
              const mockEvent = {
                preventDefault: () => {},
                stopPropagation: () => {},
              } as React.MouseEvent;
              handleToggleFavorite(mockEvent);
            },
            color: currentFavorited
              ? ('danger' as const)
              : ('default' as const),
          });
        }
      }

      // 删除播放记录操作
      if (
        config.showCheckCircle &&
        from === 'playrecord' &&
        actualSource &&
        actualId
      ) {
        actions.push({
          id: 'delete',
          label: '删除记录',
          icon: <Trash2 size={20} />,
          onClick: () => {
            const mockEvent = {
              preventDefault: () => {},
              stopPropagation: () => {},
            } as React.MouseEvent;
            handleDeleteRecord(mockEvent);
          },
          color: 'danger' as const,
        });
      }

      // 豆瓣链接操作
      if (config.showDoubanLink && actualDoubanId && actualDoubanId !== 0) {
        actions.push({
          id: 'douban',
          label: isBangumi ? 'Bangumi 详情' : '豆瓣详情',
          icon: <Link size={20} />,
          onClick: () => {
            const url = isBangumi
              ? `https://bgm.tv/subject/${actualDoubanId.toString()}`
              : `https://movie.douban.com/subject/${actualDoubanId.toString()}`;
            window.open(url, '_blank', 'noopener,noreferrer');
          },
          color: 'default' as const,
        });
      }

      return actions;
    }, [
      config,
      from,
      actualSource,
      actualId,
      favorited,
      searchFavorited,
      actualDoubanId,
      isBangumi,
      followRecord,
      isFollowLoading,
      isAggregate,
      dynamicSourceNames,
      handleClick,
      handleOpenDownloadDialog,
      handleToggleFollowUpdates,
      handleToggleFavorite,
      handleDeleteRecord,
      origin,
      showFavoriteAction,
      showFollowUpdatesAction,
    ]);

    const initialDownloadEpisodeIndex = Math.max(
      0,
      Math.min(
        Math.max(0, (currentEpisode || 1) - 1),
        Math.max(0, (downloadDialogDetail?.episodes.length || 1) - 1)
      )
    );
    const shouldShowPlaybackModeBadge =
      origin === 'vod' &&
      (from === 'playrecord' || from === 'favorite') &&
      Boolean(effectivePlaybackMode);
    const playbackModeLabel =
      effectivePlaybackMode === 'offline' ? '离线' : '在线';
    const typeLabel = getVideoTypeLabel(
      actualSearchType,
      actualEpisodes,
      origin
    );
    const showInlineFavoriteAction = config.showHeart && from !== 'search';
    const showInlineDeleteAction =
      config.showCheckCircle &&
      from === 'playrecord' &&
      Boolean(actualSource && actualId);
    const showHoverActionRail =
      showInlineFavoriteAction || showInlineDeleteAction;
    const showOfflinePlaybackChip =
      shouldShowPlaybackModeBadge && effectivePlaybackMode === 'offline';
    const showYearBadge =
      config.showYear &&
      actualYear &&
      actualYear !== 'unknown' &&
      actualYear.trim() !== '';
    const metadataItems = useMemo<
      Array<{
        key: string;
        label: string;
        tone?: 'neutral' | 'accent';
        icon?: React.ReactNode;
      }>
    >(() => {
      const items: Array<{
        key: string;
        label: string;
        tone?: 'neutral' | 'accent';
        icon?: React.ReactNode;
      }> = [];

      if (config.showSourceName && source_name) {
        items.push({
          key: 'source',
          label: source_name,
          icon:
            origin === 'live' ? <Radio size={11} className='shrink-0' /> : null,
        });
      }

      if (typeLabel) {
        items.push({
          key: 'type',
          label: typeLabel,
          tone: 'neutral',
        });
      }

      if (showOfflinePlaybackChip) {
        items.push({
          key: 'playback',
          label: playbackModeLabel,
          tone: 'accent',
        });
      }

      return items;
    }, [
      config.showSourceName,
      origin,
      playbackModeLabel,
      showOfflinePlaybackChip,
      source_name,
      typeLabel,
    ]);
    const aggregateSourceSummary = useMemo(() => {
      if (
        !isAggregate ||
        !dynamicSourceNames ||
        dynamicSourceNames.length === 0
      ) {
        return null;
      }

      const prioritySources = [
        '爱奇艺',
        '腾讯视频',
        '优酷',
        '芒果TV',
        '哔哩哔哩',
        'Netflix',
        'Disney+',
      ];
      const uniqueSources = Array.from(new Set(dynamicSourceNames));
      const sortedSources = [...uniqueSources].sort((a, b) => {
        const aIndex = prioritySources.indexOf(a);
        const bIndex = prioritySources.indexOf(b);

        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }

        if (aIndex !== -1) {
          return -1;
        }

        if (bIndex !== -1) {
          return 1;
        }

        return a.localeCompare(b);
      });
      const maxDisplayCount = 6;

      return {
        count: uniqueSources.length,
        displaySources: sortedSources.slice(0, maxDisplayCount),
        hasMore: sortedSources.length > maxDisplayCount,
        remainingCount: Math.max(0, sortedSources.length - maxDisplayCount),
      };
    }, [dynamicSourceNames, isAggregate]);
    const cardShellClassName = 'luna-card-shell rounded-[0.9rem] p-0';
    const posterClassName = `luna-card-poster relative aspect-[11/19] overflow-hidden rounded-[0.9rem] ${
      origin === 'live' ? 'ring-1 ring-white/20 dark:ring-sky-200/15' : ''
    }`;
    const posterImageClassName =
      origin === 'live'
        ? 'object-contain p-4 sm:p-5'
        : 'luna-card-poster-media object-cover';
    const posterOverlayClassName = `luna-card-poster-overlay absolute inset-0 transition-opacity duration-200 ease-out ${
      isNavigating ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'
    }`;
    const infoPanelClassName = 'luna-card-info mt-[0.38rem]';
    const nonSelectableStyle: React.CSSProperties = {
      WebkitUserSelect: 'none',
      userSelect: 'none',
      WebkitTouchCallout: 'none',
    };
    const interactiveCardStyle: React.CSSProperties = {
      ...nonSelectableStyle,
      WebkitTapHighlightColor: 'transparent',
      touchAction: 'manipulation',
      pointerEvents: 'auto',
    };
    const imageStyle: React.CSSProperties = {
      ...nonSelectableStyle,
      pointerEvents: 'none',
    };

    return (
      <>
        <div
          className={`group relative w-full cursor-pointer transition-all duration-200 ease-out ${cardShellClassName} ${
            isNavigating
              ? 'z-[500] -translate-y-0.5'
              : 'hover:z-[500] hover:-translate-y-1 active:translate-y-0'
          }`}
          aria-busy={isNavigating}
          onClick={handleClick}
          onPointerDown={prefetchDestination}
          onPointerEnter={prefetchDestination}
          onFocus={prefetchDestination}
          onTouchStartCapture={prefetchDestination}
          {...longPressProps}
          style={interactiveCardStyle}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openActionSheet();
            return false;
          }}
          onDragStart={(e) => {
            e.preventDefault();
            return false;
          }}
        >
          <div
            className={posterClassName}
            style={nonSelectableStyle}
            onContextMenu={(e) => {
              e.preventDefault();
              return false;
            }}
          >
            {!isLoading && <ImagePlaceholder aspectRatio='aspect-[2/3]' />}
            <Image
              src={processImageUrl(actualPoster)}
              alt={actualTitle}
              fill
              className={posterImageClassName}
              referrerPolicy='no-referrer'
              loading='lazy'
              onLoadingComplete={() => setIsLoading(true)}
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                if (!img.dataset.retried) {
                  img.dataset.retried = 'true';
                  setTimeout(() => {
                    img.src = processImageUrl(actualPoster);
                  }, 2000);
                }
              }}
              style={imageStyle}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
              onDragStart={(e) => {
                e.preventDefault();
                return false;
              }}
            />

            <div className='pointer-events-none absolute inset-0 luna-card-poster-sheen' />

            {isNavigating ? (
              <div className='absolute inset-0 z-30 flex items-center justify-center bg-black/45 backdrop-blur-[1px]'>
                <div className='inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-black/75 px-3 py-2 text-xs font-medium text-white shadow-xl shadow-black/30'>
                  <Loader2 className='h-4 w-4 animate-spin text-emerald-300' />
                  <span>正在打开</span>
                </div>
              </div>
            ) : null}

            <div
              className={posterOverlayClassName}
              style={nonSelectableStyle}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            />

            {config.showPlayButton ? (
              <div
                data-button='true'
                className='pointer-events-none absolute inset-0 z-20 flex scale-[0.94] items-center justify-center opacity-0 transition-all duration-200 ease-out sm:group-hover:scale-100 sm:group-hover:opacity-100'
                style={nonSelectableStyle}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                <div className='luna-card-action luna-card-action--play flex h-[3.35rem] w-[3.35rem] items-center justify-center rounded-full sm:h-[3.5rem] sm:w-[3.5rem]'>
                  <Play
                    size={20}
                    strokeWidth={2.35}
                    className='translate-x-[1px] fill-white text-white transition-transform duration-200 ease-out group-hover:scale-[1.03] sm:h-[1.38rem] sm:w-[1.38rem]'
                    style={nonSelectableStyle}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      return false;
                    }}
                  />
                </div>
              </div>
            ) : null}

            {showYearBadge ? (
              <div
                className='luna-chip luna-chip--ghost absolute left-3 top-3 z-20 min-h-0 px-2.5 py-1 text-[0.68rem] font-semibold'
                style={nonSelectableStyle}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                {actualYear}
              </div>
            ) : null}

            {showRatingBadge || showEpisodesBadge || hasFollowNewEpisodes ? (
              <div
                className='absolute right-2 top-2 z-20 flex flex-col items-end gap-[0.22rem]'
                style={nonSelectableStyle}
              >
                {showRatingBadge ? (
                  <div className='luna-card-badge luna-card-badge--score'>
                    {rate}
                  </div>
                ) : null}
                {showEpisodesBadge ? (
                  <div className='luna-card-badge luna-card-badge--accent'>
                    {currentEpisode
                      ? `${currentEpisode}/${actualEpisodes}`
                      : actualEpisodes}
                  </div>
                ) : null}
                {hasFollowNewEpisodes ? (
                  <div className='luna-card-badge luna-card-badge--warning'>
                    NEW
                  </div>
                ) : null}
              </div>
            ) : null}

            {config.showDoubanLink && actualDoubanId && actualDoubanId !== 0 ? (
              <a
                href={
                  isBangumi
                    ? `https://bgm.tv/subject/${actualDoubanId.toString()}`
                    : `https://movie.douban.com/subject/${actualDoubanId.toString()}`
                }
                target='_blank'
                rel='noopener noreferrer'
                onClick={(e) => e.stopPropagation()}
                className={`absolute left-3 z-20 opacity-0 -translate-x-2 transition-all duration-200 ease-out delay-100 sm:group-hover:translate-x-0 sm:group-hover:opacity-100 ${
                  showYearBadge ? 'top-[3rem]' : 'top-3'
                }`}
                style={nonSelectableStyle}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                <div className='luna-card-action flex h-8 w-8 items-center justify-center rounded-full text-[var(--luna-card-text)]'>
                  <Link
                    size={16}
                    style={{
                      ...nonSelectableStyle,
                      pointerEvents: 'none',
                    }}
                  />
                </div>
              </a>
            ) : null}

            {aggregateSourceSummary ? (
              <div
                className='absolute bottom-[4.9rem] right-3 z-20 opacity-0 transition-all duration-200 ease-out delay-75 sm:group-hover:opacity-100'
                style={nonSelectableStyle}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                <div className='relative group/sources'>
                  <div className='luna-card-action flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-xs font-bold text-[var(--luna-card-text)]'>
                    {aggregateSourceSummary.count}
                  </div>
                  <div className='pointer-events-none invisible absolute bottom-full right-0 z-50 mb-2 opacity-0 transition-all duration-200 ease-out delay-100 group-hover/sources:visible group-hover/sources:opacity-100'>
                    <div className='luna-popover min-w-[100px] max-w-[140px] overflow-hidden rounded-[1rem] border border-[var(--luna-popover-border)] p-1.5 text-xs text-[var(--luna-card-text)] shadow-xl sm:min-w-[120px] sm:max-w-[200px] sm:p-2'>
                      <div className='space-y-0.5 sm:space-y-1'>
                        {aggregateSourceSummary.displaySources.map(
                          (sourceName, index) => (
                            <div
                              key={index}
                              className='flex items-center gap-1 sm:gap-1.5'
                            >
                              <div className='h-0.5 w-0.5 flex-shrink-0 rounded-full bg-[var(--luna-accent)] sm:h-1 sm:w-1' />
                              <span
                                className='truncate text-[10px] leading-tight sm:text-xs'
                                title={sourceName}
                              >
                                {sourceName}
                              </span>
                            </div>
                          )
                        )}
                      </div>

                      {aggregateSourceSummary.hasMore ? (
                        <div className='mt-1 border-t border-white/10 pt-1 sm:mt-2 sm:pt-1.5'>
                          <div className='flex items-center justify-center text-[var(--luna-card-muted)]'>
                            <span className='text-[10px] font-medium sm:text-xs'>
                              +{aggregateSourceSummary.remainingCount} 播放源
                            </span>
                          </div>
                        </div>
                      ) : null}

                      <div className='absolute right-2 top-full h-0 w-0 border-l-[4px] border-r-[4px] border-t-[4px] border-transparent border-t-white/10 sm:right-3 sm:border-l-[6px] sm:border-r-[6px] sm:border-t-[6px]' />
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {showHoverActionRail ? (
              <div
                data-button='true'
                className='absolute bottom-[0.68rem] right-[0.72rem] z-30 flex translate-y-2 items-center gap-[0.34rem] opacity-0 transition-all duration-200 ease-out sm:group-hover:translate-y-0 sm:group-hover:opacity-100'
                style={nonSelectableStyle}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                {showInlineDeleteAction ? (
                  <button
                    type='button'
                    onClick={handleDeleteRecord}
                    className='flex h-[1.625rem] w-[1.625rem] items-center justify-center rounded-full text-white/90 transition-colors duration-200 hover:bg-white/10 hover:text-white'
                    aria-label='删除记录'
                  >
                    <Trash2
                      size={15}
                      className='text-[var(--luna-card-text)]'
                    />
                  </button>
                ) : null}
                {showInlineFavoriteAction ? (
                  <button
                    type='button'
                    onClick={handleToggleFavorite}
                    className='flex h-[1.625rem] w-[1.625rem] items-center justify-center rounded-full text-white/90 transition-colors duration-200 hover:bg-white/10 hover:text-white'
                    aria-label={favorited ? '取消收藏' : '添加收藏'}
                  >
                    <Heart
                      size={15}
                      className={`transition-colors duration-200 ${
                        favorited
                          ? 'fill-rose-500 stroke-rose-500'
                          : 'fill-transparent text-[var(--luna-card-text)] hover:text-rose-300'
                      }`}
                    />
                  </button>
                ) : null}
              </div>
            ) : null}

            <div
              className={infoPanelClassName}
              style={nonSelectableStyle}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              <div className='relative min-w-0'>
                <span className='peer block truncate text-[0.94rem] font-semibold leading-[1.08] tracking-[-0.028em] text-[var(--luna-card-text)] transition-colors duration-200 ease-out group-hover:text-white sm:text-[0.98rem]'>
                  {actualTitle}
                </span>
                <div className='luna-popover pointer-events-none absolute bottom-full left-1/2 mb-2 invisible -translate-x-1/2 whitespace-nowrap rounded-[0.9rem] px-3 py-1 text-xs text-[var(--luna-card-text)] opacity-0 transition-all duration-200 ease-out delay-100 peer-hover:visible peer-hover:opacity-100'>
                  {actualTitle}
                  <div className='absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-l-4 border-r-4 border-t-4 border-transparent border-t-white/10' />
                </div>
              </div>

              {metadataItems.length > 0 ? (
                <div
                  className={`mt-[0.36rem] flex flex-wrap items-center gap-[0.3rem] ${
                    showHoverActionRail ? 'pr-8 sm:pr-9' : ''
                  }`}
                >
                  {metadataItems.map((item) => (
                    <span
                      key={item.key}
                      className={`luna-chip ${
                        item.tone === 'accent'
                          ? 'luna-chip--accent'
                          : item.tone === 'neutral'
                          ? 'luna-chip--neutral'
                          : ''
                      }`}
                    >
                      {item.icon}
                      {item.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {progress !== undefined ? (
              <div className='luna-card-progress-track absolute bottom-0 left-0 right-0 z-30'>
                <div
                  className='luna-card-progress-fill h-full'
                  style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }}
                />
              </div>
            ) : null}
          </div>
        </div>

        {/* 操作菜单 - 支持右键和长按触发 */}
        <MobileActionSheet
          isOpen={showMobileActions}
          onClose={() => setShowMobileActions(false)}
          title={actualTitle}
          poster={processImageUrl(actualPoster)}
          actions={mobileActions}
          sources={
            isAggregate && dynamicSourceNames
              ? Array.from(new Set(dynamicSourceNames))
              : undefined
          }
          isAggregate={isAggregate}
          sourceName={source_name}
          currentEpisode={currentEpisode}
          totalEpisodes={actualEpisodes}
          origin={origin}
        />

        {isDownloadDialogLoading &&
          typeof document !== 'undefined' &&
          createPortal(
            <div className='fixed inset-0 z-[10010] flex items-center justify-center p-4'>
              <div className='absolute inset-0 bg-black/70 backdrop-blur-sm' />
              <div className='relative z-[10011] w-full max-w-md rounded-3xl border border-white/10 bg-[#04110d] p-6 text-white shadow-2xl shadow-black/40'>
                <div className='text-xs font-medium uppercase tracking-[0.24em] text-emerald-300/80'>
                  准备下载
                </div>
                <div className='mt-3 break-words text-2xl font-semibold text-white'>
                  {actualTitle}
                </div>
                <div className='mt-3 text-sm text-gray-300'>
                  正在加载可下载剧集和可用片源，请稍候。
                </div>
              </div>
            </div>,
            document.body
          )}

        {downloadDialogError &&
          !isDownloadDialogLoading &&
          typeof document !== 'undefined' &&
          createPortal(
            <div className='fixed inset-0 z-[10010] flex items-center justify-center p-4'>
              <button
                type='button'
                aria-label='关闭下载提示'
                className='absolute inset-0 bg-black/70 backdrop-blur-sm'
                onClick={() => setDownloadDialogError(null)}
              />
              <div className='relative z-[10011] w-full max-w-md rounded-3xl border border-white/10 bg-[#04110d] p-6 text-white shadow-2xl shadow-black/40'>
                <div className='text-xs font-medium uppercase tracking-[0.24em] text-red-300/80'>
                  下载不可用
                </div>
                <div className='mt-3 break-words text-2xl font-semibold text-white'>
                  {actualTitle}
                </div>
                <div className='mt-3 text-sm text-gray-300'>
                  {downloadDialogError}
                </div>
                <div className='mt-5 flex justify-end'>
                  <button
                    type='button'
                    onClick={() => setDownloadDialogError(null)}
                    className='inline-flex h-10 min-w-[72px] items-center justify-center rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10'
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}

        {downloadDialogFeedback &&
          typeof document !== 'undefined' &&
          createPortal(
            <div className='fixed bottom-6 left-1/2 z-[10012] w-[min(92vw,560px)] -translate-x-1/2 rounded-2xl border border-emerald-500/20 bg-[#04110d]/95 px-4 py-3 text-sm text-emerald-100 shadow-2xl shadow-black/40 backdrop-blur-sm'>
              {downloadDialogFeedback}
            </div>,
            document.body
          )}

        {downloadDialogDetail && (
          <BatchEpisodeDownloadDialog
            detail={downloadDialogDetail}
            availableSources={downloadDialogAvailableSources}
            episodeIndex={initialDownloadEpisodeIndex}
            isOpen={isDownloadDialogOpen}
            searchTitle={actualQuery || actualTitle}
            searchType={actualSearchType || undefined}
            onClose={() => setIsDownloadDialogOpen(false)}
            onComplete={(message) => {
              setDownloadDialogError(null);
              setDownloadDialogFeedback(message);
            }}
          />
        )}
      </>
    );
  }
);

export default memo(VideoCard);
