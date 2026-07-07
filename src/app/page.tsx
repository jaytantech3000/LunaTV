/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  BangumiCalendarData,
  GetBangumiCalendarData,
} from '@/lib/bangumi.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { isAdultDownloadedContent } from '@/lib/download/offline';
// 客户端收藏 API
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/profile/client';
import { filterItemsByMinimumRating } from '@/lib/rating-filter';
import { DoubanItem } from '@/lib/types';
import { isAdultLibraryEntry } from '@/lib/yellow';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import ContinueWatching from '@/components/ContinueWatching';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';
import { useSite } from '@/components/SiteProvider';
import VideoCard from '@/components/VideoCard';

import { useDownloadStore } from '@/stores/downloadStore';
import {
  buildHomeDiscoveryCacheEntry,
  isDiscoveryCacheEntryFresh,
  useDiscoveryCacheStore,
} from '@/stores/useDiscoveryCacheStore';
import { useGlobalRatingFilterStore } from '@/stores/useGlobalRatingFilterStore';

function hasHomeDiscoverySeed(
  entry?: {
    hotMovies?: unknown[];
    hotTvShows?: unknown[];
    hotVarietyShows?: unknown[];
    bangumiCalendarData?: unknown[];
  } | null
) {
  if (!entry) {
    return false;
  }

  return Boolean(
    entry.hotMovies?.length ||
      entry.hotTvShows?.length ||
      entry.hotVarietyShows?.length ||
      entry.bangumiCalendarData?.length
  );
}

function HomeClient() {
  const cachedHomeDiscoveryEntry = useDiscoveryCacheStore(
    (state) => state.homeDiscoveryEntry
  );
  const hasDiscoveryCacheHydrated = useDiscoveryCacheStore(
    (state) => state.hasHydrated
  );
  const setHomeDiscoveryEntry = useDiscoveryCacheStore(
    (state) => state.setHomeDiscoveryEntry
  );
  const hasFreshHomeDiscoveryCache = isDiscoveryCacheEntryFresh(
    cachedHomeDiscoveryEntry
  );
  const hasCachedHomeDiscoverySeed = hasHomeDiscoverySeed(
    cachedHomeDiscoveryEntry
  );
  const [activeTab, setActiveTab] = useState<'home' | 'favorites'>('home');
  const [hotMovies, setHotMovies] = useState<DoubanItem[]>([]);
  const [hotTvShows, setHotTvShows] = useState<DoubanItem[]>([]);
  const [hotVarietyShows, setHotVarietyShows] = useState<DoubanItem[]>([]);
  const [bangumiCalendarData, setBangumiCalendarData] = useState<
    BangumiCalendarData[]
  >([]);
  const [loading, setLoading] = useState(true);
  const homeDiscoveryRequestIdRef = useRef(0);
  const isGlobalRatingFilterEnabled = useGlobalRatingFilterStore(
    (state) => state.enabled
  );
  const globalMinimumRating = useGlobalRatingFilterStore(
    (state) => state.minimumRating
  );
  const { adultContentFilterEnabled, announcement } = useSite();
  const downloadedLibrary = useDownloadStore((state) => state.library);

  const [showAnnouncement, setShowAnnouncement] = useState(false);

  // 检查公告弹窗状态
  useEffect(() => {
    if (typeof window !== 'undefined' && announcement) {
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
  }, [announcement]);

  // 收藏夹数据
  type FavoriteItem = {
    id: string;
    source: string;
    title: string;
    poster: string;
    episodes: number;
    source_name: string;
    currentEpisode?: number;
    search_title?: string;
    playback_mode?: 'online' | 'offline';
    offline_content_id?: string;
    is_adult?: boolean;
    origin?: 'vod' | 'live';
  };

  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const filteredHotMovies = useMemo(
    () =>
      filterItemsByMinimumRating(
        hotMovies,
        (item) => item.rate,
        isGlobalRatingFilterEnabled,
        globalMinimumRating
      ),
    [globalMinimumRating, hotMovies, isGlobalRatingFilterEnabled]
  );
  const filteredHotTvShows = useMemo(
    () =>
      filterItemsByMinimumRating(
        hotTvShows,
        (item) => item.rate,
        isGlobalRatingFilterEnabled,
        globalMinimumRating
      ),
    [globalMinimumRating, hotTvShows, isGlobalRatingFilterEnabled]
  );
  const filteredHotVarietyShows = useMemo(
    () =>
      filterItemsByMinimumRating(
        hotVarietyShows,
        (item) => item.rate,
        isGlobalRatingFilterEnabled,
        globalMinimumRating
      ),
    [globalMinimumRating, hotVarietyShows, isGlobalRatingFilterEnabled]
  );
  const todayBangumiItems = useMemo(() => {
    const today = new Date();
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentWeekday = weekdays[today.getDay()];

    return (
      bangumiCalendarData.find((item) => item.weekday.en === currentWeekday)
        ?.items || []
    );
  }, [bangumiCalendarData]);
  const filteredTodayBangumiItems = useMemo(
    () =>
      filterItemsByMinimumRating(
        todayBangumiItems,
        (item) => item.rating?.score ?? 0,
        isGlobalRatingFilterEnabled,
        globalMinimumRating
      ),
    [globalMinimumRating, isGlobalRatingFilterEnabled, todayBangumiItems]
  );
  const hasVisibleHomeRecommendations =
    filteredHotMovies.length > 0 ||
    filteredHotTvShows.length > 0 ||
    filteredTodayBangumiItems.length > 0 ||
    filteredHotVarietyShows.length > 0;

  useLayoutEffect(() => {
    if (!hasDiscoveryCacheHydrated || !cachedHomeDiscoveryEntry) {
      return;
    }

    setHotMovies(cachedHomeDiscoveryEntry.hotMovies);
    setHotTvShows(cachedHomeDiscoveryEntry.hotTvShows);
    setHotVarietyShows(cachedHomeDiscoveryEntry.hotVarietyShows);
    setBangumiCalendarData(cachedHomeDiscoveryEntry.bangumiCalendarData);
    setLoading(false);
  }, [cachedHomeDiscoveryEntry, hasDiscoveryCacheHydrated]);

  useEffect(() => {
    if (!hasDiscoveryCacheHydrated) {
      return;
    }

    if (hasFreshHomeDiscoveryCache) {
      return;
    }

    const requestId = homeDiscoveryRequestIdRef.current + 1;
    homeDiscoveryRequestIdRef.current = requestId;

    setLoading(!hasCachedHomeDiscoverySeed);

    const fetchRecommendData = async () => {
      try {
        // 并行获取热门电影、热门剧集、热门综艺和番剧日历
        const [moviesRes, tvShowsRes, varietyShowsRes, bangumiRes] =
          await Promise.allSettled([
            getDoubanCategories({
              kind: 'movie',
              category: '热门',
              type: '全部',
            }),
            getDoubanCategories({ kind: 'tv', category: 'tv', type: 'tv' }),
            getDoubanCategories({ kind: 'tv', category: 'show', type: 'show' }),
            GetBangumiCalendarData(),
          ]);

        if (homeDiscoveryRequestIdRef.current !== requestId) {
          return;
        }

        if (moviesRes.status === 'rejected') {
          console.error('获取热门电影失败:', moviesRes.reason);
        }

        if (tvShowsRes.status === 'rejected') {
          console.error('获取热门剧集失败:', tvShowsRes.reason);
        }

        if (varietyShowsRes.status === 'rejected') {
          console.error('获取热门综艺失败:', varietyShowsRes.reason);
        }

        if (bangumiRes.status === 'rejected') {
          console.error('获取番剧日历失败:', bangumiRes.reason);
        }

        const nextHotMovies =
          moviesRes.status === 'fulfilled' && moviesRes.value.code === 200
            ? moviesRes.value.list
            : cachedHomeDiscoveryEntry?.hotMovies ?? [];
        const nextHotTvShows =
          tvShowsRes.status === 'fulfilled' && tvShowsRes.value.code === 200
            ? tvShowsRes.value.list
            : cachedHomeDiscoveryEntry?.hotTvShows ?? [];
        const nextHotVarietyShows =
          varietyShowsRes.status === 'fulfilled' &&
          varietyShowsRes.value.code === 200
            ? varietyShowsRes.value.list
            : cachedHomeDiscoveryEntry?.hotVarietyShows ?? [];
        const nextBangumiCalendarData =
          bangumiRes.status === 'fulfilled'
            ? bangumiRes.value
            : cachedHomeDiscoveryEntry?.bangumiCalendarData ?? [];

        setHotMovies(nextHotMovies);
        setHotTvShows(nextHotTvShows);
        setHotVarietyShows(nextHotVarietyShows);
        setBangumiCalendarData(nextBangumiCalendarData);

        if (
          moviesRes.status === 'fulfilled' ||
          tvShowsRes.status === 'fulfilled' ||
          varietyShowsRes.status === 'fulfilled' ||
          bangumiRes.status === 'fulfilled'
        ) {
          setHomeDiscoveryEntry(
            buildHomeDiscoveryCacheEntry({
              hotMovies: nextHotMovies,
              hotTvShows: nextHotTvShows,
              hotVarietyShows: nextHotVarietyShows,
              bangumiCalendarData: nextBangumiCalendarData,
              updatedAt: Date.now(),
            })
          );
        }
      } catch (error) {
        console.error('获取推荐数据失败:', error);
      } finally {
        if (homeDiscoveryRequestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    };

    void fetchRecommendData();
  }, [
    cachedHomeDiscoveryEntry,
    hasCachedHomeDiscoverySeed,
    hasDiscoveryCacheHydrated,
    hasFreshHomeDiscoveryCache,
    setHomeDiscoveryEntry,
  ]);

  // 处理收藏数据更新的函数
  const updateFavoriteItems = async (allFavorites: Record<string, any>) => {
    const allPlayRecords = await getAllPlayRecords();

    // 根据保存时间排序（从近到远）
    const sorted = Object.entries(allFavorites)
      .sort(([, a], [, b]) => b.save_time - a.save_time)
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);

        // 查找对应的播放记录，获取当前集数
        const playRecord = allPlayRecords[key];
        const currentEpisode = playRecord?.index;

        return {
          id,
          source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode,
          search_title: fav?.search_title,
          playback_mode: fav?.playback_mode,
          offline_content_id: fav?.offline_content_id,
          is_adult: fav?.is_adult,
          origin: fav?.origin,
        } as FavoriteItem;
      });
    setFavoriteItems(sorted);
  };

  const visibleFavoriteItems = useMemo(
    () =>
      adultContentFilterEnabled
        ? favoriteItems.filter((item) => {
            if (item.origin === 'live') {
              return true;
            }

            const offlineContent = item.offline_content_id
              ? downloadedLibrary[item.offline_content_id]
              : undefined;
            if (offlineContent) {
              return !isAdultDownloadedContent(offlineContent);
            }

            return !isAdultLibraryEntry(item);
          })
        : favoriteItems,
    [adultContentFilterEnabled, downloadedLibrary, favoriteItems]
  );

  // 当切换到收藏夹时加载收藏数据
  useEffect(() => {
    if (activeTab !== 'favorites') return;

    const loadFavorites = async () => {
      const allFavorites = await getAllFavorites();
      await updateFavoriteItems(allFavorites);
    };

    loadFavorites();

    // 监听收藏更新事件
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        updateFavoriteItems(newFavorites);
      }
    );

    return unsubscribe;
  }, [activeTab]);

  const handleCloseAnnouncement = (announcement: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', announcement); // 记录已查看弹窗
  };

  return (
    <PageLayout>
      <div className='overflow-visible px-3 py-5 sm:px-10 sm:py-8 md:px-10 md:pt-5'>
        {/* 顶部 Tab 切换 */}
        <div className='mb-10 flex justify-center'>
          <CapsuleSwitch
            options={[
              { label: '首页', value: 'home' },
              { label: '收藏夹', value: 'favorites' },
            ]}
            active={activeTab}
            onChange={(value) => setActiveTab(value as 'home' | 'favorites')}
          />
        </div>

        <div className='mx-auto max-w-[1420px]'>
          {activeTab === 'favorites' ? (
            // 收藏夹视图
            <section className='mb-10'>
              <div className='mb-5 flex items-center justify-between'>
                <h2 className='luna-section-title'>我的收藏</h2>
                {visibleFavoriteItems.length > 0 && (
                  <button
                    className='luna-section-action'
                    onClick={async () => {
                      await clearAllFavorites();
                      setFavoriteItems([]);
                    }}
                  >
                    清空
                  </button>
                )}
              </div>
              <div className='grid grid-cols-3 justify-start gap-x-3 gap-y-12 px-0 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-6 sm:gap-y-14'>
                {visibleFavoriteItems.map((item) => (
                  <div key={item.id + item.source} className='w-full'>
                    <VideoCard
                      query={item.search_title}
                      {...item}
                      from='favorite'
                      playbackMode={item.playback_mode}
                      offlineContentId={item.offline_content_id}
                      type={item.episodes > 1 ? 'tv' : ''}
                    />
                  </div>
                ))}
                {visibleFavoriteItems.length === 0 && (
                  <div className='luna-empty-state col-span-full px-6 py-10 text-center text-sm'>
                    暂无收藏内容
                  </div>
                )}
              </div>
            </section>
          ) : (
            // 首页视图
            <>
              {/* 继续观看 */}
              <ContinueWatching />

              {/* 热门电影 */}
              {loading || filteredHotMovies.length > 0 ? (
                <section className='mb-10'>
                  <div className='mb-5 flex items-center justify-between'>
                    <h2 className='luna-section-title'>热门电影</h2>
                    <Link
                      href='/douban?type=movie'
                      className='luna-section-action'
                    >
                      查看更多
                      <ChevronRight className='w-4 h-4 ml-1' />
                    </Link>
                  </div>
                  <ScrollableRow>
                    {loading
                      ? Array.from({ length: 8 }).map((_, index) => (
                          <div
                            key={index}
                            className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                          >
                            <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                              <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                            </div>
                            <div className='mt-2 h-4 rounded bg-gray-200 animate-pulse dark:bg-gray-800'></div>
                          </div>
                        ))
                      : filteredHotMovies.map((movie, index) => (
                          <div
                            key={index}
                            className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                          >
                            <VideoCard
                              from='douban'
                              title={movie.title}
                              poster={movie.poster}
                              douban_id={Number(movie.id)}
                              rate={movie.rate}
                              year={movie.year}
                              type='movie'
                            />
                          </div>
                        ))}
                  </ScrollableRow>
                </section>
              ) : null}

              {/* 热门剧集 */}
              {loading || filteredHotTvShows.length > 0 ? (
                <section className='mb-10'>
                  <div className='mb-5 flex items-center justify-between'>
                    <h2 className='luna-section-title'>热门剧集</h2>
                    <Link
                      href='/douban?type=tv'
                      className='luna-section-action'
                    >
                      查看更多
                      <ChevronRight className='w-4 h-4 ml-1' />
                    </Link>
                  </div>
                  <ScrollableRow>
                    {loading
                      ? Array.from({ length: 8 }).map((_, index) => (
                          <div
                            key={index}
                            className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                          >
                            <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                              <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                            </div>
                            <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                          </div>
                        ))
                      : filteredHotTvShows.map((show, index) => (
                          <div
                            key={index}
                            className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                          >
                            <VideoCard
                              from='douban'
                              title={show.title}
                              poster={show.poster}
                              douban_id={Number(show.id)}
                              rate={show.rate}
                              year={show.year}
                            />
                          </div>
                        ))}
                  </ScrollableRow>
                </section>
              ) : null}

              {/* 每日新番放送 */}
              {loading || filteredTodayBangumiItems.length > 0 ? (
                <section className='mb-10'>
                  <div className='mb-5 flex items-center justify-between'>
                    <h2 className='luna-section-title'>新番放送</h2>
                    <Link
                      href='/douban?type=anime'
                      className='luna-section-action'
                    >
                      查看更多
                      <ChevronRight className='w-4 h-4 ml-1' />
                    </Link>
                  </div>
                  <ScrollableRow>
                    {loading
                      ? Array.from({ length: 8 }).map((_, index) => (
                          <div
                            key={index}
                            className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                          >
                            <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                              <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                            </div>
                            <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                          </div>
                        ))
                      : filteredTodayBangumiItems.map((anime, index) => (
                          <div
                            key={`${anime.id}-${index}`}
                            className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                          >
                            <VideoCard
                              from='douban'
                              title={anime.name_cn || anime.name}
                              poster={
                                anime.images.large ||
                                anime.images.common ||
                                anime.images.medium ||
                                anime.images.small ||
                                anime.images.grid
                              }
                              douban_id={anime.id}
                              rate={anime.rating?.score?.toFixed(1) || ''}
                              year={anime.air_date?.split('-')?.[0] || ''}
                              isBangumi={true}
                            />
                          </div>
                        ))}
                  </ScrollableRow>
                </section>
              ) : null}

              {/* 热门综艺 */}
              {loading || filteredHotVarietyShows.length > 0 ? (
                <section className='mb-10'>
                  <div className='mb-5 flex items-center justify-between'>
                    <h2 className='luna-section-title'>热门综艺</h2>
                    <Link
                      href='/douban?type=show'
                      className='luna-section-action'
                    >
                      查看更多
                      <ChevronRight className='w-4 h-4 ml-1' />
                    </Link>
                  </div>
                  <ScrollableRow>
                    {loading
                      ? Array.from({ length: 8 }).map((_, index) => (
                          <div
                            key={index}
                            className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                          >
                            <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                              <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                            </div>
                            <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                          </div>
                        ))
                      : filteredHotVarietyShows.map((show, index) => (
                          <div
                            key={index}
                            className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                          >
                            <VideoCard
                              from='douban'
                              title={show.title}
                              poster={show.poster}
                              douban_id={Number(show.id)}
                              rate={show.rate}
                              year={show.year}
                            />
                          </div>
                        ))}
                  </ScrollableRow>
                </section>
              ) : null}

              {!loading && !hasVisibleHomeRecommendations ? (
                <section className='luna-empty-state mb-10 px-6 py-14 text-center text-sm'>
                  当前评分过滤条件下暂无可展示推荐
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
      {announcement && showAnnouncement && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-md transition-opacity duration-300 dark:bg-[#030915]/65 ${
            showAnnouncement ? '' : 'opacity-0 pointer-events-none'
          }`}
          onTouchStart={(e) => {
            // 如果点击的是背景区域，阻止触摸事件冒泡，防止背景滚动
            if (e.target === e.currentTarget) {
              e.preventDefault();
            }
          }}
          onTouchMove={(e) => {
            // 如果触摸的是背景区域，阻止触摸移动，防止背景滚动
            if (e.target === e.currentTarget) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onTouchEnd={(e) => {
            // 如果触摸的是背景区域，阻止触摸结束事件，防止背景滚动
            if (e.target === e.currentTarget) {
              e.preventDefault();
            }
          }}
          style={{
            touchAction: 'none', // 禁用所有触摸操作
          }}
        >
          <div
            className='luna-popover w-full max-w-md rounded-[1.75rem] p-6 transition-all duration-300 hover:shadow-2xl'
            onTouchMove={(e) => {
              // 允许公告内容区域正常滚动，阻止事件冒泡到外层
              e.stopPropagation();
            }}
            style={{
              touchAction: 'auto', // 允许内容区域的正常触摸操作
            }}
          >
            <div className='flex justify-between items-start mb-4'>
              <h3 className='border-b border-[var(--luna-accent)] pb-1 text-2xl font-bold tracking-tight text-[var(--luna-copy-strong)]'>
                提示
              </h3>
              <button
                onClick={() => handleCloseAnnouncement(announcement)}
                className='text-[var(--luna-copy-muted)] transition-colors hover:text-[var(--luna-copy-strong)]'
                aria-label='关闭'
              ></button>
            </div>
            <div className='mb-6'>
              <div className='relative mb-4 overflow-hidden rounded-[1.25rem] border border-[var(--luna-card-border)] bg-[var(--luna-card-fill)] px-4 py-4'>
                <div className='absolute inset-y-0 left-0 w-1.5 bg-[var(--luna-accent)]'></div>
                <p className='ml-2 leading-relaxed text-[var(--luna-copy-muted)]'>
                  {announcement}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement)}
              className='w-full rounded-[1rem] bg-[var(--luna-accent)] px-4 py-3 font-medium text-white shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg'
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}
