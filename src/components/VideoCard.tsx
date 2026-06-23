/* eslint-disable @typescript-eslint/no-explicit-any,react-hooks/exhaustive-deps,@typescript-eslint/no-empty-function */

import {
  Bell,
  BellOff,
  Download,
  ExternalLink,
  Heart,
  Link,
  Loader2,
  PlayCircleIcon,
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

import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  getCachedFollowRecordsSnapshot,
  getFollowRecord,
  isFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getOfflineDownloadSupportState } from '@/lib/download/cache';
import { resolveDownloadablePlaybackSources } from '@/lib/download/downloadable';
import {
  canManageFollowUpdates,
  disableFollowUpdatesWithFeedback,
  enableFollowUpdatesWithFeedback,
  hasNewEpisodes,
  isDesktopFollowUpdatesEnabled,
} from '@/lib/follow-updates';
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

const VideoCard = forwardRef<VideoCardHandle, VideoCardProps>(
  function VideoCard(
    {
      id,
      title = '',
      query = '',
      poster = '',
      episodes,
      source,
      source_name,
      source_names,
      progress = 0,
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
          showProgress: true,
          showPlayButton: true,
          showHeart: true,
          showCheckCircle: true,
          showDoubanLink: false,
          showRating: false,
          showYear: false,
        },
        favorite: {
          showSourceName: true,
          showProgress: false,
          showPlayButton: true,
          showHeart: true,
          showCheckCircle: false,
          showDoubanLink: false,
          showRating: false,
          showYear: false,
        },
        search: {
          showSourceName: true,
          showProgress: false,
          showPlayButton: true,
          showHeart: true, // 移动端菜单中需要显示收藏选项
          showCheckCircle: false,
          showDoubanLink: true, // 移动端菜单中显示豆瓣链接
          showRating: !!rate,
          showYear: true,
        },
        douban: {
          showSourceName: false,
          showProgress: false,
          showPlayButton: true,
          showHeart: false,
          showCheckCircle: false,
          showDoubanLink: true,
          showRating: !!rate,
          showYear: false,
        },
      };
      return configs[from] || configs.search;
    }, [from, isAggregate, douban_id, rate]);

    const showRatingBadge = config.showRating && !!rate;
    const showEpisodesBadge = !!actualEpisodes && actualEpisodes > 1;
    const hasFollowNewEpisodes = hasNewEpisodes(followRecord);
    const followBadgeTopClass = showRatingBadge
      ? showEpisodesBadge
        ? 'top-[4.5rem]'
        : 'top-10'
      : showEpisodesBadge
      ? 'top-10'
      : 'top-2';

    // 移动端操作菜单配置
    const mobileActions = useMemo(() => {
      const actions = [];

      // 播放操作
      if (config.showPlayButton) {
        actions.push({
          id: 'play',
          label: origin === 'live' ? '观看直播' : '播放',
          icon: <PlayCircleIcon size={20} />,
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
    const playbackModeClassName =
      effectivePlaybackMode === 'offline'
        ? 'border-emerald-500/60 text-emerald-600 dark:border-emerald-400/60 dark:text-emerald-300'
        : 'border-sky-500/50 text-sky-600 dark:border-sky-400/50 dark:text-sky-300';

    return (
      <>
        <div
          className={`group relative w-full rounded-lg bg-transparent cursor-pointer transition-all duration-300 ease-in-out ${
            isNavigating
              ? 'scale-[1.02] z-[500]'
              : 'hover:scale-[1.05] hover:z-[500] active:scale-[1.01]'
          }`}
          aria-busy={isNavigating}
          onClick={handleClick}
          onPointerDown={prefetchDestination}
          onPointerEnter={prefetchDestination}
          onFocus={prefetchDestination}
          onTouchStartCapture={prefetchDestination}
          {...longPressProps}
          style={
            {
              // 禁用所有默认的长按和选择效果
              WebkitUserSelect: 'none',
              userSelect: 'none',
              WebkitTouchCallout: 'none',
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'manipulation',
              // 禁用右键菜单和长按菜单
              pointerEvents: 'auto',
            } as React.CSSProperties
          }
          onContextMenu={(e) => {
            // 阻止默认右键菜单
            e.preventDefault();
            e.stopPropagation();

            // 右键弹出操作菜单
            openActionSheet();

            return false;
          }}
          onDragStart={(e) => {
            // 阻止拖拽
            e.preventDefault();
            return false;
          }}
        >
          {/* 海报容器 */}
          <div
            className={`relative aspect-[2/3] overflow-hidden rounded-lg ${
              origin === 'live'
                ? 'ring-1 ring-gray-300/80 dark:ring-gray-600/80'
                : ''
            }`}
            style={
              {
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties
            }
            onContextMenu={(e) => {
              e.preventDefault();
              return false;
            }}
          >
            {/* 骨架屏 */}
            {!isLoading && <ImagePlaceholder aspectRatio='aspect-[2/3]' />}
            {/* 图片 */}
            <Image
              src={processImageUrl(actualPoster)}
              alt={actualTitle}
              fill
              className={origin === 'live' ? 'object-contain' : 'object-cover'}
              referrerPolicy='no-referrer'
              loading='lazy'
              onLoadingComplete={() => setIsLoading(true)}
              onError={(e) => {
                // 图片加载失败时的重试机制
                const img = e.target as HTMLImageElement;
                if (!img.dataset.retried) {
                  img.dataset.retried = 'true';
                  setTimeout(() => {
                    img.src = processImageUrl(actualPoster);
                  }, 2000);
                }
              }}
              style={
                {
                  // 禁用图片的默认长按效果
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                  pointerEvents: 'none', // 图片不响应任何指针事件
                } as React.CSSProperties
              }
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
              onDragStart={(e) => {
                e.preventDefault();
                return false;
              }}
            />

            {isNavigating && (
              <div className='absolute inset-0 z-20 flex items-center justify-center bg-black/45 backdrop-blur-[1px]'>
                <div className='inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-black/75 px-3 py-2 text-xs font-medium text-white shadow-xl shadow-black/30'>
                  <Loader2 className='h-4 w-4 animate-spin text-emerald-300' />
                  <span>正在打开</span>
                </div>
              </div>
            )}

            {/* 悬浮遮罩 */}
            <div
              className={`absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent transition-opacity duration-300 ease-in-out ${
                isNavigating
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100'
              }`}
              style={
                {
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties
              }
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            />

            {/* 播放按钮 */}
            {config.showPlayButton && (
              <div
                data-button='true'
                className='absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 ease-in-out delay-75 group-hover:opacity-100 group-hover:scale-100'
                style={
                  {
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                <PlayCircleIcon
                  size={50}
                  strokeWidth={0.8}
                  className='text-white fill-transparent transition-all duration-300 ease-out hover:fill-green-500 hover:scale-[1.1]'
                  style={
                    {
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                />
              </div>
            )}

            {/* 操作按钮 */}
            {(config.showHeart || config.showCheckCircle) && (
              <div
                data-button='true'
                className='absolute bottom-3 right-3 flex gap-3 opacity-0 translate-y-2 transition-all duration-300 ease-in-out sm:group-hover:opacity-100 sm:group-hover:translate-y-0'
                style={
                  {
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                {config.showCheckCircle && (
                  <Trash2
                    onClick={handleDeleteRecord}
                    size={20}
                    className='text-white transition-all duration-300 ease-out hover:stroke-red-500 hover:scale-[1.1]'
                    style={
                      {
                        WebkitUserSelect: 'none',
                        userSelect: 'none',
                        WebkitTouchCallout: 'none',
                      } as React.CSSProperties
                    }
                    onContextMenu={(e) => {
                      e.preventDefault();
                      return false;
                    }}
                  />
                )}
                {config.showHeart && from !== 'search' && (
                  <Heart
                    onClick={handleToggleFavorite}
                    size={20}
                    className={`transition-all duration-300 ease-out ${
                      favorited
                        ? 'fill-red-600 stroke-red-600'
                        : 'fill-transparent stroke-white hover:stroke-red-400'
                    } hover:scale-[1.1]`}
                    style={
                      {
                        WebkitUserSelect: 'none',
                        userSelect: 'none',
                        WebkitTouchCallout: 'none',
                      } as React.CSSProperties
                    }
                    onContextMenu={(e) => {
                      e.preventDefault();
                      return false;
                    }}
                  />
                )}
              </div>
            )}

            {/* 年份徽章 */}
            {config.showYear &&
              actualYear &&
              actualYear !== 'unknown' &&
              actualYear.trim() !== '' && (
                <div
                  className='absolute top-2 bg-black/50 text-white text-xs font-medium px-2 py-1 rounded backdrop-blur-sm shadow-sm transition-all duration-300 ease-out group-hover:opacity-90 left-2'
                  style={
                    {
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                >
                  {actualYear}
                </div>
              )}

            {/* 徽章 */}
            {showRatingBadge && (
              <div
                className='absolute top-2 right-2 bg-pink-500 text-white text-xs font-bold min-w-[1.75rem] h-7 px-1.5 rounded-full flex items-center justify-center shadow-md transition-all duration-300 ease-out group-hover:scale-110'
                style={
                  {
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                {rate}
              </div>
            )}

            {showEpisodesBadge && (
              <div
                className={`absolute right-2 ${
                  showRatingBadge ? 'top-10' : 'top-2'
                } bg-green-500 text-white text-xs font-semibold px-2 py-1 rounded-md shadow-md transition-all duration-300 ease-out group-hover:scale-110`}
                style={
                  {
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                {currentEpisode
                  ? `${currentEpisode}/${actualEpisodes}`
                  : actualEpisodes}
              </div>
            )}

            {hasFollowNewEpisodes && (
              <div
                className={`absolute right-2 ${followBadgeTopClass} rounded-md border border-amber-300/70 bg-amber-500 px-2 py-1 text-[11px] font-bold tracking-[0.08em] text-white shadow-md transition-all duration-300 ease-out group-hover:scale-110`}
                style={
                  {
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                NEW
              </div>
            )}

            {/* 豆瓣链接 */}
            {config.showDoubanLink &&
              actualDoubanId &&
              actualDoubanId !== 0 && (
                <a
                  href={
                    isBangumi
                      ? `https://bgm.tv/subject/${actualDoubanId.toString()}`
                      : `https://movie.douban.com/subject/${actualDoubanId.toString()}`
                  }
                  target='_blank'
                  rel='noopener noreferrer'
                  onClick={(e) => e.stopPropagation()}
                  className='absolute top-2 left-2 opacity-0 -translate-x-2 transition-all duration-300 ease-in-out delay-100 sm:group-hover:opacity-100 sm:group-hover:translate-x-0'
                  style={
                    {
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                >
                  <div
                    className='bg-green-500 text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center shadow-md hover:bg-green-600 hover:scale-[1.1] transition-all duration-300 ease-out'
                    style={
                      {
                        WebkitUserSelect: 'none',
                        userSelect: 'none',
                        WebkitTouchCallout: 'none',
                      } as React.CSSProperties
                    }
                    onContextMenu={(e) => {
                      e.preventDefault();
                      return false;
                    }}
                  >
                    <Link
                      size={16}
                      style={
                        {
                          WebkitUserSelect: 'none',
                          userSelect: 'none',
                          WebkitTouchCallout: 'none',
                          pointerEvents: 'none',
                        } as React.CSSProperties
                      }
                    />
                  </div>
                </a>
              )}

            {/* 聚合播放源指示器 */}
            {isAggregate &&
              dynamicSourceNames &&
              dynamicSourceNames.length > 0 &&
              (() => {
                const uniqueSources = Array.from(new Set(dynamicSourceNames));
                const sourceCount = uniqueSources.length;

                return (
                  <div
                    className='absolute bottom-2 right-2 opacity-0 transition-all duration-300 ease-in-out delay-75 sm:group-hover:opacity-100'
                    style={
                      {
                        WebkitUserSelect: 'none',
                        userSelect: 'none',
                        WebkitTouchCallout: 'none',
                      } as React.CSSProperties
                    }
                    onContextMenu={(e) => {
                      e.preventDefault();
                      return false;
                    }}
                  >
                    <div
                      className='relative group/sources'
                      style={
                        {
                          WebkitUserSelect: 'none',
                          userSelect: 'none',
                          WebkitTouchCallout: 'none',
                        } as React.CSSProperties
                      }
                    >
                      <div
                        className='bg-gray-700 text-white text-xs font-bold w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center shadow-md hover:bg-gray-600 hover:scale-[1.1] transition-all duration-300 ease-out cursor-pointer'
                        style={
                          {
                            WebkitUserSelect: 'none',
                            userSelect: 'none',
                            WebkitTouchCallout: 'none',
                          } as React.CSSProperties
                        }
                        onContextMenu={(e) => {
                          e.preventDefault();
                          return false;
                        }}
                      >
                        {sourceCount}
                      </div>

                      {/* 播放源详情悬浮框 */}
                      {(() => {
                        // 优先显示的播放源（常见的主流平台）
                        const prioritySources = [
                          '爱奇艺',
                          '腾讯视频',
                          '优酷',
                          '芒果TV',
                          '哔哩哔哩',
                          'Netflix',
                          'Disney+',
                        ];

                        // 按优先级排序播放源
                        const sortedSources = uniqueSources.sort((a, b) => {
                          const aIndex = prioritySources.indexOf(a);
                          const bIndex = prioritySources.indexOf(b);
                          if (aIndex !== -1 && bIndex !== -1)
                            return aIndex - bIndex;
                          if (aIndex !== -1) return -1;
                          if (bIndex !== -1) return 1;
                          return a.localeCompare(b);
                        });

                        const maxDisplayCount = 6; // 最多显示6个
                        const displaySources = sortedSources.slice(
                          0,
                          maxDisplayCount
                        );
                        const hasMore = sortedSources.length > maxDisplayCount;
                        const remainingCount =
                          sortedSources.length - maxDisplayCount;

                        return (
                          <div
                            className='absolute bottom-full mb-2 opacity-0 invisible group-hover/sources:opacity-100 group-hover/sources:visible transition-all duration-200 ease-out delay-100 pointer-events-none z-50 right-0 sm:right-0 -translate-x-0 sm:translate-x-0'
                            style={
                              {
                                WebkitUserSelect: 'none',
                                userSelect: 'none',
                                WebkitTouchCallout: 'none',
                              } as React.CSSProperties
                            }
                            onContextMenu={(e) => {
                              e.preventDefault();
                              return false;
                            }}
                          >
                            <div
                              className='bg-gray-800/90 backdrop-blur-sm text-white text-xs sm:text-xs rounded-lg shadow-xl border border-white/10 p-1.5 sm:p-2 min-w-[100px] sm:min-w-[120px] max-w-[140px] sm:max-w-[200px] overflow-hidden'
                              style={
                                {
                                  WebkitUserSelect: 'none',
                                  userSelect: 'none',
                                  WebkitTouchCallout: 'none',
                                } as React.CSSProperties
                              }
                              onContextMenu={(e) => {
                                e.preventDefault();
                                return false;
                              }}
                            >
                              {/* 单列布局 */}
                              <div className='space-y-0.5 sm:space-y-1'>
                                {displaySources.map((sourceName, index) => (
                                  <div
                                    key={index}
                                    className='flex items-center gap-1 sm:gap-1.5'
                                  >
                                    <div className='w-0.5 h-0.5 sm:w-1 sm:h-1 bg-blue-400 rounded-full flex-shrink-0'></div>
                                    <span
                                      className='truncate text-[10px] sm:text-xs leading-tight'
                                      title={sourceName}
                                    >
                                      {sourceName}
                                    </span>
                                  </div>
                                ))}
                              </div>

                              {/* 显示更多提示 */}
                              {hasMore && (
                                <div className='mt-1 sm:mt-2 pt-1 sm:pt-1.5 border-t border-gray-700/50'>
                                  <div className='flex items-center justify-center text-gray-400'>
                                    <span className='text-[10px] sm:text-xs font-medium'>
                                      +{remainingCount} 播放源
                                    </span>
                                  </div>
                                </div>
                              )}

                              {/* 小箭头 */}
                              <div className='absolute top-full right-2 sm:right-3 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[4px] sm:border-l-[6px] sm:border-r-[6px] sm:border-t-[6px] border-transparent border-t-gray-800/90'></div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })()}
          </div>

          {/* 进度条 */}
          {config.showProgress && progress !== undefined && (
            <div
              className='mt-1 h-1 w-full bg-gray-200 rounded-full overflow-hidden'
              style={
                {
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties
              }
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              <div
                className='h-full bg-green-500 transition-all duration-500 ease-out'
                style={
                  {
                    width: `${progress}%`,
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              />
            </div>
          )}

          {/* 标题与来源 */}
          <div
            className='mt-2 text-center'
            style={
              {
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties
            }
            onContextMenu={(e) => {
              e.preventDefault();
              return false;
            }}
          >
            <div
              className='relative'
              style={
                {
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties
              }
            >
              <span
                className='block text-sm font-semibold truncate text-gray-900 dark:text-gray-100 transition-colors duration-300 ease-in-out group-hover:text-green-600 dark:group-hover:text-green-400 peer'
                style={
                  {
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                {actualTitle}
              </span>
              {/* 自定义 tooltip */}
              <div
                className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible peer-hover:opacity-100 peer-hover:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap pointer-events-none'
                style={
                  {
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                {actualTitle}
                <div
                  className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'
                  style={
                    {
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties
                  }
                ></div>
              </div>
            </div>
            {config.showSourceName &&
              (source_name || shouldShowPlaybackModeBadge) && (
                <span
                  className='mt-1 flex flex-wrap items-center justify-center gap-1 text-xs text-gray-500 dark:text-gray-400'
                  style={
                    {
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                >
                  {source_name && (
                    <span
                      className='inline-block border rounded px-2 py-0.5 border-gray-500/60 dark:border-gray-400/60 transition-all duration-300 ease-in-out group-hover:border-green-500/60 group-hover:text-green-600 dark:group-hover:text-green-400'
                      style={
                        {
                          WebkitUserSelect: 'none',
                          userSelect: 'none',
                          WebkitTouchCallout: 'none',
                        } as React.CSSProperties
                      }
                      onContextMenu={(e) => {
                        e.preventDefault();
                        return false;
                      }}
                    >
                      {origin === 'live' && (
                        <Radio
                          size={12}
                          className='inline-block text-gray-500 dark:text-gray-400 mr-1.5'
                        />
                      )}
                      {source_name}
                    </span>
                  )}
                  {shouldShowPlaybackModeBadge && (
                    <span
                      className={`inline-block rounded border px-2 py-0.5 transition-all duration-300 ease-in-out ${playbackModeClassName}`}
                      style={
                        {
                          WebkitUserSelect: 'none',
                          userSelect: 'none',
                          WebkitTouchCallout: 'none',
                        } as React.CSSProperties
                      }
                      onContextMenu={(e) => {
                        e.preventDefault();
                        return false;
                      }}
                    >
                      {playbackModeLabel}
                    </span>
                  )}
                </span>
              )}
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
