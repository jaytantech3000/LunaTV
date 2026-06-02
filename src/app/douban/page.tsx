/* eslint-disable no-console,react-hooks/exhaustive-deps,@typescript-eslint/no-explicit-any */

'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { GetBangumiCalendarData } from '@/lib/bangumi.client';
import {
  getDoubanCategories,
  getDoubanList,
  getDoubanRecommends,
} from '@/lib/douban.client';
import { filterItemsByMinimumRating } from '@/lib/rating-filter';
import { DoubanItem, DoubanResult } from '@/lib/types';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import DoubanCustomSelector from '@/components/DoubanCustomSelector';
import DoubanSelector from '@/components/DoubanSelector';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';
import VirtualGrid from '@/components/VirtualGrid';

import {
  buildDoubanPageCacheEntry,
  isDiscoveryCacheEntryFresh,
  useDiscoveryCacheStore,
} from '@/stores/useDiscoveryCacheStore';
import { useGlobalRatingFilterStore } from '@/stores/useGlobalRatingFilterStore';

const LOAD_DEBOUNCE_MS = 24;
const DEFAULT_MULTI_LEVEL_VALUES = {
  type: 'all',
  region: 'all',
  year: 'all',
  platform: 'all',
  label: 'all',
  sort: 'T',
} as const;

function DoubanPageClient() {
  const searchParams = useSearchParams();
  const [doubanData, setDoubanData] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectorsReady, setSelectorsReady] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef<HTMLDivElement | null>(null);
  const debounceTimeoutRef = useRef<number | null>(null);
  const loadedPageIndexRef = useRef(-1);

  // 用于存储最新参数值的 refs
  const currentParamsRef = useRef({
    type: '',
    primarySelection: '',
    secondarySelection: '',
    multiLevelSelection: {} as Record<string, string>,
    selectedWeekday: '',
    currentPage: 0,
  });

  const type = searchParams.get('type') || 'movie';

  // 获取 runtimeConfig 中的自定义分类数据
  const [customCategories, setCustomCategories] = useState<
    Array<{ name: string; type: 'movie' | 'tv'; query: string }>
  >([]);

  // 选择器状态 - 完全独立，不依赖URL参数
  const [primarySelection, setPrimarySelection] = useState<string>(() => {
    if (type === 'movie') return '热门';
    if (type === 'tv' || type === 'show') return '最近热门';
    if (type === 'anime') return '每日放送';
    return '';
  });
  const [secondarySelection, setSecondarySelection] = useState<string>(() => {
    if (type === 'movie') return '全部';
    if (type === 'tv') return 'tv';
    if (type === 'show') return 'show';
    return '全部';
  });

  // MultiLevelSelector 状态
  const [multiLevelValues, setMultiLevelValues] = useState<
    Record<string, string>
  >({ ...DEFAULT_MULTI_LEVEL_VALUES });

  // 星期选择器状态
  const [selectedWeekday, setSelectedWeekday] = useState<string>('');
  const hasDiscoveryCacheHydrated = useDiscoveryCacheStore(
    (state) => state.hasHydrated
  );
  const setDoubanPageEntry = useDiscoveryCacheStore(
    (state) => state.setDoubanPageEntry
  );

  const normalizedSelectedWeekday =
    type === 'anime' && primarySelection === '每日放送'
      ? selectedWeekday || '-'
      : '-';
  const normalizedCacheFilters = useMemo(() => {
    if (type === 'anime' && primarySelection !== '每日放送') {
      return {
        type: 'all',
        region: multiLevelValues.region || 'all',
        year: multiLevelValues.year || 'all',
        platform: multiLevelValues.platform || 'all',
        label: multiLevelValues.label || 'all',
        sort: multiLevelValues.sort || 'T',
      };
    }

    if (primarySelection === '全部') {
      return {
        type: multiLevelValues.type || 'all',
        region: multiLevelValues.region || 'all',
        year: multiLevelValues.year || 'all',
        platform: multiLevelValues.platform || 'all',
        label: multiLevelValues.label || 'all',
        sort: multiLevelValues.sort || 'T',
      };
    }

    return { ...DEFAULT_MULTI_LEVEL_VALUES };
  }, [
    multiLevelValues.label,
    multiLevelValues.platform,
    multiLevelValues.region,
    multiLevelValues.sort,
    multiLevelValues.type,
    multiLevelValues.year,
    primarySelection,
    type,
  ]);
  const doubanCacheKey = useMemo(
    () =>
      [
        type,
        primarySelection,
        secondarySelection,
        normalizedSelectedWeekday,
        normalizedCacheFilters.type,
        normalizedCacheFilters.region,
        normalizedCacheFilters.year,
        normalizedCacheFilters.platform,
        normalizedCacheFilters.label,
        normalizedCacheFilters.sort,
      ].join(':'),
    [
      normalizedCacheFilters.label,
      normalizedCacheFilters.platform,
      normalizedCacheFilters.region,
      normalizedCacheFilters.sort,
      normalizedCacheFilters.type,
      normalizedCacheFilters.year,
      normalizedSelectedWeekday,
      primarySelection,
      secondarySelection,
      type,
    ]
  );
  const cachedDoubanPageEntry = useDiscoveryCacheStore(
    (state) => state.doubanPageEntries[doubanCacheKey]
  );
  const hasFreshDoubanPageCache = isDiscoveryCacheEntryFresh(
    cachedDoubanPageEntry
  );
  const hasCachedDoubanPageSeed =
    (cachedDoubanPageEntry?.items.length ?? 0) > 0;
  const isGlobalRatingFilterEnabled = useGlobalRatingFilterStore(
    (state) => state.enabled
  );
  const globalMinimumRating = useGlobalRatingFilterStore(
    (state) => state.minimumRating
  );
  const filteredDoubanData = useMemo(
    () =>
      filterItemsByMinimumRating(
        doubanData,
        (item) => item.rate,
        isGlobalRatingFilterEnabled,
        globalMinimumRating
      ),
    [doubanData, globalMinimumRating, isGlobalRatingFilterEnabled]
  );
  const shouldAutoLoadMoreForRatingFilter = useCallback(
    (items: DoubanItem[], nextHasMore: boolean) => {
      if (!isGlobalRatingFilterEnabled || !nextHasMore || items.length === 0) {
        return false;
      }

      return (
        filterItemsByMinimumRating(
          items,
          (item) => item.rate,
          isGlobalRatingFilterEnabled,
          globalMinimumRating
        ).length === 0
      );
    },
    [globalMinimumRating, isGlobalRatingFilterEnabled]
  );

  // 获取自定义分类数据
  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      setCustomCategories(runtimeConfig.CUSTOM_CATEGORIES);
    }
  }, []);

  // 同步最新参数值到 ref
  useEffect(() => {
    currentParamsRef.current = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
      currentPage,
    };
  }, [
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    currentPage,
  ]);

  // 在布局阶段同步切换 type，避免先渲染一帧旧/空状态导致闪烁
  useLayoutEffect(() => {
    setSelectorsReady(false);
    setLoading(true);
    setCurrentPage(0);
    setHasMore(true);
    setIsLoadingMore(false);
    loadedPageIndexRef.current = -1;

    if (type === 'custom' && customCategories.length > 0) {
      // 自定义分类模式：优先选择 movie，如果没有 movie 则选择 tv
      const types = Array.from(
        new Set(customCategories.map((cat) => cat.type))
      );
      if (types.length > 0) {
        // 优先选择 movie，如果没有 movie 则选择 tv
        let selectedType = types[0]; // 默认选择第一个
        if (types.includes('movie')) {
          selectedType = 'movie';
        } else {
          selectedType = 'tv';
        }
        setPrimarySelection(selectedType);

        // 设置选中类型的第一个分类的 query 作为二级选择
        const firstCategory = customCategories.find(
          (cat) => cat.type === selectedType
        );
        if (firstCategory) {
          setSecondarySelection(firstCategory.query);
        }
      }
    } else {
      // 原有逻辑
      if (type === 'movie') {
        setPrimarySelection('热门');
        setSecondarySelection('全部');
      } else if (type === 'tv') {
        setPrimarySelection('最近热门');
        setSecondarySelection('tv');
      } else if (type === 'show') {
        setPrimarySelection('最近热门');
        setSecondarySelection('show');
      } else if (type === 'anime') {
        setPrimarySelection('每日放送');
        setSecondarySelection('全部');
      } else {
        setPrimarySelection('');
        setSecondarySelection('全部');
      }
    }

    // 清空 MultiLevelSelector 状态
    setMultiLevelValues({ ...DEFAULT_MULTI_LEVEL_VALUES });
    setSelectedWeekday('');

    if (type !== 'custom' || customCategories.length > 0) {
      setSelectorsReady(true);
    }
  }, [type, customCategories]);

  // 先在布局阶段复用目标缓存，避免 tab 切换时内容区先闪成空白/骨架
  useLayoutEffect(() => {
    if (
      !hasDiscoveryCacheHydrated ||
      !cachedDoubanPageEntry ||
      !hasCachedDoubanPageSeed
    ) {
      return;
    }

    const shouldContinueLoadingFromCache = shouldAutoLoadMoreForRatingFilter(
      cachedDoubanPageEntry.items,
      cachedDoubanPageEntry.hasMore
    );

    loadedPageIndexRef.current = cachedDoubanPageEntry.loadedPageIndex;
    setDoubanData(cachedDoubanPageEntry.items);
    setCurrentPage(
      shouldContinueLoadingFromCache
        ? cachedDoubanPageEntry.loadedPageIndex + 1
        : cachedDoubanPageEntry.loadedPageIndex
    );
    setHasMore(cachedDoubanPageEntry.hasMore);
    setIsLoadingMore(false);
    setLoading(shouldContinueLoadingFromCache);
  }, [
    cachedDoubanPageEntry,
    hasCachedDoubanPageSeed,
    hasDiscoveryCacheHydrated,
    shouldAutoLoadMoreForRatingFilter,
  ]);

  // 生成骨架屏数据
  const skeletonData = Array.from({ length: 25 }, (_, index) => index);

  // 参数快照比较函数
  const isSnapshotEqual = useCallback(
    (
      snapshot1: {
        type: string;
        primarySelection: string;
        secondarySelection: string;
        multiLevelSelection: Record<string, string>;
        selectedWeekday: string;
        currentPage: number;
      },
      snapshot2: {
        type: string;
        primarySelection: string;
        secondarySelection: string;
        multiLevelSelection: Record<string, string>;
        selectedWeekday: string;
        currentPage: number;
      }
    ) => {
      return (
        snapshot1.type === snapshot2.type &&
        snapshot1.primarySelection === snapshot2.primarySelection &&
        snapshot1.secondarySelection === snapshot2.secondarySelection &&
        snapshot1.selectedWeekday === snapshot2.selectedWeekday &&
        snapshot1.currentPage === snapshot2.currentPage &&
        JSON.stringify(snapshot1.multiLevelSelection) ===
          JSON.stringify(snapshot2.multiLevelSelection)
      );
    },
    []
  );

  const isBaseSnapshotEqual = useCallback(
    (
      snapshot1: {
        type: string;
        primarySelection: string;
        secondarySelection: string;
        multiLevelSelection: Record<string, string>;
        selectedWeekday: string;
      },
      snapshot2: {
        type: string;
        primarySelection: string;
        secondarySelection: string;
        multiLevelSelection: Record<string, string>;
        selectedWeekday: string;
      }
    ) => {
      return (
        snapshot1.type === snapshot2.type &&
        snapshot1.primarySelection === snapshot2.primarySelection &&
        snapshot1.secondarySelection === snapshot2.secondarySelection &&
        snapshot1.selectedWeekday === snapshot2.selectedWeekday &&
        JSON.stringify(snapshot1.multiLevelSelection) ===
          JSON.stringify(snapshot2.multiLevelSelection)
      );
    },
    []
  );

  // 生成API请求参数的辅助函数
  const getRequestParams = useCallback(
    (pageStart: number) => {
      // 当type为tv或show时，kind统一为'tv'，category使用type本身
      if (type === 'tv' || type === 'show') {
        return {
          kind: 'tv' as const,
          category: type,
          type: secondarySelection,
          pageLimit: 25,
          pageStart,
        };
      }

      // 电影类型保持原逻辑
      return {
        kind: type as 'tv' | 'movie',
        category: primarySelection,
        type: secondarySelection,
        pageLimit: 25,
        pageStart,
      };
    },
    [type, primarySelection, secondarySelection]
  );

  // 防抖的数据加载函数
  const loadInitialData = useCallback(async () => {
    if (!hasDiscoveryCacheHydrated) {
      return;
    }

    // 创建当前参数的快照
    const requestSnapshot = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
    };

    if (
      hasFreshDoubanPageCache &&
      cachedDoubanPageEntry &&
      hasCachedDoubanPageSeed
    ) {
      if (
        shouldAutoLoadMoreForRatingFilter(
          cachedDoubanPageEntry.items,
          cachedDoubanPageEntry.hasMore
        )
      ) {
        setLoading(true);
        setCurrentPage(cachedDoubanPageEntry.loadedPageIndex + 1);
      } else {
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);
      setCurrentPage(0);
      loadedPageIndexRef.current = -1;
      setIsLoadingMore(false);

      let data: DoubanResult;

      if (type === 'custom') {
        // 自定义分类模式：根据选中的一级和二级选项获取对应的分类
        const selectedCategory = customCategories.find(
          (cat) =>
            cat.type === primarySelection && cat.query === secondarySelection
        );

        if (selectedCategory) {
          data = await getDoubanList({
            tag: selectedCategory.query,
            type: selectedCategory.type,
            pageLimit: 25,
            pageStart: 0,
          });
        } else {
          throw new Error('没有找到对应的分类');
        }
      } else if (type === 'anime' && primarySelection === '每日放送') {
        const calendarData = await GetBangumiCalendarData();
        const weekdayData = calendarData.find(
          (item) => item.weekday.en === selectedWeekday
        );
        if (weekdayData) {
          data = {
            code: 200,
            message: 'success',
            list: weekdayData.items.map((item) => ({
              id: item.id?.toString() || '',
              title: item.name_cn || item.name,
              poster:
                item.images.large ||
                item.images.common ||
                item.images.medium ||
                item.images.small ||
                item.images.grid,
              rate: item.rating?.score?.toFixed(1) || '',
              year: item.air_date?.split('-')?.[0] || '',
            })),
          };
        } else {
          throw new Error('没有找到对应的日期');
        }
      } else if (type === 'anime') {
        data = await getDoubanRecommends({
          kind: primarySelection === '番剧' ? 'tv' : 'movie',
          pageLimit: 25,
          pageStart: 0,
          category: '动画',
          format: primarySelection === '番剧' ? '电视剧' : '',
          region: multiLevelValues.region
            ? (multiLevelValues.region as string)
            : '',
          year: multiLevelValues.year ? (multiLevelValues.year as string) : '',
          platform: multiLevelValues.platform
            ? (multiLevelValues.platform as string)
            : '',
          sort: multiLevelValues.sort ? (multiLevelValues.sort as string) : '',
          label: multiLevelValues.label
            ? (multiLevelValues.label as string)
            : '',
        });
      } else if (primarySelection === '全部') {
        data = await getDoubanRecommends({
          kind: type === 'show' ? 'tv' : (type as 'tv' | 'movie'),
          pageLimit: 25,
          pageStart: 0, // 初始数据加载始终从第一页开始
          category: multiLevelValues.type
            ? (multiLevelValues.type as string)
            : '',
          format: type === 'show' ? '综艺' : type === 'tv' ? '电视剧' : '',
          region: multiLevelValues.region
            ? (multiLevelValues.region as string)
            : '',
          year: multiLevelValues.year ? (multiLevelValues.year as string) : '',
          platform: multiLevelValues.platform
            ? (multiLevelValues.platform as string)
            : '',
          sort: multiLevelValues.sort ? (multiLevelValues.sort as string) : '',
          label: multiLevelValues.label
            ? (multiLevelValues.label as string)
            : '',
        });
      } else {
        data = await getDoubanCategories(getRequestParams(0));
      }

      if (data.code === 200) {
        // 检查参数是否仍然一致，如果一致才设置数据
        // 使用 ref 获取最新的当前值
        const currentSnapshot = {
          type: currentParamsRef.current.type,
          primarySelection: currentParamsRef.current.primarySelection,
          secondarySelection: currentParamsRef.current.secondarySelection,
          multiLevelSelection: currentParamsRef.current.multiLevelSelection,
          selectedWeekday: currentParamsRef.current.selectedWeekday,
        };

        if (isBaseSnapshotEqual(requestSnapshot, currentSnapshot)) {
          const nextHasMore = data.list.length !== 0;
          const shouldContinueLoading = shouldAutoLoadMoreForRatingFilter(
            data.list,
            nextHasMore
          );

          setDoubanData(data.list);
          setCurrentPage(shouldContinueLoading ? 1 : 0);
          loadedPageIndexRef.current = 0;
          setHasMore(nextHasMore);
          if (data.list.length > 0) {
            setDoubanPageEntry(
              doubanCacheKey,
              buildDoubanPageCacheEntry({
                items: data.list,
                loadedPageIndex: 0,
                hasMore: nextHasMore,
                updatedAt: Date.now(),
              })
            );
          }
          setLoading(!shouldContinueLoading ? false : true);
        } else {
          console.log('参数不一致，不执行任何操作，避免设置过期数据');
        }
        // 如果参数不一致，不执行任何操作，避免设置过期数据
      } else {
        throw new Error(data.message || '获取数据失败');
      }
    } catch (err) {
      console.error(err);
      setLoading(false); // 发生错误时总是停止loading状态
    }
  }, [
    hasDiscoveryCacheHydrated,
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    hasFreshDoubanPageCache,
    getRequestParams,
    customCategories,
    isBaseSnapshotEqual,
    doubanCacheKey,
    setDoubanPageEntry,
    cachedDoubanPageEntry,
    hasCachedDoubanPageSeed,
    shouldAutoLoadMoreForRatingFilter,
  ]);

  // 只在选择器准备好后才加载数据
  useEffect(() => {
    // 只有在选择器准备好时才开始加载
    if (!hasDiscoveryCacheHydrated || !selectorsReady) {
      return;
    }

    // 清除之前的防抖定时器
    if (debounceTimeoutRef.current) {
      window.clearTimeout(debounceTimeoutRef.current);
    }

    // 保留轻量防抖来合并同一帧内的连续状态变化，但避免切换 tab 时的明显空等。
    debounceTimeoutRef.current = window.setTimeout(() => {
      loadInitialData();
    }, LOAD_DEBOUNCE_MS);

    // 清理函数
    return () => {
      if (debounceTimeoutRef.current) {
        window.clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [
    hasDiscoveryCacheHydrated,
    selectorsReady,
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    loadInitialData,
  ]);

  // 单独处理 currentPage 变化（加载更多）
  useEffect(() => {
    if (currentPage > 0) {
      if (currentPage <= loadedPageIndexRef.current) {
        return;
      }

      const fetchMoreData = async () => {
        // 创建当前参数的快照
        const requestSnapshot = {
          type,
          primarySelection,
          secondarySelection,
          multiLevelSelection: multiLevelValues,
          selectedWeekday,
          currentPage,
        };

        try {
          setIsLoadingMore(true);

          let data: DoubanResult;
          if (type === 'custom') {
            // 自定义分类模式：根据选中的一级和二级选项获取对应的分类
            const selectedCategory = customCategories.find(
              (cat) =>
                cat.type === primarySelection &&
                cat.query === secondarySelection
            );

            if (selectedCategory) {
              data = await getDoubanList({
                tag: selectedCategory.query,
                type: selectedCategory.type,
                pageLimit: 25,
                pageStart: currentPage * 25,
              });
            } else {
              throw new Error('没有找到对应的分类');
            }
          } else if (type === 'anime' && primarySelection === '每日放送') {
            // 每日放送模式下，不进行数据请求，返回空数据
            data = {
              code: 200,
              message: 'success',
              list: [],
            };
          } else if (type === 'anime') {
            data = await getDoubanRecommends({
              kind: primarySelection === '番剧' ? 'tv' : 'movie',
              pageLimit: 25,
              pageStart: currentPage * 25,
              category: '动画',
              format: primarySelection === '番剧' ? '电视剧' : '',
              region: multiLevelValues.region
                ? (multiLevelValues.region as string)
                : '',
              year: multiLevelValues.year
                ? (multiLevelValues.year as string)
                : '',
              platform: multiLevelValues.platform
                ? (multiLevelValues.platform as string)
                : '',
              sort: multiLevelValues.sort
                ? (multiLevelValues.sort as string)
                : '',
              label: multiLevelValues.label
                ? (multiLevelValues.label as string)
                : '',
            });
          } else if (primarySelection === '全部') {
            data = await getDoubanRecommends({
              kind: type === 'show' ? 'tv' : (type as 'tv' | 'movie'),
              pageLimit: 25,
              pageStart: currentPage * 25,
              category: multiLevelValues.type
                ? (multiLevelValues.type as string)
                : '',
              format: type === 'show' ? '综艺' : type === 'tv' ? '电视剧' : '',
              region: multiLevelValues.region
                ? (multiLevelValues.region as string)
                : '',
              year: multiLevelValues.year
                ? (multiLevelValues.year as string)
                : '',
              platform: multiLevelValues.platform
                ? (multiLevelValues.platform as string)
                : '',
              sort: multiLevelValues.sort
                ? (multiLevelValues.sort as string)
                : '',
              label: multiLevelValues.label
                ? (multiLevelValues.label as string)
                : '',
            });
          } else {
            data = await getDoubanCategories(
              getRequestParams(currentPage * 25)
            );
          }

          if (data.code === 200) {
            // 检查参数是否仍然一致，如果一致才设置数据
            // 使用 ref 获取最新的当前值
            const currentSnapshot = { ...currentParamsRef.current };

            if (isSnapshotEqual(requestSnapshot, currentSnapshot)) {
              let nextItems: DoubanItem[] = [];
              const nextHasMore = data.list.length !== 0;
              setDoubanData((prev) => {
                nextItems = [...prev, ...data.list];
                return nextItems;
              });
              setDoubanPageEntry(
                doubanCacheKey,
                buildDoubanPageCacheEntry({
                  items: nextItems,
                  loadedPageIndex: currentPage,
                  hasMore: nextHasMore,
                  updatedAt: Date.now(),
                })
              );
              loadedPageIndexRef.current = currentPage;
              setHasMore(nextHasMore);

              const shouldContinueLoading = shouldAutoLoadMoreForRatingFilter(
                nextItems,
                nextHasMore
              );

              if (shouldContinueLoading) {
                setLoading(true);
                setCurrentPage(currentPage + 1);
              } else {
                setLoading(false);
              }
            } else {
              console.log('参数不一致，不执行任何操作，避免设置过期数据');
            }
          } else {
            throw new Error(data.message || '获取数据失败');
          }
        } catch (err) {
          console.error(err);
        } finally {
          setIsLoadingMore(false);
        }
      };

      fetchMoreData();
    }
  }, [
    currentPage,
    type,
    primarySelection,
    secondarySelection,
    customCategories,
    multiLevelValues,
    selectedWeekday,
    doubanCacheKey,
    isSnapshotEqual,
    setDoubanPageEntry,
    shouldAutoLoadMoreForRatingFilter,
  ]);

  useEffect(() => {
    if (
      !hasDiscoveryCacheHydrated ||
      !selectorsReady ||
      loading ||
      isLoadingMore
    ) {
      return;
    }

    if (!shouldAutoLoadMoreForRatingFilter(doubanData, hasMore)) {
      return;
    }

    setLoading(true);
    setCurrentPage(loadedPageIndexRef.current + 1);
  }, [
    doubanData,
    hasDiscoveryCacheHydrated,
    hasMore,
    isLoadingMore,
    loading,
    selectorsReady,
    shouldAutoLoadMoreForRatingFilter,
  ]);

  // 设置滚动监听
  useEffect(() => {
    // 如果没有更多数据或正在加载，则不设置监听
    if (!hasMore || isLoadingMore || loading) {
      return;
    }

    // 确保 loadingRef 存在
    if (!loadingRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          setCurrentPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadingRef.current);
    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [hasMore, isLoadingMore, loading]);

  // 处理选择器变化
  const handlePrimaryChange = useCallback(
    (value: string) => {
      // 只有当值真正改变时才设置loading状态
      if (value !== primarySelection) {
        setLoading(true);
        // 立即重置页面状态，防止基于旧状态的请求
        setCurrentPage(0);
        setDoubanData([]);
        setHasMore(true);
        setIsLoadingMore(false);
        loadedPageIndexRef.current = -1;

        // 清空 MultiLevelSelector 状态
        setMultiLevelValues({ ...DEFAULT_MULTI_LEVEL_VALUES });

        // 如果是自定义分类模式，同时更新一级和二级选择器
        if (type === 'custom' && customCategories.length > 0) {
          const firstCategory = customCategories.find(
            (cat) => cat.type === value
          );
          if (firstCategory) {
            // 批量更新状态，避免多次触发数据加载
            setPrimarySelection(value);
            setSecondarySelection(firstCategory.query);
          } else {
            setPrimarySelection(value);
          }
        } else {
          // 电视剧和综艺切换到"最近热门"时，重置二级分类为第一个选项
          if ((type === 'tv' || type === 'show') && value === '最近热门') {
            setPrimarySelection(value);
            if (type === 'tv') {
              setSecondarySelection('tv');
            } else if (type === 'show') {
              setSecondarySelection('show');
            }
          } else {
            setPrimarySelection(value);
          }
        }
      }
    },
    [primarySelection, type, customCategories]
  );

  const handleSecondaryChange = useCallback(
    (value: string) => {
      // 只有当值真正改变时才设置loading状态
      if (value !== secondarySelection) {
        setLoading(true);
        // 立即重置页面状态，防止基于旧状态的请求
        setCurrentPage(0);
        setDoubanData([]);
        setHasMore(true);
        setIsLoadingMore(false);
        loadedPageIndexRef.current = -1;
        setSecondarySelection(value);
      }
    },
    [secondarySelection]
  );

  const handleMultiLevelChange = useCallback(
    (values: Record<string, string>) => {
      // 比较两个对象是否相同，忽略顺序
      const isEqual = (
        obj1: Record<string, string>,
        obj2: Record<string, string>
      ) => {
        const keys1 = Object.keys(obj1).sort();
        const keys2 = Object.keys(obj2).sort();

        if (keys1.length !== keys2.length) return false;

        return keys1.every((key) => obj1[key] === obj2[key]);
      };

      // 如果相同，则不设置loading状态
      if (isEqual(values, multiLevelValues)) {
        return;
      }

      setLoading(true);
      // 立即重置页面状态，防止基于旧状态的请求
      setCurrentPage(0);
      setDoubanData([]);
      setHasMore(true);
      setIsLoadingMore(false);
      loadedPageIndexRef.current = -1;
      setMultiLevelValues(values);
    },
    [multiLevelValues]
  );

  const handleWeekdayChange = useCallback((weekday: string) => {
    setSelectedWeekday(weekday);
  }, []);

  const getPageTitle = () => {
    // 根据 type 生成标题
    return type === 'movie'
      ? '电影'
      : type === 'tv'
      ? '电视剧'
      : type === 'anime'
      ? '动漫'
      : type === 'show'
      ? '综艺'
      : '自定义';
  };

  const getPageDescription = () => {
    if (type === 'anime' && primarySelection === '每日放送') {
      return '来自 Bangumi 番组计划的精选内容';
    }
    return '来自豆瓣的精选内容';
  };

  const getActivePath = () => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);

    const queryString = params.toString();
    const activePath = `/douban${queryString ? `?${queryString}` : ''}`;
    return activePath;
  };

  return (
    <PageLayout activePath={getActivePath()}>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* 页面标题和选择器 */}
        <div className='mb-6 sm:mb-8 space-y-4 sm:space-y-6'>
          {/* 页面标题 */}
          <div>
            <h1 className='text-2xl sm:text-3xl font-bold text-gray-800 mb-1 sm:mb-2 dark:text-gray-200'>
              {getPageTitle()}
            </h1>
            <p className='text-sm sm:text-base text-gray-600 dark:text-gray-400'>
              {getPageDescription()}
            </p>
          </div>

          {/* 选择器组件 */}
          {type !== 'custom' ? (
            <div className='bg-white/60 dark:bg-gray-800/40 rounded-2xl p-4 sm:p-6 border border-gray-200/30 dark:border-gray-700/30 backdrop-blur-sm'>
              <DoubanSelector
                type={type as 'movie' | 'tv' | 'show' | 'anime'}
                primarySelection={primarySelection}
                secondarySelection={secondarySelection}
                onPrimaryChange={handlePrimaryChange}
                onSecondaryChange={handleSecondaryChange}
                onMultiLevelChange={handleMultiLevelChange}
                onWeekdayChange={handleWeekdayChange}
              />
            </div>
          ) : (
            <div className='bg-white/60 dark:bg-gray-800/40 rounded-2xl p-4 sm:p-6 border border-gray-200/30 dark:border-gray-700/30 backdrop-blur-sm'>
              <DoubanCustomSelector
                customCategories={customCategories}
                primarySelection={primarySelection}
                secondarySelection={secondarySelection}
                onPrimaryChange={handlePrimaryChange}
                onSecondaryChange={handleSecondaryChange}
              />
            </div>
          )}
        </div>

        {/* 内容展示区域 */}
        <div className='max-w-[95%] mx-auto mt-8 overflow-visible'>
          {/* 内容网格 */}
          {!selectorsReady || (loading && filteredDoubanData.length === 0) ? (
            // 显示骨架屏
            <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'>
              {skeletonData.map((index) => (
                <DoubanCardSkeleton key={index} />
              ))}
            </div>
          ) : (
            // 显示实际数据
            <VirtualGrid
              items={filteredDoubanData}
              className='grid-cols-3 gap-x-2 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8'
              rowGapClass='pb-12 sm:pb-20'
              estimateRowHeight={320}
              renderItem={(item, index) => (
                <div key={`${item.title}-${index}`} className='w-full'>
                  <VideoCard
                    from='douban'
                    title={item.title}
                    poster={item.poster}
                    douban_id={Number(item.id)}
                    rate={item.rate}
                    year={item.year}
                    type={type === 'movie' ? 'movie' : ''} // 电影类型严格控制，tv 不控
                    isBangumi={
                      type === 'anime' && primarySelection === '每日放送'
                    }
                  />
                </div>
              )}
            />
          )}

          {/* 加载更多指示器 */}
          {hasMore && !loading && (
            <div
              ref={(el) => {
                if (el && el.offsetParent !== null) {
                  loadingRef.current = el;
                }
              }}
              className='flex justify-center mt-12 py-8'
            >
              {isLoadingMore && (
                <div className='flex items-center gap-2'>
                  <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-green-500'></div>
                  <span className='text-gray-600'>加载中...</span>
                </div>
              )}
            </div>
          )}

          {/* 没有更多数据提示 */}
          {!hasMore && filteredDoubanData.length > 0 && (
            <div className='text-center text-gray-500 py-8'>已加载全部内容</div>
          )}

          {/* 空状态 */}
          {!loading && filteredDoubanData.length === 0 && (
            <div className='text-center text-gray-500 py-8'>
              {doubanData.length > 0
                ? '当前评分过滤条件下暂无相关内容'
                : '暂无相关内容'}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

export default function DoubanPage() {
  return (
    <Suspense>
      <DoubanPageClient />
    </Suspense>
  );
}
