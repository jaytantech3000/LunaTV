/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import {
  getDoubanCategories,
  getDoubanList,
  getDoubanRecommends,
  getDoubanTitleSearch,
} from '@/lib/douban.client';
import { DoubanItem, DoubanResult } from '@/lib/types';

import {
  DOUBAN_AGGREGATE_GRID_CLASS_NAME,
  DoubanAggregateItem,
} from '@/components/search/doubanAggregationData';
import SearchPageScaffold from '@/components/search/SearchPageScaffold';
import SearchSectionHeading from '@/components/search/SearchSectionHeading';
import SearchQuickSelector, {
  SearchContentType,
  SearchCustomTag,
  SearchFacetOption,
} from '@/components/SearchQuickSelector';
import VideoCard from '@/components/VideoCard';
import VirtualGrid from '@/components/VirtualGrid';

import {
  buildSearchCacheEntry,
  isSearchCacheEntryFresh,
  useSearchCacheStore,
} from '@/stores/useSearchCacheStore';

const COLLECTION_PAGE_SIZE = 36;
const TITLE_SEARCH_PAGE_LIMIT = 45;

const CONTENT_TYPE_OPTIONS: SearchFacetOption[] = [
  { key: 'all', label: '全部' },
  { key: 'movie', label: '电影' },
  { key: 'series', label: '剧集' },
  { key: 'anime', label: '动画' },
  { key: 'variety', label: '综艺' },
  { key: 'documentary', label: '纪录片' },
];

const REGION_OPTIONS_BY_TYPE: Record<SearchContentType, SearchFacetOption[]> = {
  all: [
    { key: 'cn', label: '中国大陆' },
    { key: 'mandarin', label: '华语' },
    { key: 'western', label: '欧美' },
    { key: 'us', label: '美国' },
    { key: 'uk', label: '英国' },
    { key: 'jp', label: '日本' },
    { key: 'kr', label: '韩国' },
  ],
  movie: [
    { key: 'mandarin', label: '华语' },
    { key: 'western', label: '欧美' },
    { key: 'jp', label: '日本' },
    { key: 'kr', label: '韩国' },
    { key: 'cn', label: '中国大陆' },
    { key: 'us', label: '美国' },
    { key: 'uk', label: '英国' },
  ],
  series: [
    { key: 'cn', label: '国产' },
    { key: 'us', label: '美剧' },
    { key: 'uk', label: '英剧' },
    { key: 'jp', label: '日剧' },
    { key: 'kr', label: '韩剧' },
    { key: 'hk', label: '港剧' },
  ],
  anime: [
    { key: 'jp', label: '日本' },
    { key: 'cn', label: '国创' },
    { key: 'western', label: '欧美' },
  ],
  variety: [
    { key: 'cn', label: '国内' },
    { key: 'foreign', label: '国外' },
  ],
  documentary: [
    { key: 'cn', label: '国产' },
    { key: 'western', label: '海外' },
    { key: 'us', label: '美国' },
    { key: 'uk', label: '英国' },
    { key: 'jp', label: '日本' },
    { key: 'kr', label: '韩国' },
  ],
};

const GENRE_OPTIONS_BY_TYPE: Record<SearchContentType, SearchFacetOption[]> = {
  all: [],
  movie: [
    { key: 'comedy', label: '喜剧' },
    { key: 'romance', label: '爱情' },
    { key: 'action', label: '动作' },
    { key: 'sci-fi', label: '科幻' },
    { key: 'suspense', label: '悬疑' },
    { key: 'crime', label: '犯罪' },
    { key: 'thriller', label: '惊悚' },
    { key: 'fantasy', label: '奇幻' },
  ],
  series: [
    { key: 'drama', label: '剧情' },
    { key: 'comedy', label: '喜剧' },
    { key: 'romance', label: '爱情' },
    { key: 'suspense', label: '悬疑' },
    { key: 'costume', label: '古装' },
    { key: 'family', label: '家庭' },
    { key: 'crime', label: '犯罪' },
    { key: 'sci-fi', label: '科幻' },
  ],
  anime: [
    { key: 'healing', label: '治愈' },
    { key: 'sports', label: '运动' },
    { key: 'love', label: '恋爱' },
    { key: 'suspense', label: '悬疑' },
    { key: 'fantasy', label: '魔幻' },
    { key: 'sci_fi', label: '科幻' },
    { key: 'chinese_anime', label: '国漫' },
    { key: 'inspirational', label: '励志' },
  ],
  variety: [
    { key: 'reality', label: '真人秀' },
    { key: 'talkshow', label: '脱口秀' },
    { key: 'music', label: '音乐' },
    { key: 'musical', label: '歌舞' },
  ],
  documentary: [],
};

const GENERIC_REGION_VALUE_MAP: Record<string, string> = {
  cn: '中国大陆',
  mandarin: '华语',
  western: '欧美',
  us: '美国',
  uk: '英国',
  jp: '日本',
  kr: '韩国',
  hk: '中国香港',
  foreign: '欧美',
};

const MOVIE_CATEGORY_REGION_TYPE_MAP: Record<string, string> = {
  mandarin: '华语',
  western: '欧美',
  jp: '日本',
  kr: '韩国',
};

const TV_CATEGORY_REGION_TYPE_MAP: Record<string, string> = {
  cn: 'tv_domestic',
  us: 'tv_american',
  jp: 'tv_japanese',
  kr: 'tv_korean',
};

const SHOW_CATEGORY_REGION_TYPE_MAP: Record<string, string> = {
  cn: 'show_domestic',
  foreign: 'show_foreign',
};

interface RuntimeCustomCategory {
  name: string;
  type: 'movie' | 'tv';
  query: string;
}

interface CategoryRequestParams {
  kind: 'movie' | 'tv';
  category: string;
  type: string;
}

interface ListRequestParams {
  tag: string;
  type: 'movie' | 'tv';
}

interface RecommendRequestParams {
  kind: 'movie' | 'tv';
  category?: string;
  format?: string;
  label?: string;
  region?: string;
  sort?: string;
}

interface CollectionRequest {
  key: string;
  label: string;
  playType: 'movie' | 'tv';
  priority: number;
  load: () => Promise<DoubanResult>;
}
type DoubanSearchItem = DoubanAggregateItem;

function normalizeQueryValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\-_.·•・:：,，!！?？'"“”‘’`~()（）[\]【】{}<>《》/\\|]/g, '');
}

function parseRate(rate: string): number {
  const numericRate = Number.parseFloat(rate);
  return Number.isFinite(numericRate) ? numericRate : 0;
}

function parseYear(year: string): number {
  const numericYear = Number.parseInt(year, 10);
  return Number.isFinite(numericYear) ? numericYear : 0;
}

function isValidContentType(value: string | null): value is SearchContentType {
  return CONTENT_TYPE_OPTIONS.some((option) => option.key === value);
}

function getValidFacetKey(
  value: string | null,
  options: SearchFacetOption[]
): string {
  if (!value) {
    return '';
  }

  return options.some((option) => option.key === value) ? value : '';
}

function getFacetLabel(key: string, options: SearchFacetOption[]): string {
  return options.find((option) => option.key === key)?.label || '';
}

function isTvLikeContentType(contentType: SearchContentType): boolean {
  return ['series', 'anime', 'variety', 'documentary'].includes(contentType);
}

function isCustomTagCompatible(
  contentType: SearchContentType,
  tag: SearchCustomTag
): boolean {
  if (!tag.mediaType || contentType === 'all') {
    return true;
  }

  if (tag.mediaType === 'movie') {
    return contentType === 'movie';
  }

  return isTvLikeContentType(contentType);
}

function filterCustomTagsByContentType(
  contentType: SearchContentType,
  tags: SearchCustomTag[]
): SearchCustomTag[] {
  if (contentType === 'all') {
    return tags;
  }

  return tags.filter((tag) => isCustomTagCompatible(contentType, tag));
}

function getItemMergeKey(item: DoubanSearchItem): string {
  if (item.id) {
    return `${item.playType}:${item.id}`;
  }

  return `${item.playType}:${normalizeText(item.title)}:${item.year}`;
}

function scoreTitleMatch(title: string, query: string): number {
  if (!query) {
    return 0;
  }

  const normalizedTitle = normalizeText(title);
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return 0;
  }

  if (normalizedTitle === normalizedQuery) {
    return 400;
  }

  if (normalizedTitle.startsWith(normalizedQuery)) {
    return 260;
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return 180;
  }

  const lowerTitle = title.trim().toLowerCase();
  const lowerQuery = query.trim().toLowerCase();

  if (lowerTitle.startsWith(lowerQuery)) {
    return 120;
  }

  if (lowerTitle.includes(lowerQuery)) {
    return 80;
  }

  return -1;
}

function uniqueCollectionRequests(
  requests: CollectionRequest[]
): CollectionRequest[] {
  const seenKeys = new Set<string>();

  return requests.filter((request) => {
    if (seenKeys.has(request.key)) {
      return false;
    }

    seenKeys.add(request.key);
    return true;
  });
}

function makeCategoryRequest(
  key: string,
  label: string,
  playType: 'movie' | 'tv',
  priority: number,
  params: CategoryRequestParams
): CollectionRequest {
  return {
    key,
    label,
    playType,
    priority,
    load: () =>
      getDoubanCategories({
        ...params,
        pageLimit: COLLECTION_PAGE_SIZE,
        pageStart: 0,
      }),
  };
}

function makeListRequest(
  key: string,
  label: string,
  playType: 'movie' | 'tv',
  priority: number,
  params: ListRequestParams
): CollectionRequest {
  return {
    key,
    label,
    playType,
    priority,
    load: () =>
      getDoubanList({
        ...params,
        pageLimit: COLLECTION_PAGE_SIZE,
        pageStart: 0,
      }),
  };
}

function makeRecommendRequest(
  key: string,
  label: string,
  playType: 'movie' | 'tv',
  priority: number,
  params: RecommendRequestParams
): CollectionRequest {
  return {
    key,
    label,
    playType,
    priority,
    load: () =>
      getDoubanRecommends({
        ...params,
        pageLimit: COLLECTION_PAGE_SIZE,
        pageStart: 0,
      }),
  };
}

function mapDoubanItems(
  items: DoubanItem[],
  request: CollectionRequest
): DoubanSearchItem[] {
  return items.map((item) => ({
    ...item,
    playType: request.playType,
    bucketKeys: [request.key],
    bucketLabels: [request.label],
    priority: request.priority,
  }));
}

function mapTitleSearchItems(items: DoubanItem[]): DoubanSearchItem[] {
  return items.map((item, index) => ({
    ...item,
    playType: item.playType || 'movie',
    bucketKeys: ['title-search'],
    bucketLabels: ['豆瓣标题搜索'],
    priority: 100,
    searchRank: index,
  }));
}

function mergeIntoCollectionMap(
  collectionMap: Map<string, DoubanSearchItem>,
  items: DoubanSearchItem[]
): void {
  items.forEach((item) => {
    const mergeKey = getItemMergeKey(item);
    const existing = collectionMap.get(mergeKey);

    if (!existing) {
      collectionMap.set(mergeKey, {
        ...item,
        bucketKeys: [...item.bucketKeys],
        bucketLabels: [...item.bucketLabels],
      });
      return;
    }

    existing.bucketKeys = Array.from(
      new Set([...existing.bucketKeys, ...item.bucketKeys])
    );
    existing.bucketLabels = Array.from(
      new Set([...existing.bucketLabels, ...item.bucketLabels])
    );
    existing.priority = Math.max(existing.priority, item.priority);

    if (!existing.poster && item.poster) {
      existing.poster = item.poster;
    }

    if (!existing.year && item.year) {
      existing.year = item.year;
    }

    if (parseRate(item.rate) > parseRate(existing.rate)) {
      existing.rate = item.rate;
    }
  });
}

function buildMovieRecommendBuckets(
  region: string,
  category: string
): CollectionRequest[] {
  const scopeKey = `${region || 'all'}:${category || 'all'}`;

  return [
    makeRecommendRequest(
      `movie:discover:${scopeKey}`,
      '电影综合',
      'movie',
      84,
      {
        kind: 'movie',
        category,
        region,
        sort: 'T',
      }
    ),
    makeRecommendRequest(`movie:score:${scopeKey}`, '高分电影', 'movie', 92, {
      kind: 'movie',
      category,
      region,
      sort: 'S',
    }),
  ];
}

function buildSeriesRecommendBuckets(
  region: string,
  category: string
): CollectionRequest[] {
  const scopeKey = `${region || 'all'}:${category || 'all'}`;

  return [
    makeRecommendRequest(`series:discover:${scopeKey}`, '剧集综合', 'tv', 84, {
      kind: 'tv',
      category,
      format: '电视剧',
      region,
      sort: 'T',
    }),
    makeRecommendRequest(`series:score:${scopeKey}`, '高分剧集', 'tv', 92, {
      kind: 'tv',
      category,
      format: '电视剧',
      region,
      sort: 'S',
    }),
  ];
}

function buildVarietyRecommendBuckets(
  region: string,
  category: string
): CollectionRequest[] {
  const scopeKey = `${region || 'all'}:${category || 'all'}`;

  return [
    makeRecommendRequest(`variety:discover:${scopeKey}`, '综艺综合', 'tv', 84, {
      kind: 'tv',
      category,
      format: '综艺',
      region,
      sort: 'T',
    }),
    makeRecommendRequest(`variety:score:${scopeKey}`, '高分综艺', 'tv', 90, {
      kind: 'tv',
      category,
      format: '综艺',
      region,
      sort: 'S',
    }),
  ];
}

function buildAnimeRecommendBuckets(
  region: string,
  label: string
): CollectionRequest[] {
  const scopeKey = `${region || 'all'}:${label || 'all'}`;

  return [
    makeRecommendRequest(`anime:tv:${scopeKey}`, '番剧', 'tv', 88, {
      kind: 'tv',
      category: '动画',
      format: '电视剧',
      region,
      label,
      sort: 'T',
    }),
    makeRecommendRequest(`anime:movie:${scopeKey}`, '动画电影', 'movie', 86, {
      kind: 'movie',
      category: '动画',
      region,
      label,
      sort: 'T',
    }),
  ];
}

function buildDocumentaryRecommendBuckets(region: string): CollectionRequest[] {
  const scopeKey = region || 'all';

  return [
    makeRecommendRequest(`documentary:tv:${scopeKey}`, '纪录片剧集', 'tv', 88, {
      kind: 'tv',
      category: '纪录片',
      format: '电视剧',
      region,
      sort: 'T',
    }),
    makeRecommendRequest(
      `documentary:movie:${scopeKey}`,
      '纪录片电影',
      'movie',
      86,
      {
        kind: 'movie',
        category: '纪录片',
        region,
        sort: 'T',
      }
    ),
    makeRecommendRequest(
      `documentary:score:${scopeKey}`,
      '高分纪录片',
      'tv',
      92,
      {
        kind: 'tv',
        category: '纪录片',
        format: '电视剧',
        region,
        sort: 'S',
      }
    ),
  ];
}

function buildMovieBuckets(regionKey: string): CollectionRequest[] {
  if (!regionKey) {
    return [
      makeCategoryRequest('movie:hot', '热门电影', 'movie', 92, {
        kind: 'movie',
        category: '热门',
        type: '全部',
      }),
      makeCategoryRequest('movie:new', '最新电影', 'movie', 88, {
        kind: 'movie',
        category: '最新',
        type: '全部',
      }),
      makeCategoryRequest('movie:score', '豆瓣高分', 'movie', 96, {
        kind: 'movie',
        category: '豆瓣高分',
        type: '全部',
      }),
      makeCategoryRequest('movie:hidden', '冷门佳片', 'movie', 86, {
        kind: 'movie',
        category: '冷门佳片',
        type: '全部',
      }),
    ];
  }

  const categoryRegion = MOVIE_CATEGORY_REGION_TYPE_MAP[regionKey];

  if (categoryRegion) {
    return [
      makeCategoryRequest(
        `movie:hot:${regionKey}`,
        `${categoryRegion}热门`,
        'movie',
        92,
        {
          kind: 'movie',
          category: '热门',
          type: categoryRegion,
        }
      ),
      makeCategoryRequest(
        `movie:new:${regionKey}`,
        `${categoryRegion}最新`,
        'movie',
        88,
        {
          kind: 'movie',
          category: '最新',
          type: categoryRegion,
        }
      ),
      makeCategoryRequest(
        `movie:score:${regionKey}`,
        `${categoryRegion}高分`,
        'movie',
        96,
        {
          kind: 'movie',
          category: '豆瓣高分',
          type: categoryRegion,
        }
      ),
    ];
  }

  return buildMovieRecommendBuckets(
    GENERIC_REGION_VALUE_MAP[regionKey] || '',
    ''
  );
}

function buildSeriesBuckets(regionKey: string): CollectionRequest[] {
  if (!regionKey) {
    return [
      makeCategoryRequest('series:all', '热门剧集', 'tv', 92, {
        kind: 'tv',
        category: 'tv',
        type: 'tv',
      }),
      makeCategoryRequest('series:cn', '国产剧', 'tv', 90, {
        kind: 'tv',
        category: 'tv',
        type: 'tv_domestic',
      }),
      makeCategoryRequest('series:us', '美剧', 'tv', 88, {
        kind: 'tv',
        category: 'tv',
        type: 'tv_american',
      }),
      makeCategoryRequest('series:jp', '日剧', 'tv', 86, {
        kind: 'tv',
        category: 'tv',
        type: 'tv_japanese',
      }),
      makeCategoryRequest('series:kr', '韩剧', 'tv', 86, {
        kind: 'tv',
        category: 'tv',
        type: 'tv_korean',
      }),
    ];
  }

  const categoryRegion = TV_CATEGORY_REGION_TYPE_MAP[regionKey];
  const recommendRegion = GENERIC_REGION_VALUE_MAP[regionKey] || '';

  if (categoryRegion) {
    return [
      makeCategoryRequest(
        `series:region:${regionKey}`,
        getFacetLabel(regionKey, REGION_OPTIONS_BY_TYPE.series),
        'tv',
        90,
        {
          kind: 'tv',
          category: 'tv',
          type: categoryRegion,
        }
      ),
      makeRecommendRequest(
        `series:score:${regionKey}`,
        `${getFacetLabel(regionKey, REGION_OPTIONS_BY_TYPE.series)}高分`,
        'tv',
        94,
        {
          kind: 'tv',
          format: '电视剧',
          region: recommendRegion,
          sort: 'S',
        }
      ),
    ];
  }

  return buildSeriesRecommendBuckets(recommendRegion, '');
}

function buildVarietyBuckets(regionKey: string): CollectionRequest[] {
  if (!regionKey) {
    return [
      makeCategoryRequest('variety:all', '热门综艺', 'tv', 92, {
        kind: 'tv',
        category: 'show',
        type: 'show',
      }),
      makeCategoryRequest('variety:cn', '国内综艺', 'tv', 90, {
        kind: 'tv',
        category: 'show',
        type: 'show_domestic',
      }),
      makeCategoryRequest('variety:foreign', '国外综艺', 'tv', 88, {
        kind: 'tv',
        category: 'show',
        type: 'show_foreign',
      }),
    ];
  }

  const categoryRegion = SHOW_CATEGORY_REGION_TYPE_MAP[regionKey];
  const recommendRegion =
    regionKey === 'cn'
      ? GENERIC_REGION_VALUE_MAP.cn
      : GENERIC_REGION_VALUE_MAP.foreign;

  if (categoryRegion) {
    return [
      makeCategoryRequest(
        `variety:region:${regionKey}`,
        getFacetLabel(regionKey, REGION_OPTIONS_BY_TYPE.variety),
        'tv',
        90,
        {
          kind: 'tv',
          category: 'show',
          type: categoryRegion,
        }
      ),
      makeRecommendRequest(
        `variety:score:${regionKey}`,
        `${getFacetLabel(regionKey, REGION_OPTIONS_BY_TYPE.variety)}高分`,
        'tv',
        94,
        {
          kind: 'tv',
          format: '综艺',
          region: recommendRegion,
          sort: 'S',
        }
      ),
    ];
  }

  return buildVarietyRecommendBuckets(recommendRegion, '');
}

function buildAnimeBuckets(
  regionKey: string,
  label: string
): CollectionRequest[] {
  if (label) {
    return buildAnimeRecommendBuckets(
      regionKey ? GENERIC_REGION_VALUE_MAP[regionKey] || '' : '',
      label
    );
  }

  if (!regionKey) {
    return [
      makeCategoryRequest('anime:hot', '热门动画', 'tv', 92, {
        kind: 'tv',
        category: 'tv',
        type: 'tv_animation',
      }),
      makeRecommendRequest('anime:score', '高分番剧', 'tv', 90, {
        kind: 'tv',
        category: '动画',
        format: '电视剧',
        sort: 'S',
      }),
      makeRecommendRequest('anime:movie', '动画电影', 'movie', 88, {
        kind: 'movie',
        category: '动画',
        sort: 'T',
      }),
    ];
  }

  return buildAnimeRecommendBuckets(
    GENERIC_REGION_VALUE_MAP[regionKey] || '',
    ''
  );
}

function buildDocumentaryBuckets(regionKey: string): CollectionRequest[] {
  if (!regionKey) {
    return [
      makeCategoryRequest('documentary:hot', '热门纪录片', 'tv', 92, {
        kind: 'tv',
        category: 'tv',
        type: 'tv_documentary',
      }),
      makeRecommendRequest('documentary:movie:all', '纪录片电影', 'movie', 88, {
        kind: 'movie',
        category: '纪录片',
        sort: 'T',
      }),
      makeRecommendRequest('documentary:score:all', '高分纪录片', 'tv', 94, {
        kind: 'tv',
        category: '纪录片',
        format: '电视剧',
        sort: 'S',
      }),
    ];
  }

  return buildDocumentaryRecommendBuckets(
    GENERIC_REGION_VALUE_MAP[regionKey] || ''
  );
}

function buildAllDefaultBuckets(hasQuery: boolean): CollectionRequest[] {
  if (hasQuery) {
    return [
      makeCategoryRequest('all:movie:hot', '热门电影', 'movie', 92, {
        kind: 'movie',
        category: '热门',
        type: '全部',
      }),
      makeCategoryRequest('all:movie:new', '最新电影', 'movie', 88, {
        kind: 'movie',
        category: '最新',
        type: '全部',
      }),
      makeCategoryRequest('all:movie:score', '豆瓣高分电影', 'movie', 96, {
        kind: 'movie',
        category: '豆瓣高分',
        type: '全部',
      }),
      makeCategoryRequest('all:series:all', '热门剧集', 'tv', 92, {
        kind: 'tv',
        category: 'tv',
        type: 'tv',
      }),
      makeCategoryRequest('all:series:cn', '国产剧', 'tv', 90, {
        kind: 'tv',
        category: 'tv',
        type: 'tv_domestic',
      }),
      makeCategoryRequest('all:series:us', '美剧', 'tv', 88, {
        kind: 'tv',
        category: 'tv',
        type: 'tv_american',
      }),
      makeCategoryRequest('all:series:jp', '日剧', 'tv', 86, {
        kind: 'tv',
        category: 'tv',
        type: 'tv_japanese',
      }),
      makeCategoryRequest('all:series:kr', '韩剧', 'tv', 86, {
        kind: 'tv',
        category: 'tv',
        type: 'tv_korean',
      }),
      makeCategoryRequest('all:variety:all', '热门综艺', 'tv', 90, {
        kind: 'tv',
        category: 'show',
        type: 'show',
      }),
      makeCategoryRequest('all:anime:hot', '热门动画', 'tv', 88, {
        kind: 'tv',
        category: 'tv',
        type: 'tv_animation',
      }),
      makeRecommendRequest('all:anime:movie', '动画电影', 'movie', 86, {
        kind: 'movie',
        category: '动画',
        sort: 'T',
      }),
      makeCategoryRequest('all:documentary:hot', '热门纪录片', 'tv', 84, {
        kind: 'tv',
        category: 'tv',
        type: 'tv_documentary',
      }),
    ];
  }

  return [
    makeCategoryRequest('all:movie:hot', '热门电影', 'movie', 92, {
      kind: 'movie',
      category: '热门',
      type: '全部',
    }),
    makeCategoryRequest('all:movie:score', '豆瓣高分电影', 'movie', 96, {
      kind: 'movie',
      category: '豆瓣高分',
      type: '全部',
    }),
    makeCategoryRequest('all:series:all', '热门剧集', 'tv', 92, {
      kind: 'tv',
      category: 'tv',
      type: 'tv',
    }),
    makeCategoryRequest('all:variety:all', '热门综艺', 'tv', 90, {
      kind: 'tv',
      category: 'show',
      type: 'show',
    }),
    makeCategoryRequest('all:anime:hot', '热门动画', 'tv', 88, {
      kind: 'tv',
      category: 'tv',
      type: 'tv_animation',
    }),
    makeRecommendRequest('all:anime:movie', '动画电影', 'movie', 86, {
      kind: 'movie',
      category: '动画',
      sort: 'T',
    }),
    makeCategoryRequest('all:documentary:hot', '热门纪录片', 'tv', 84, {
      kind: 'tv',
      category: 'tv',
      type: 'tv_documentary',
    }),
  ];
}

function buildAllRegionBuckets(regionKey: string): CollectionRequest[] {
  const genericRegion = GENERIC_REGION_VALUE_MAP[regionKey] || '';
  const requests: CollectionRequest[] = [];

  requests.push(...buildMovieRecommendBuckets(genericRegion, ''));
  requests.push(...buildSeriesRecommendBuckets(genericRegion, ''));

  if (regionKey === 'cn' || regionKey === 'mandarin') {
    requests.push(...buildVarietyBuckets('cn').slice(0, 2));
  } else if (genericRegion) {
    requests.push(...buildVarietyBuckets('foreign').slice(0, 2));
  }

  const animeRegionKey =
    regionKey === 'mandarin'
      ? 'cn'
      : ['cn', 'jp', 'western'].includes(regionKey)
      ? regionKey
      : '';
  if (animeRegionKey) {
    requests.push(
      ...buildAnimeRecommendBuckets(
        GENERIC_REGION_VALUE_MAP[animeRegionKey],
        ''
      )
    );
  }

  requests.push(...buildDocumentaryRecommendBuckets(genericRegion).slice(0, 2));

  return uniqueCollectionRequests(requests);
}

function buildCollectionRequests(params: {
  contentType: SearchContentType;
  regionKey: string;
  genreLabel: string;
  customTag: SearchCustomTag | null;
  hasQuery: boolean;
}): CollectionRequest[] {
  const { contentType, regionKey, genreLabel, customTag, hasQuery } = params;

  if (customTag) {
    const playType =
      customTag.mediaType ||
      (contentType === 'movie' ? 'movie' : ('tv' as const));

    return [
      makeListRequest(
        `custom:${playType}:${customTag.query}`,
        customTag.label,
        playType,
        96,
        {
          tag: customTag.query,
          type: playType,
        }
      ),
    ];
  }

  switch (contentType) {
    case 'movie':
      return uniqueCollectionRequests(
        genreLabel
          ? buildMovieRecommendBuckets(
              GENERIC_REGION_VALUE_MAP[regionKey] || '',
              genreLabel
            )
          : buildMovieBuckets(regionKey)
      );
    case 'series':
      return uniqueCollectionRequests(
        genreLabel
          ? buildSeriesRecommendBuckets(
              GENERIC_REGION_VALUE_MAP[regionKey] || '',
              genreLabel
            )
          : buildSeriesBuckets(regionKey)
      );
    case 'anime':
      return uniqueCollectionRequests(buildAnimeBuckets(regionKey, genreLabel));
    case 'variety':
      return uniqueCollectionRequests(
        genreLabel
          ? buildVarietyRecommendBuckets(
              regionKey === 'cn'
                ? GENERIC_REGION_VALUE_MAP.cn
                : regionKey
                ? GENERIC_REGION_VALUE_MAP.foreign
                : '',
              genreLabel
            )
          : buildVarietyBuckets(regionKey)
      );
    case 'documentary':
      return uniqueCollectionRequests(buildDocumentaryBuckets(regionKey));
    case 'all':
    default:
      return uniqueCollectionRequests(
        regionKey
          ? buildAllRegionBuckets(regionKey)
          : buildAllDefaultBuckets(hasQuery)
      );
  }
}

function getRuntimeCustomTags(): SearchCustomTag[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const runtimeConfig = (
    window as {
      RUNTIME_CONFIG?: { CUSTOM_CATEGORIES?: RuntimeCustomCategory[] };
    }
  ).RUNTIME_CONFIG;
  const categories = runtimeConfig?.CUSTOM_CATEGORIES || [];
  const seenKeys = new Set<string>();

  return categories.reduce<SearchCustomTag[]>((accumulator, category) => {
    if (!category.query?.trim()) {
      return accumulator;
    }

    const key = `${category.type}:${category.query.trim()}`;
    if (seenKeys.has(key)) {
      return accumulator;
    }

    seenKeys.add(key);
    accumulator.push({
      key,
      label: category.name?.trim() || category.query.trim(),
      query: category.query.trim(),
      mediaType: category.type,
    });
    return accumulator;
  }, []);
}

interface NewSearchPageClientProps {
  active?: boolean;
}

function NewSearchPageClient({ active = true }: NewSearchPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeRequestRef = useRef(0);
  const activeLoadCacheKeyRef = useRef<string | null>(null);

  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [customTags, setCustomTags] = useState<SearchCustomTag[]>([]);
  const [showBackToTop, setShowBackToTop] = useState(false);

  const submittedQuery = normalizeQueryValue(searchParams.get('q') || '');
  const selectedContentType = isValidContentType(searchParams.get('ctype'))
    ? (searchParams.get('ctype') as SearchContentType)
    : 'all';

  const regionOptions = REGION_OPTIONS_BY_TYPE[selectedContentType];
  const genreOptions = GENRE_OPTIONS_BY_TYPE[selectedContentType];
  const selectedRegionKey = getValidFacetKey(
    searchParams.get('region'),
    regionOptions
  );
  const selectedGenreKey = getValidFacetKey(
    searchParams.get('genre'),
    genreOptions
  );
  const selectedGenreLabel = getFacetLabel(selectedGenreKey, genreOptions);
  const rawCustomTagKey = searchParams.get('custom') || '';
  const activeCustomTag =
    customTags.find((tag) => tag.key === rawCustomTagKey) || null;
  const isTitleSearchMode =
    Boolean(submittedQuery) &&
    selectedContentType === 'all' &&
    !selectedRegionKey &&
    !selectedGenreKey &&
    !rawCustomTagKey;
  const collectionRequests = useMemo(() => {
    if (isTitleSearchMode) {
      return [] as CollectionRequest[];
    }

    return buildCollectionRequests({
      contentType: selectedContentType,
      regionKey: selectedRegionKey,
      genreLabel: selectedGenreLabel,
      customTag: activeCustomTag,
      hasQuery: Boolean(submittedQuery),
    });
  }, [
    activeCustomTag,
    isTitleSearchMode,
    selectedContentType,
    selectedGenreLabel,
    selectedRegionKey,
    submittedQuery,
  ]);
  const doubanCacheKey = useMemo(() => {
    if (isTitleSearchMode) {
      return `title-search:${submittedQuery}`;
    }

    return `collections:${selectedContentType}:${selectedRegionKey || '-'}:${
      selectedGenreKey || '-'
    }:${rawCustomTagKey || '-'}:${submittedQuery ? 'query' : 'discover'}:${
      collectionRequests.map((request) => request.key).join('|') || 'empty'
    }`;
  }, [
    collectionRequests,
    isTitleSearchMode,
    rawCustomTagKey,
    selectedContentType,
    selectedGenreKey,
    selectedRegionKey,
    submittedQuery,
  ]);
  const cachedCollectionEntry = useSearchCacheStore(
    (state) => state.doubanModeEntries[doubanCacheKey]
  );
  const hasSearchCacheHydrated = useSearchCacheStore(
    (state) => state.hasHydrated
  );
  const setDoubanModeEntry = useSearchCacheStore(
    (state) => state.setDoubanModeEntry
  );
  const patchDoubanModeEntry = useSearchCacheStore(
    (state) => state.patchDoubanModeEntry
  );
  const hasFreshCollectionCache = isSearchCacheEntryFresh(
    cachedCollectionEntry
  );
  const collectionItems = cachedCollectionEntry?.items || [];
  const isLoading =
    active &&
    (!hasSearchCacheHydrated ||
      !cachedCollectionEntry ||
      cachedCollectionEntry.status === 'loading');
  const totalCollections =
    cachedCollectionEntry?.totalCollections ??
    (isTitleSearchMode ? 1 : collectionRequests.length);
  const completedCollections = cachedCollectionEntry?.completedCollections || 0;

  const visibleCustomTags = useMemo(() => {
    const filteredTags = filterCustomTagsByContentType(
      selectedContentType,
      customTags
    );

    if (
      activeCustomTag &&
      !filteredTags.some((tag) => tag.key === activeCustomTag.key)
    ) {
      return [activeCustomTag, ...filteredTags];
    }

    return filteredTags;
  }, [activeCustomTag, customTags, selectedContentType]);

  const filteredItems = useMemo(() => {
    const query = submittedQuery;

    return collectionItems
      .map((item) => ({
        item,
        matchScore: scoreTitleMatch(item.title, query),
      }))
      .filter(({ matchScore }) => !query || matchScore >= 0)
      .sort((left, right) => {
        if (query && right.matchScore !== left.matchScore) {
          return right.matchScore - left.matchScore;
        }

        if (isTitleSearchMode) {
          const leftRank = left.item.searchRank ?? Number.MAX_SAFE_INTEGER;
          const rightRank = right.item.searchRank ?? Number.MAX_SAFE_INTEGER;

          if (leftRank !== rightRank) {
            return leftRank - rightRank;
          }
        }

        if (right.item.bucketKeys.length !== left.item.bucketKeys.length) {
          return right.item.bucketKeys.length - left.item.bucketKeys.length;
        }

        if (right.item.priority !== left.item.priority) {
          return right.item.priority - left.item.priority;
        }

        const rateDiff = parseRate(right.item.rate) - parseRate(left.item.rate);
        if (rateDiff !== 0) {
          return rateDiff;
        }

        const yearDiff = parseYear(right.item.year) - parseYear(left.item.year);
        if (yearDiff !== 0) {
          return yearDiff;
        }

        return left.item.title.localeCompare(right.item.title, 'zh-Hans-CN');
      })
      .map(({ item }) => item);
  }, [collectionItems, isTitleSearchMode, submittedQuery]);

  const resultsSummary = useMemo(() => {
    if (isTitleSearchMode) {
      return `豆瓣标题搜索命中 ${filteredItems.length} 条内容`;
    }

    if (submittedQuery) {
      return `在 ${collectionItems.length} 条聚合内容中匹配到 ${filteredItems.length} 部片名`;
    }

    return `当前聚合 ${filteredItems.length} 部内容`;
  }, [
    collectionItems.length,
    filteredItems.length,
    isTitleSearchMode,
    submittedQuery,
  ]);

  const buildSearchUrl = (
    overrides: Partial<
      Record<'q' | 'ctype' | 'region' | 'genre' | 'custom', string>
    >
  ) => {
    const nextParams = new URLSearchParams(searchParams.toString());

    Object.entries(overrides).forEach(([key, value]) => {
      const trimmedValue = normalizeQueryValue(value || '');
      if (trimmedValue) {
        nextParams.set(key, trimmedValue);
      } else {
        nextParams.delete(key);
      }
    });

    const nextQueryString = nextParams.toString();
    return nextQueryString ? `/search?${nextQueryString}` : '/search';
  };

  const navigateWithParams = (
    overrides: Partial<
      Record<'q' | 'ctype' | 'region' | 'genre' | 'custom', string>
    >,
    mode: 'push' | 'replace' = 'replace'
  ) => {
    const nextUrl = buildSearchUrl(overrides);
    if (mode === 'push') {
      router.push(nextUrl);
      return;
    }
    router.replace(nextUrl);
  };

  useEffect(() => {
    setSearchInput(submittedQuery);
  }, [submittedQuery]);

  useEffect(() => {
    setCustomTags(getRuntimeCustomTags());
  }, []);

  useEffect(() => {
    if (!active || submittedQuery) {
      return;
    }

    if (!submittedQuery) {
      searchInputRef.current?.focus();
    }
  }, [active, submittedQuery]);

  useEffect(() => {
    let isMounted = true;

    void getSearchHistory().then((history) => {
      if (isMounted) {
        setSearchHistory(history);
      }
    });

    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (nextHistory: string[]) => {
        setSearchHistory(nextHistory);
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!active || !submittedQuery) {
      return;
    }

    void addSearchHistory(submittedQuery);
  }, [active, submittedQuery]);

  useEffect(() => {
    if (!active) {
      setShowBackToTop(false);
      return;
    }

    const handleScroll = () => {
      const scrollTop =
        window.scrollY ||
        document.documentElement.scrollTop ||
        document.body.scrollTop;
      setShowBackToTop(scrollTop > 300);
    };

    handleScroll();
    document.body.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      document.body.removeEventListener('scroll', handleScroll);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [active]);

  useEffect(() => {
    if (!active || !hasSearchCacheHydrated) {
      return;
    }

    if (hasFreshCollectionCache) {
      return;
    }

    if (
      cachedCollectionEntry?.status === 'loading' &&
      activeLoadCacheKeyRef.current === doubanCacheKey
    ) {
      return;
    }

    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;
    activeLoadCacheKeyRef.current = doubanCacheKey;

    if (isTitleSearchMode) {
      setDoubanModeEntry(
        doubanCacheKey,
        buildSearchCacheEntry({
          status: 'loading',
          items: cachedCollectionEntry?.items || [],
          totalCollections: 1,
          completedCollections: 0,
          updatedAt: Date.now(),
        })
      );

      void getDoubanTitleSearch({
        query: submittedQuery,
        pageLimit: TITLE_SEARCH_PAGE_LIMIT,
        pageStart: 0,
      })
        .then((data) => {
          if (activeRequestRef.current !== requestId) {
            return;
          }

          setDoubanModeEntry(
            doubanCacheKey,
            buildSearchCacheEntry({
              status: 'ready',
              items: mapTitleSearchItems(data.list),
              totalCollections: 1,
              completedCollections: 1,
              updatedAt: Date.now(),
            })
          );
        })
        .catch(() => {
          if (activeRequestRef.current === requestId) {
            setDoubanModeEntry(
              doubanCacheKey,
              buildSearchCacheEntry({
                status: 'error',
                items: [],
                totalCollections: 1,
                completedCollections: 1,
                updatedAt: Date.now(),
              })
            );
          }
        })
        .finally(() => {
          if (
            activeRequestRef.current === requestId &&
            activeLoadCacheKeyRef.current === doubanCacheKey
          ) {
            activeLoadCacheKeyRef.current = null;
          }
        });

      return;
    }

    if (collectionRequests.length === 0) {
      setDoubanModeEntry(
        doubanCacheKey,
        buildSearchCacheEntry({
          status: 'ready',
          items: [],
          totalCollections: 0,
          completedCollections: 0,
          updatedAt: Date.now(),
        })
      );
      activeLoadCacheKeyRef.current = null;
      return;
    }

    setDoubanModeEntry(
      doubanCacheKey,
      buildSearchCacheEntry({
        status: 'loading',
        items: cachedCollectionEntry?.items || [],
        totalCollections: collectionRequests.length,
        completedCollections: 0,
        updatedAt: Date.now(),
      })
    );

    const collectionMap = new Map<string, DoubanSearchItem>();

    void Promise.allSettled(
      collectionRequests.map(async (request) => {
        let nextItems: DoubanSearchItem[] | undefined;

        try {
          const data = await request.load();

          if (activeRequestRef.current !== requestId) {
            return;
          }

          mergeIntoCollectionMap(
            collectionMap,
            mapDoubanItems(data.list, request)
          );
          nextItems = Array.from(collectionMap.values());
        } finally {
          if (activeRequestRef.current === requestId) {
            patchDoubanModeEntry(doubanCacheKey, (previousEntry) =>
              buildSearchCacheEntry({
                ...previousEntry,
                status: 'loading',
                items: nextItems || previousEntry.items,
                totalCollections: collectionRequests.length,
                completedCollections: Math.min(
                  previousEntry.completedCollections + 1,
                  collectionRequests.length
                ),
              })
            );
          }
        }
      })
    ).finally(() => {
      if (activeRequestRef.current === requestId) {
        patchDoubanModeEntry(doubanCacheKey, (previousEntry) =>
          buildSearchCacheEntry({
            ...previousEntry,
            status: 'ready',
            totalCollections: collectionRequests.length,
            completedCollections: collectionRequests.length,
            updatedAt: Date.now(),
          })
        );
      }

      if (
        activeRequestRef.current === requestId &&
        activeLoadCacheKeyRef.current === doubanCacheKey
      ) {
        activeLoadCacheKeyRef.current = null;
      }
    });
  }, [
    active,
    cachedCollectionEntry,
    hasFreshCollectionCache,
    hasSearchCacheHydrated,
    collectionRequests,
    doubanCacheKey,
    isTitleSearchMode,
    patchDoubanModeEntry,
    setDoubanModeEntry,
    submittedQuery,
  ]);

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = normalizeQueryValue(searchInput);
    navigateWithParams({ q: nextQuery }, 'push');
  };

  const handleContentTypeChange = (contentType: SearchContentType) => {
    const nextRegionOptions = REGION_OPTIONS_BY_TYPE[contentType];
    const nextGenreOptions = GENRE_OPTIONS_BY_TYPE[contentType];
    const nextRegionKey = nextRegionOptions.some(
      (option) => option.key === selectedRegionKey
    )
      ? selectedRegionKey
      : '';
    const nextGenreKey = nextGenreOptions.some(
      (option) => option.key === selectedGenreKey
    )
      ? selectedGenreKey
      : '';
    const nextCustomKey =
      activeCustomTag && isCustomTagCompatible(contentType, activeCustomTag)
        ? activeCustomTag.key
        : '';

    navigateWithParams({
      ctype: contentType === 'all' ? '' : contentType,
      region: nextCustomKey ? '' : nextRegionKey,
      genre: nextCustomKey ? '' : nextGenreKey,
      custom: nextCustomKey,
    });
  };

  const handleRegionToggle = (regionKey: string) => {
    navigateWithParams({
      region: selectedRegionKey === regionKey ? '' : regionKey,
      custom: '',
    });
  };

  const handleGenreToggle = (genreKey: string) => {
    navigateWithParams({
      genre: selectedGenreKey === genreKey ? '' : genreKey,
      custom: '',
    });
  };

  const handleCustomTagToggle = (tag: SearchCustomTag) => {
    navigateWithParams({
      custom: activeCustomTag?.key === tag.key ? '' : tag.key,
      region: '',
      genre: '',
    });
  };

  const handleResetFilters = () => {
    navigateWithParams({
      ctype: '',
      region: '',
      genre: '',
      custom: '',
    });
  };

  const handleSearchHistoryClick = (keyword: string) => {
    const normalizedKeyword = normalizeQueryValue(keyword);
    setSearchInput(normalizedKeyword);
    navigateWithParams({ q: normalizedKeyword }, 'push');
  };

  const handleClearSearchInput = () => {
    setSearchInput('');

    if (submittedQuery) {
      navigateWithParams({ q: '' });
      return;
    }

    searchInputRef.current?.focus();
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.body.scrollTo({ top: 0, behavior: 'smooth' });
    document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <SearchPageScaffold
      mode='new'
      searchValue={searchInput}
      onSearchValueChange={setSearchInput}
      onSearchSubmit={handleSearchSubmit}
      onClearSearch={handleClearSearchInput}
      searchInputRef={searchInputRef}
      searchInputId='searchInput-douban'
      searchHistory={{
        items: searchHistory,
        visible: !submittedQuery && searchHistory.length > 0,
        onSelect: handleSearchHistoryClick,
        onClear: () => clearSearchHistory(),
        onDelete: (keyword) => deleteSearchHistory(keyword),
      }}
      topModule={
        <SearchQuickSelector
          contentTypes={CONTENT_TYPE_OPTIONS}
          regions={regionOptions}
          genres={genreOptions}
          customTags={visibleCustomTags}
          selectedContentType={selectedContentType}
          selectedRegionKey={selectedRegionKey}
          selectedGenreKey={selectedGenreKey}
          selectedCustomTagKey={activeCustomTag?.key || ''}
          onContentTypeChange={handleContentTypeChange}
          onRegionToggle={handleRegionToggle}
          onGenreToggle={handleGenreToggle}
          onCustomTagToggle={handleCustomTagToggle}
          onReset={handleResetFilters}
        />
      }
      showBackToTop={showBackToTop}
      onScrollToTop={scrollToTop}
    >
      <section>
        <SearchSectionHeading
          title={
            submittedQuery
              ? isTitleSearchMode
                ? '标题搜索结果'
                : '搜索结果'
              : '豆瓣聚合'
          }
          description={resultsSummary}
          meta={`${
            isTitleSearchMode ? '豆瓣标题搜索进度' : '豆瓣列表进度'
          } ${completedCollections}/${totalCollections}`}
          actions={
            isLoading ? (
              <div className='inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400'>
                <span className='inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-green-500' />
                {isTitleSearchMode ? '正在搜索豆瓣片名' : '正在聚合豆瓣列表'}
              </div>
            ) : null
          }
        />

        {filteredItems.length === 0 ? (
          isLoading ? (
            <div className='flex h-40 items-center justify-center'>
              <div className='h-8 w-8 animate-spin rounded-full border-b-2 border-green-500' />
            </div>
          ) : (
            <div className='rounded-2xl border border-dashed border-gray-200 bg-white/70 px-6 py-14 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-400'>
              {submittedQuery
                ? isTitleSearchMode
                  ? '豆瓣标题搜索未找到相关片名'
                  : '当前豆瓣聚合列表中未找到匹配片名'
                : '当前筛选下暂无可展示内容'}
            </div>
          )
        ) : (
          <VirtualGrid
            items={filteredItems}
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
                  query={
                    submittedQuery && submittedQuery !== item.title
                      ? submittedQuery
                      : ''
                  }
                  type={item.playType}
                />
              </div>
            )}
          />
        )}
      </section>
    </SearchPageScaffold>
  );
}

interface NewSearchPageProps {
  active?: boolean;
}

export default function NewSearchPage({ active = true }: NewSearchPageProps) {
  return <NewSearchPageClient active={active} />;
}
