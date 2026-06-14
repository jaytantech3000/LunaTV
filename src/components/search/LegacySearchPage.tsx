/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any,@typescript-eslint/no-non-null-assertion,no-empty */
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import {
  filterItemsByMinimumRating,
  passesGlobalRatingFilter,
} from '@/lib/rating-filter';
import {
  type SearchHistoryEntry,
  type SearchHistoryMode,
} from '@/lib/search-history';
import { SearchResult } from '@/lib/types';

import {
  buildDefaultDoubanAggregationRequests,
  DOUBAN_AGGREGATE_GRID_CLASS_NAME,
  DoubanAggregateItem,
  mapDoubanAggregateItems,
  mergeDoubanAggregateItems,
  sortDoubanAggregateItems,
} from '@/components/search/doubanAggregationData';
import SearchPageScaffold from '@/components/search/SearchPageScaffold';
import SearchSectionHeading from '@/components/search/SearchSectionHeading';
import SearchResultFilter, {
  SearchFilterCategory,
} from '@/components/SearchResultFilter';
import SearchSuggestions from '@/components/SearchSuggestions';
import VideoCard, { VideoCardHandle } from '@/components/VideoCard';
import VirtualGrid from '@/components/VirtualGrid';

import { useGlobalRatingFilterStore } from '@/stores/useGlobalRatingFilterStore';
import {
  buildSearchCacheEntry,
  isSearchCacheEntryFresh,
  useSearchCacheStore,
} from '@/stores/useSearchCacheStore';

const GLOBAL_DOUBAN_AGGREGATE_CACHE_KEY = 'default-douban-aggregate';

interface LegacySearchPageClientProps {
  active?: boolean;
}

function LegacySearchPageClient({
  active = true,
}: LegacySearchPageClientProps) {
  // 搜索历史
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  // 返回顶部按钮显示状态
  const [showBackToTop, setShowBackToTop] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const currentQueryRef = useRef<string>('');
  const lastHandledQueryRef = useRef<string | null>(null);
  const discoveryRequestIdRef = useRef(0);
  const discoveryLoadInFlightRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [totalSources, setTotalSources] = useState(0);
  const [completedSources, setCompletedSources] = useState(0);
  const pendingResultsRef = useRef<SearchResult[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const [doubanRatings, setDoubanRatings] = useState<Record<string, string>>(
    {}
  );
  const pendingDoubanRatingIdsRef = useRef<Set<number>>(new Set());
  const resolvedDoubanRatingIdsRef = useRef<Set<number>>(new Set());
  const doubanRatingRequestTokenRef = useRef(0);
  const [useFluidSearch, setUseFluidSearch] = useState(true);
  const cachedDiscoveryEntry = useSearchCacheStore(
    (state) => state.globalDiscoveryEntries[GLOBAL_DOUBAN_AGGREGATE_CACHE_KEY]
  );
  const hasSearchCacheHydrated = useSearchCacheStore(
    (state) => state.hasHydrated
  );
  const setGlobalDiscoveryEntry = useSearchCacheStore(
    (state) => state.setGlobalDiscoveryEntry
  );
  const patchGlobalDiscoveryEntry = useSearchCacheStore(
    (state) => state.patchGlobalDiscoveryEntry
  );
  const hasFreshDiscoveryCache = isSearchCacheEntryFresh(cachedDiscoveryEntry);
  const doubanAggregateItems = cachedDiscoveryEntry?.items || [];
  const isDoubanAggregateLoading =
    active &&
    (!hasSearchCacheHydrated ||
      !cachedDiscoveryEntry ||
      cachedDiscoveryEntry.status === 'loading');
  const totalDoubanCollections = cachedDiscoveryEntry?.totalCollections || 0;
  const completedDoubanCollections =
    cachedDiscoveryEntry?.completedCollections || 0;
  const isGlobalRatingFilterEnabled = useGlobalRatingFilterStore(
    (state) => state.enabled
  );
  const globalMinimumRating = useGlobalRatingFilterStore(
    (state) => state.minimumRating
  );
  // 聚合卡片 refs 与聚合统计缓存
  const groupRefs = useRef<Map<string, React.RefObject<VideoCardHandle>>>(
    new Map()
  );
  const groupStatsRef = useRef<
    Map<
      string,
      { douban_id?: number; episodes?: number; source_names: string[] }
    >
  >(new Map());

  const getGroupRef = (key: string) => {
    let ref = groupRefs.current.get(key);
    if (!ref) {
      ref = React.createRef<VideoCardHandle>();
      groupRefs.current.set(key, ref);
    }
    return ref;
  };

  const computeGroupStats = (group: SearchResult[]) => {
    const episodes = (() => {
      const countMap = new Map<number, number>();
      group.forEach((g) => {
        const len = g.episodes?.length || 0;
        if (len > 0) countMap.set(len, (countMap.get(len) || 0) + 1);
      });
      let max = 0;
      let res = 0;
      countMap.forEach((v, k) => {
        if (v > max) {
          max = v;
          res = k;
        }
      });
      return res;
    })();
    const source_names = Array.from(
      new Set(group.map((g) => g.source_name).filter(Boolean))
    ) as string[];

    const douban_id = (() => {
      const countMap = new Map<number, number>();
      group.forEach((g) => {
        if (g.douban_id && g.douban_id > 0) {
          countMap.set(g.douban_id, (countMap.get(g.douban_id) || 0) + 1);
        }
      });
      let max = 0;
      let res: number | undefined;
      countMap.forEach((v, k) => {
        if (v > max) {
          max = v;
          res = k;
        }
      });
      return res;
    })();

    return { episodes, source_names, douban_id };
  };

  const buildSearchUrl = (query: string, modeOverride?: SearchHistoryMode) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    const normalizedQuery = query.trim().replace(/\s+/g, ' ');

    if (modeOverride) {
      nextParams.set('mode', modeOverride);
    }

    if (normalizedQuery) {
      nextParams.set('q', normalizedQuery);
    } else {
      nextParams.delete('q');
    }

    const nextQueryString = nextParams.toString();
    return nextQueryString ? `/search?${nextQueryString}` : '/search';
  };

  const resetDoubanRatings = () => {
    doubanRatingRequestTokenRef.current += 1;
    pendingDoubanRatingIdsRef.current.clear();
    resolvedDoubanRatingIdsRef.current.clear();
    setDoubanRatings({});
  };

  const getDoubanRating = (doubanId?: number) => {
    if (!doubanId || doubanId <= 0) {
      return '';
    }

    return doubanRatings[doubanId.toString()] || '';
  };
  // 过滤器：非聚合与聚合
  const [filterAll, setFilterAll] = useState<{
    source: string;
    title: string;
    year: string;
    yearOrder: 'none' | 'asc' | 'desc';
  }>({
    source: 'all',
    title: 'all',
    year: 'all',
    yearOrder: 'none',
  });
  const [filterAgg, setFilterAgg] = useState<{
    source: string;
    title: string;
    year: string;
    yearOrder: 'none' | 'asc' | 'desc';
  }>({
    source: 'all',
    title: 'all',
    year: 'all',
    yearOrder: 'none',
  });

  // 获取默认聚合设置：只读取用户本地设置，默认为 true
  const getDefaultAggregate = () => {
    if (typeof window !== 'undefined') {
      const userSetting = localStorage.getItem('defaultAggregateSearch');
      if (userSetting !== null) {
        return JSON.parse(userSetting);
      }
    }
    return true; // 默认启用聚合
  };

  const [viewMode, setViewMode] = useState<'agg' | 'all'>(() => {
    return getDefaultAggregate() ? 'agg' : 'all';
  });

  // 在“无排序”场景用于每个源批次的预排序：完全匹配标题优先，其次年份倒序，未知年份最后
  const sortBatchForNoOrder = (items: SearchResult[]) => {
    const q = currentQueryRef.current.trim();
    return items.slice().sort((a, b) => {
      const aExact = (a.title || '').trim() === q;
      const bExact = (b.title || '').trim() === q;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      const aNum = Number.parseInt(a.year as any, 10);
      const bNum = Number.parseInt(b.year as any, 10);
      const aValid = !Number.isNaN(aNum);
      const bValid = !Number.isNaN(bNum);
      if (aValid && !bValid) return -1;
      if (!aValid && bValid) return 1;
      if (aValid && bValid) return bNum - aNum; // 年份倒序
      return 0;
    });
  };

  // 简化的年份排序：unknown/空值始终在最后
  const compareYear = (
    aYear: string,
    bYear: string,
    order: 'none' | 'asc' | 'desc'
  ) => {
    // 如果是无排序状态，返回0（保持原顺序）
    if (order === 'none') return 0;

    // 处理空值和unknown
    const aIsEmpty = !aYear || aYear === 'unknown';
    const bIsEmpty = !bYear || bYear === 'unknown';

    if (aIsEmpty && bIsEmpty) return 0;
    if (aIsEmpty) return 1; // a 在后
    if (bIsEmpty) return -1; // b 在后

    // 都是有效年份，按数字比较
    const aNum = parseInt(aYear, 10);
    const bNum = parseInt(bYear, 10);

    return order === 'asc' ? aNum - bNum : bNum - aNum;
  };

  // 聚合后的结果（按标题和年份分组）
  const aggregatedResults = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    const keyOrder: string[] = []; // 记录键出现的顺序

    searchResults.forEach((item) => {
      // 使用 title + year + type 作为键，year 必然存在，但依然兜底 'unknown'
      const key = `${item.title.replaceAll(' ', '')}-${
        item.year || 'unknown'
      }-${item.episodes.length === 1 ? 'movie' : 'tv'}`;
      const arr = map.get(key) || [];

      // 如果是新的键，记录其顺序
      if (arr.length === 0) {
        keyOrder.push(key);
      }

      arr.push(item);
      map.set(key, arr);
    });

    // 按出现顺序返回聚合结果
    return keyOrder.map(
      (key) => [key, map.get(key)!] as [string, SearchResult[]]
    );
  }, [searchResults]);

  // 当聚合结果变化时，如果某个聚合已存在，则调用其卡片 ref 的 set 方法增量更新
  useEffect(() => {
    aggregatedResults.forEach(([mapKey, group]) => {
      const stats = computeGroupStats(group);
      const prev = groupStatsRef.current.get(mapKey);
      if (!prev) {
        // 第一次出现，记录初始值，不调用 ref（由初始 props 渲染）
        groupStatsRef.current.set(mapKey, stats);
        return;
      }
      // 对比变化并调用对应的 set 方法
      const ref = groupRefs.current.get(mapKey);
      if (ref && ref.current) {
        if (prev.episodes !== stats.episodes) {
          ref.current.setEpisodes(stats.episodes);
        }
        const prevNames = (prev.source_names || []).join('|');
        const nextNames = (stats.source_names || []).join('|');
        if (prevNames !== nextNames) {
          ref.current.setSourceNames(stats.source_names);
        }
        if (prev.douban_id !== stats.douban_id) {
          ref.current.setDoubanId(stats.douban_id);
        }
        groupStatsRef.current.set(mapKey, stats);
      }
    });
  }, [aggregatedResults]);

  useEffect(() => {
    const idsToFetch = Array.from(
      new Set(
        searchResults
          .map((item) => item.douban_id)
          .filter((id): id is number => typeof id === 'number' && id > 0)
      )
    ).filter((id) => {
      const key = id.toString();
      return (
        !Object.prototype.hasOwnProperty.call(doubanRatings, key) &&
        !pendingDoubanRatingIdsRef.current.has(id) &&
        !resolvedDoubanRatingIdsRef.current.has(id)
      );
    });

    if (idsToFetch.length === 0) {
      return;
    }

    const requestToken = doubanRatingRequestTokenRef.current;
    const batchSize = 12;

    for (let index = 0; index < idsToFetch.length; index += batchSize) {
      const batch = idsToFetch.slice(index, index + batchSize);
      batch.forEach((id) => pendingDoubanRatingIdsRef.current.add(id));

      void (async () => {
        try {
          const response = await fetch(
            `/api/douban/ratings?ids=${batch.join(',')}`
          );

          if (!response.ok) {
            throw new Error('获取豆瓣评分失败');
          }

          const data = await response.json();
          const ratings =
            data?.ratings && typeof data.ratings === 'object'
              ? (data.ratings as Record<string, string>)
              : {};

          if (doubanRatingRequestTokenRef.current !== requestToken) {
            return;
          }

          if (Object.keys(ratings).length > 0) {
            startTransition(() => {
              setDoubanRatings((prev) => ({
                ...prev,
                ...ratings,
              }));
            });
          }
        } catch {
          // 评分加载失败时保留搜索结果，不阻塞页面使用
        } finally {
          if (doubanRatingRequestTokenRef.current === requestToken) {
            batch.forEach((id) => {
              pendingDoubanRatingIdsRef.current.delete(id);
              resolvedDoubanRatingIdsRef.current.add(id);
            });
          }
        }
      })();
    }
  }, [doubanRatings, searchResults]);

  // 构建筛选选项
  const filterOptions = useMemo(() => {
    const sourcesSet = new Map<string, string>();
    const titlesSet = new Set<string>();
    const yearsSet = new Set<string>();

    searchResults.forEach((item) => {
      if (item.source && item.source_name) {
        sourcesSet.set(item.source, item.source_name);
      }
      if (item.title) titlesSet.add(item.title);
      if (item.year) yearsSet.add(item.year);
    });

    const sourceOptions: { label: string; value: string }[] = [
      { label: '全部来源', value: 'all' },
      ...Array.from(sourcesSet.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ label, value })),
    ];

    const titleOptions: { label: string; value: string }[] = [
      { label: '全部标题', value: 'all' },
      ...Array.from(titlesSet.values())
        .sort((a, b) => a.localeCompare(b))
        .map((t) => ({ label: t, value: t })),
    ];

    // 年份: 将 unknown 放末尾
    const years = Array.from(yearsSet.values());
    const knownYears = years
      .filter((y) => y !== 'unknown')
      .sort((a, b) => parseInt(b) - parseInt(a));
    const hasUnknown = years.includes('unknown');
    const yearOptions: { label: string; value: string }[] = [
      { label: '全部年份', value: 'all' },
      ...knownYears.map((y) => ({ label: y, value: y })),
      ...(hasUnknown ? [{ label: '未知', value: 'unknown' }] : []),
    ];

    const categoriesAll: SearchFilterCategory[] = [
      { key: 'source', label: '来源', options: sourceOptions },
      { key: 'title', label: '标题', options: titleOptions },
      { key: 'year', label: '年份', options: yearOptions },
    ];

    const categoriesAgg: SearchFilterCategory[] = [
      { key: 'source', label: '来源', options: sourceOptions },
      { key: 'title', label: '标题', options: titleOptions },
      { key: 'year', label: '年份', options: yearOptions },
    ];

    return { categoriesAll, categoriesAgg };
  }, [searchResults]);

  // 非聚合：应用筛选与排序
  const filteredAllResults = useMemo(() => {
    const { source, title, year, yearOrder } = filterAll;
    const filtered = searchResults.filter((item) => {
      if (source !== 'all' && item.source !== source) return false;
      if (title !== 'all' && item.title !== title) return false;
      if (year !== 'all' && item.year !== year) return false;
      return true;
    });

    // 如果是无排序状态，直接返回过滤后的原始顺序
    if (yearOrder === 'none') {
      return filtered;
    }

    // 简化排序：1. 年份排序，2. 年份相同时精确匹配在前，3. 标题排序
    return filtered.sort((a, b) => {
      // 首先按年份排序
      const yearComp = compareYear(a.year, b.year, yearOrder);
      if (yearComp !== 0) return yearComp;

      // 年份相同时，精确匹配在前
      const aExactMatch = a.title === searchQuery.trim();
      const bExactMatch = b.title === searchQuery.trim();
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      // 最后按标题排序，正序时字母序，倒序时反字母序
      return yearOrder === 'asc'
        ? a.title.localeCompare(b.title)
        : b.title.localeCompare(a.title);
    });
  }, [searchResults, filterAll, searchQuery]);
  const visibleAllResults = useMemo(
    () =>
      filterItemsByMinimumRating(
        filteredAllResults,
        (item) =>
          item.douban_id ? doubanRatings[item.douban_id.toString()] || '' : '',
        isGlobalRatingFilterEnabled,
        globalMinimumRating
      ),
    [
      doubanRatings,
      filteredAllResults,
      globalMinimumRating,
      isGlobalRatingFilterEnabled,
    ]
  );

  // 聚合：应用筛选与排序
  const filteredAggResults = useMemo(() => {
    const { source, title, year, yearOrder } = filterAgg as any;
    const filtered = aggregatedResults.filter(([_, group]) => {
      const gTitle = group[0]?.title ?? '';
      const gYear = group[0]?.year ?? 'unknown';
      const hasSource =
        source === 'all' ? true : group.some((item) => item.source === source);
      if (!hasSource) return false;
      if (title !== 'all' && gTitle !== title) return false;
      if (year !== 'all' && gYear !== year) return false;
      return true;
    });

    // 如果是无排序状态，保持按关键字+年份+类型出现的原始顺序
    if (yearOrder === 'none') {
      return filtered;
    }

    // 简化排序：1. 年份排序，2. 年份相同时精确匹配在前，3. 标题排序
    return filtered.sort((a, b) => {
      // 首先按年份排序
      const aYear = a[1][0].year;
      const bYear = b[1][0].year;
      const yearComp = compareYear(aYear, bYear, yearOrder);
      if (yearComp !== 0) return yearComp;

      // 年份相同时，精确匹配在前
      const aExactMatch = a[1][0].title === searchQuery.trim();
      const bExactMatch = b[1][0].title === searchQuery.trim();
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      // 最后按标题排序，正序时字母序，倒序时反字母序
      const aTitle = a[1][0].title;
      const bTitle = b[1][0].title;
      return yearOrder === 'asc'
        ? aTitle.localeCompare(bTitle)
        : bTitle.localeCompare(aTitle);
    });
  }, [aggregatedResults, filterAgg, searchQuery]);
  const visibleAggResults = useMemo(
    () =>
      filteredAggResults.filter(([_, group]) => {
        const doubanId = computeGroupStats(group).douban_id;
        return passesGlobalRatingFilter(
          doubanId ? doubanRatings[doubanId.toString()] || '' : '',
          isGlobalRatingFilterEnabled,
          globalMinimumRating
        );
      }),
    [
      doubanRatings,
      filteredAggResults,
      globalMinimumRating,
      isGlobalRatingFilterEnabled,
    ]
  );
  const visibleDoubanAggregateItems = useMemo(
    () =>
      filterItemsByMinimumRating(
        doubanAggregateItems,
        (item) => item.rate,
        isGlobalRatingFilterEnabled,
        globalMinimumRating
      ),
    [doubanAggregateItems, globalMinimumRating, isGlobalRatingFilterEnabled]
  );
  const visibleSearchResultsCount =
    viewMode === 'agg' ? visibleAggResults.length : visibleAllResults.length;

  useEffect(() => {
    if (!active) {
      return;
    }

    // 无搜索参数时聚焦搜索框
    !searchParams.get('q') && searchInputRef.current?.focus();

    // 初始加载搜索历史
    getSearchHistory().then(setSearchHistory);

    // 读取流式搜索设置
    if (typeof window !== 'undefined') {
      const savedFluidSearch = localStorage.getItem('fluidSearch');
      const defaultFluidSearch =
        (window as any).RUNTIME_CONFIG?.FLUID_SEARCH !== false;
      if (savedFluidSearch !== null) {
        setUseFluidSearch(JSON.parse(savedFluidSearch));
      } else if (defaultFluidSearch !== undefined) {
        setUseFluidSearch(defaultFluidSearch);
      }
    }

    // 监听搜索历史更新事件
    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (newHistory: SearchHistoryEntry[]) => {
        setSearchHistory(newHistory);
      }
    );

    // 获取滚动位置的函数 - 专门针对 body 滚动
    const getScrollTop = () => {
      return document.body.scrollTop || 0;
    };

    // 使用 requestAnimationFrame 持续检测滚动位置
    let isRunning = false;
    const checkScrollPosition = () => {
      if (!isRunning) return;

      const scrollTop = getScrollTop();
      const shouldShow = scrollTop > 300;
      setShowBackToTop(shouldShow);

      requestAnimationFrame(checkScrollPosition);
    };

    // 启动持续检测
    isRunning = true;
    checkScrollPosition();

    // 监听 body 元素的滚动事件
    const handleScroll = () => {
      const scrollTop = getScrollTop();
      setShowBackToTop(scrollTop > 300);
    };

    document.body.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      unsubscribe();
      isRunning = false; // 停止 requestAnimationFrame 循环

      // 移除 body 滚动事件监听器
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, [active, searchParams]);

  useEffect(() => {
    if (!active || !hasSearchCacheHydrated) {
      return;
    }

    if (hasFreshDiscoveryCache) {
      return;
    }

    if (
      cachedDiscoveryEntry?.status === 'loading' &&
      discoveryLoadInFlightRef.current
    ) {
      return;
    }

    const loadDoubanAggregate = async () => {
      const requestId = discoveryRequestIdRef.current + 1;
      discoveryRequestIdRef.current = requestId;
      discoveryLoadInFlightRef.current = true;
      const requests = buildDefaultDoubanAggregationRequests();
      const collectionMap = new Map<string, DoubanAggregateItem>();

      setGlobalDiscoveryEntry(
        GLOBAL_DOUBAN_AGGREGATE_CACHE_KEY,
        buildSearchCacheEntry({
          status: 'loading',
          items: cachedDiscoveryEntry?.items || [],
          totalCollections: requests.length,
          completedCollections: 0,
          updatedAt: Date.now(),
        })
      );

      try {
        await Promise.allSettled(
          requests.map(async (request) => {
            let nextItems: DoubanAggregateItem[] | undefined;

            try {
              const data = await request.load();

              if (discoveryRequestIdRef.current !== requestId) {
                return;
              }

              mergeDoubanAggregateItems(
                collectionMap,
                mapDoubanAggregateItems(data.list, request)
              );
              nextItems = sortDoubanAggregateItems(
                Array.from(collectionMap.values())
              );
            } finally {
              if (discoveryRequestIdRef.current === requestId) {
                patchGlobalDiscoveryEntry(
                  GLOBAL_DOUBAN_AGGREGATE_CACHE_KEY,
                  (previousEntry) =>
                    buildSearchCacheEntry({
                      ...previousEntry,
                      status: 'loading',
                      items: nextItems || previousEntry.items,
                      totalCollections: requests.length,
                      completedCollections: Math.min(
                        previousEntry.completedCollections + 1,
                        requests.length
                      ),
                      updatedAt: Date.now(),
                    })
                );
              }
            }
          })
        );

        if (discoveryRequestIdRef.current !== requestId) {
          return;
        }

        patchGlobalDiscoveryEntry(
          GLOBAL_DOUBAN_AGGREGATE_CACHE_KEY,
          (previousEntry) =>
            buildSearchCacheEntry({
              ...previousEntry,
              status: 'ready',
              totalCollections: requests.length,
              completedCollections: requests.length,
              updatedAt: Date.now(),
            })
        );
      } finally {
        if (discoveryRequestIdRef.current === requestId) {
          discoveryLoadInFlightRef.current = false;
        }
      }
    };

    void loadDoubanAggregate();
  }, [
    active,
    cachedDiscoveryEntry,
    hasFreshDiscoveryCache,
    hasSearchCacheHydrated,
    patchGlobalDiscoveryEntry,
    setGlobalDiscoveryEntry,
  ]);

  useEffect(() => {
    if (!active) {
      return;
    }

    // 当搜索参数变化时更新搜索状态
    const query = searchParams.get('q') || '';
    const normalizedQuery = query.trim();
    if (lastHandledQueryRef.current === normalizedQuery) {
      return;
    }

    lastHandledQueryRef.current = normalizedQuery;
    currentQueryRef.current = query.trim();

    if (query) {
      setSearchQuery(query);
      // 新搜索：关闭旧连接并清空结果
      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.close();
        } catch {}
        eventSourceRef.current = null;
      }
      setSearchResults([]);
      resetDoubanRatings();
      setTotalSources(0);
      setCompletedSources(0);
      // 清理缓冲
      pendingResultsRef.current = [];
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      setIsLoading(true);
      setShowResults(true);

      const trimmed = query.trim();

      // 每次搜索时重新读取设置，确保使用最新的配置
      let currentFluidSearch = useFluidSearch;
      if (typeof window !== 'undefined') {
        const savedFluidSearch = localStorage.getItem('fluidSearch');
        if (savedFluidSearch !== null) {
          currentFluidSearch = JSON.parse(savedFluidSearch);
        } else {
          const defaultFluidSearch =
            (window as any).RUNTIME_CONFIG?.FLUID_SEARCH !== false;
          currentFluidSearch = defaultFluidSearch;
        }
      }

      // 如果读取的配置与当前状态不同，更新状态
      if (currentFluidSearch !== useFluidSearch) {
        setUseFluidSearch(currentFluidSearch);
      }

      if (currentFluidSearch) {
        // 流式搜索：打开新的流式连接
        const es = new EventSource(
          `/api/search/ws?q=${encodeURIComponent(trimmed)}`
        );
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          if (!event.data) return;
          try {
            const payload = JSON.parse(event.data);
            if (currentQueryRef.current !== trimmed) return;
            switch (payload.type) {
              case 'start':
                setTotalSources(payload.totalSources || 0);
                setCompletedSources(0);
                break;
              case 'source_result': {
                setCompletedSources((prev) => prev + 1);
                if (
                  Array.isArray(payload.results) &&
                  payload.results.length > 0
                ) {
                  // 缓冲新增结果，节流刷入，避免频繁重渲染导致闪烁
                  const activeYearOrder =
                    viewMode === 'agg'
                      ? filterAgg.yearOrder
                      : filterAll.yearOrder;
                  const incoming: SearchResult[] =
                    activeYearOrder === 'none'
                      ? sortBatchForNoOrder(payload.results as SearchResult[])
                      : (payload.results as SearchResult[]);
                  pendingResultsRef.current.push(...incoming);
                  if (!flushTimerRef.current) {
                    flushTimerRef.current = window.setTimeout(() => {
                      const toAppend = pendingResultsRef.current;
                      pendingResultsRef.current = [];
                      startTransition(() => {
                        setSearchResults((prev) => prev.concat(toAppend));
                      });
                      flushTimerRef.current = null;
                    }, 80);
                  }
                }
                break;
              }
              case 'source_error':
                setCompletedSources((prev) => prev + 1);
                break;
              case 'complete':
                setCompletedSources(payload.completedSources || totalSources);
                // 完成前确保将缓冲写入
                if (pendingResultsRef.current.length > 0) {
                  const toAppend = pendingResultsRef.current;
                  pendingResultsRef.current = [];
                  if (flushTimerRef.current) {
                    clearTimeout(flushTimerRef.current);
                    flushTimerRef.current = null;
                  }
                  startTransition(() => {
                    setSearchResults((prev) => prev.concat(toAppend));
                  });
                }
                setIsLoading(false);
                try {
                  es.close();
                } catch {}
                if (eventSourceRef.current === es) {
                  eventSourceRef.current = null;
                }
                break;
            }
          } catch {}
        };

        es.onerror = () => {
          setIsLoading(false);
          // 错误时也清空缓冲
          if (pendingResultsRef.current.length > 0) {
            const toAppend = pendingResultsRef.current;
            pendingResultsRef.current = [];
            if (flushTimerRef.current) {
              clearTimeout(flushTimerRef.current);
              flushTimerRef.current = null;
            }
            startTransition(() => {
              setSearchResults((prev) => prev.concat(toAppend));
            });
          }
          try {
            es.close();
          } catch {}
          if (eventSourceRef.current === es) {
            eventSourceRef.current = null;
          }
        };
      } else {
        // 传统搜索：使用普通接口
        fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
          .then((response) => response.json())
          .then((data) => {
            if (currentQueryRef.current !== trimmed) return;

            if (data.results && Array.isArray(data.results)) {
              const activeYearOrder =
                viewMode === 'agg' ? filterAgg.yearOrder : filterAll.yearOrder;
              const results: SearchResult[] =
                activeYearOrder === 'none'
                  ? sortBatchForNoOrder(data.results as SearchResult[])
                  : (data.results as SearchResult[]);

              setSearchResults(results);
              setTotalSources(1);
              setCompletedSources(1);
            }
            setIsLoading(false);
          })
          .catch(() => {
            setIsLoading(false);
          });
      }
      setShowSuggestions(false);

      // 保存到搜索历史 (事件监听会自动更新界面)
      addSearchHistory(query, 'legacy');
    } else {
      setShowResults(false);
      setShowSuggestions(false);
      resetDoubanRatings();
    }
  }, [active, searchParams]);

  // 组件卸载时，关闭可能存在的连接
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.close();
        } catch {}
        eventSourceRef.current = null;
      }
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingResultsRef.current = [];
    };
  }, []);

  // 输入框内容变化时触发，显示搜索建议
  const handleInputChange = (value: string) => {
    setSearchQuery(value);

    if (value.trim()) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  // 搜索框聚焦时触发，显示搜索建议
  const handleInputFocus = () => {
    if (searchQuery.trim()) {
      setShowSuggestions(true);
    }
  };

  // 搜索表单提交时触发，处理搜索逻辑
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;

    // 回显搜索框
    setSearchQuery(trimmed);
    setIsLoading(true);
    setShowResults(true);
    setShowSuggestions(false);

    router.push(buildSearchUrl(trimmed));
    // 其余由 searchParams 变化的 effect 处理
  };

  const handleSuggestionSelect = (suggestion: string) => {
    setSearchQuery(suggestion);
    setShowSuggestions(false);

    // 自动执行搜索
    setIsLoading(true);
    setShowResults(true);

    router.push(buildSearchUrl(suggestion));
    // 其余由 searchParams 变化的 effect 处理
  };

  const handleClearSearchInput = () => {
    setSearchQuery('');
    setShowSuggestions(false);

    if (searchParams.get('q')) {
      router.replace(buildSearchUrl(''));
      return;
    }

    searchInputRef.current?.focus();
  };

  const handleSearchHistoryClick = (entry: SearchHistoryEntry) => {
    setSearchQuery(entry.keyword);
    router.push(buildSearchUrl(entry.keyword.trim(), entry.mode));
  };

  // 返回顶部功能
  const scrollToTop = () => {
    try {
      // 根据调试结果，真正的滚动容器是 document.body
      document.body.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } catch (error) {
      // 如果平滑滚动完全失败，使用立即滚动
      document.body.scrollTop = 0;
    }
  };

  return (
    <SearchPageScaffold
      mode='legacy'
      searchValue={searchQuery}
      onSearchValueChange={handleInputChange}
      onSearchSubmit={handleSearch}
      onClearSearch={handleClearSearchInput}
      searchInputRef={searchInputRef}
      searchInputId='searchInput-global'
      onSearchInputFocus={handleInputFocus}
      searchSuggestions={
        <SearchSuggestions
          query={searchQuery}
          isVisible={showSuggestions}
          onSelect={handleSuggestionSelect}
          onClose={() => setShowSuggestions(false)}
          onEnterKey={() => {
            const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
            if (!trimmed) return;

            setSearchQuery(trimmed);
            setIsLoading(true);
            setShowResults(true);
            setShowSuggestions(false);

            router.push(buildSearchUrl(trimmed));
          }}
        />
      }
      searchHistory={{
        items: searchHistory,
        visible: !showResults && searchHistory.length > 0,
        onSelect: handleSearchHistoryClick,
        onClear: () => clearSearchHistory(),
        onDelete: (entry) => deleteSearchHistory(entry),
      }}
      showBackToTop={showBackToTop}
      onScrollToTop={scrollToTop}
    >
      {showResults ? (
        <section className='mb-12'>
          <SearchSectionHeading
            title={
              <>
                搜索结果
                {totalSources > 0 && useFluidSearch ? (
                  <span className='ml-2 text-sm font-normal text-gray-500 dark:text-gray-400'>
                    {completedSources}/{totalSources}
                  </span>
                ) : null}
                {isLoading && useFluidSearch ? (
                  <span className='ml-2 inline-block align-middle'>
                    <span className='inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-green-500'></span>
                  </span>
                ) : null}
              </>
            }
          />
          <div className='mb-8 flex items-center justify-between gap-3'>
            <div className='min-w-0 flex-1'>
              {viewMode === 'agg' ? (
                <SearchResultFilter
                  categories={filterOptions.categoriesAgg}
                  values={filterAgg}
                  onChange={(v) => setFilterAgg(v as any)}
                />
              ) : (
                <SearchResultFilter
                  categories={filterOptions.categoriesAll}
                  values={filterAll}
                  onChange={(v) => setFilterAll(v as any)}
                />
              )}
            </div>
            <label className='flex shrink-0 cursor-pointer select-none items-center gap-2'>
              <span className='text-xs text-gray-700 dark:text-gray-300 sm:text-sm'>
                聚合
              </span>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='peer sr-only'
                  checked={viewMode === 'agg'}
                  onChange={() =>
                    setViewMode(viewMode === 'agg' ? 'all' : 'agg')
                  }
                />
                <div className='h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
                <div className='absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4'></div>
              </div>
            </label>
          </div>
          {visibleSearchResultsCount === 0 ? (
            isLoading ? (
              <div className='flex h-40 items-center justify-center'>
                <div className='h-8 w-8 animate-spin rounded-full border-b-2 border-green-500'></div>
              </div>
            ) : (
              <div className='py-8 text-center text-gray-500 dark:text-gray-400'>
                {searchResults.length > 0
                  ? '当前评分过滤条件下暂无相关结果'
                  : '未找到相关结果'}
              </div>
            )
          ) : (
            <div key={`search-results-${viewMode}`}>
              {viewMode === 'agg' ? (
                <VirtualGrid
                  items={visibleAggResults}
                  className='grid-cols-3 gap-x-2 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'
                  rowGapClass='pb-14 sm:pb-20'
                  estimateRowHeight={320}
                  renderItem={([mapKey, group]) => {
                    const title = group[0]?.title || '';
                    const poster = group[0]?.poster || '';
                    const year = group[0]?.year || 'unknown';
                    const { episodes, source_names, douban_id } =
                      computeGroupStats(group);
                    const type = episodes === 1 ? 'movie' : 'tv';

                    if (!groupStatsRef.current.has(mapKey)) {
                      groupStatsRef.current.set(mapKey, {
                        episodes,
                        source_names,
                        douban_id,
                      });
                    }

                    return (
                      <div key={`agg-${mapKey}`} className='w-full'>
                        <VideoCard
                          ref={getGroupRef(mapKey)}
                          from='search'
                          isAggregate={true}
                          title={title}
                          poster={poster}
                          year={year}
                          episodes={episodes}
                          source_names={source_names}
                          douban_id={douban_id}
                          rate={getDoubanRating(douban_id)}
                          query={
                            searchQuery.trim() !== title
                              ? searchQuery.trim()
                              : ''
                          }
                          type={type}
                        />
                      </div>
                    );
                  }}
                />
              ) : (
                <VirtualGrid
                  items={visibleAllResults}
                  className='grid-cols-3 gap-x-2 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'
                  rowGapClass='pb-14 sm:pb-20'
                  estimateRowHeight={320}
                  renderItem={(item) => (
                    <div
                      key={`all-${item.source}-${item.id}`}
                      className='w-full'
                    >
                      <VideoCard
                        id={item.id}
                        title={item.title}
                        poster={item.poster}
                        episodes={item.episodes.length}
                        source={item.source}
                        source_name={item.source_name}
                        douban_id={item.douban_id}
                        rate={getDoubanRating(item.douban_id)}
                        query={
                          searchQuery.trim() !== item.title
                            ? searchQuery.trim()
                            : ''
                        }
                        year={item.year}
                        from='search'
                        type={item.episodes.length > 1 ? 'tv' : 'movie'}
                      />
                    </div>
                  )}
                />
              )}
            </div>
          )}
        </section>
      ) : (
        <section className='mb-12'>
          <SearchSectionHeading
            title='豆瓣聚合'
            description={`当前聚合 ${visibleDoubanAggregateItems.length} 部内容`}
            meta={`豆瓣列表进度 ${completedDoubanCollections}/${totalDoubanCollections}`}
            actions={
              isDoubanAggregateLoading ? (
                <div className='inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400'>
                  <span className='inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-green-500' />
                  正在聚合豆瓣列表
                </div>
              ) : null
            }
          />
          {visibleDoubanAggregateItems.length === 0 ? (
            isDoubanAggregateLoading ? (
              <div className='flex h-40 items-center justify-center'>
                <div className='h-8 w-8 animate-spin rounded-full border-b-2 border-green-500'></div>
              </div>
            ) : (
              <div className='rounded-2xl border border-dashed border-gray-200 bg-white/70 px-6 py-14 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-400'>
                {doubanAggregateItems.length > 0
                  ? '当前评分过滤条件下暂无可展示的豆瓣聚合内容'
                  : '当前暂无可展示的豆瓣聚合内容'}
              </div>
            )
          ) : (
            <VirtualGrid
              items={visibleDoubanAggregateItems}
              className={DOUBAN_AGGREGATE_GRID_CLASS_NAME}
              rowGapClass='pb-14 sm:pb-20'
              estimateRowHeight={320}
              renderItem={(item) => (
                <div
                  key={`${item.playType}-${
                    item.id || `${item.title}-${item.year}`
                  }`}
                  className='w-full'
                >
                  <VideoCard
                    from='douban'
                    title={item.title}
                    poster={item.poster}
                    douban_id={Number(item.id)}
                    rate={item.rate}
                    year={item.year}
                    type={item.playType}
                  />
                </div>
              )}
            />
          )}
        </section>
      )}
    </SearchPageScaffold>
  );
}

interface LegacySearchPageProps {
  active?: boolean;
}

export default function LegacySearchPage({
  active = true,
}: LegacySearchPageProps) {
  return <LegacySearchPageClient active={active} />;
}
