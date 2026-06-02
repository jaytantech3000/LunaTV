import { getDoubanCategories, getDoubanRecommends } from '@/lib/douban.client';
import { DoubanItem, DoubanResult } from '@/lib/types';

const COLLECTION_PAGE_SIZE = 36;

export const DOUBAN_AGGREGATE_GRID_CLASS_NAME =
  'grid-cols-3 gap-x-2 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8';

interface CategoryRequestParams {
  kind: 'movie' | 'tv';
  category: string;
  type: string;
}

interface RecommendRequestParams {
  kind: 'movie' | 'tv';
  category?: string;
  format?: string;
  label?: string;
  region?: string;
  sort?: string;
}

export interface DoubanAggregateCollectionRequest {
  key: string;
  label: string;
  playType: 'movie' | 'tv';
  priority: number;
  load: () => Promise<DoubanResult>;
}

export interface DoubanAggregateItem extends DoubanItem {
  playType: 'movie' | 'tv';
  bucketKeys: string[];
  bucketLabels: string[];
  priority: number;
  searchRank?: number;
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\-_.·•・:：,，!！?？'"“”‘’`~()（）[\]【】{}<>《》/\\|]/g, '');
}

export function parseDoubanRate(rate: string): number {
  const numericRate = Number.parseFloat(rate);
  return Number.isFinite(numericRate) ? numericRate : 0;
}

export function parseDoubanYear(year: string): number {
  const numericYear = Number.parseInt(year, 10);
  return Number.isFinite(numericYear) ? numericYear : 0;
}

function getItemMergeKey(item: DoubanAggregateItem): string {
  if (item.id) {
    return `${item.playType}:${item.id}`;
  }

  return `${item.playType}:${normalizeText(item.title)}:${item.year}`;
}

function makeCategoryRequest(
  key: string,
  label: string,
  playType: 'movie' | 'tv',
  priority: number,
  params: CategoryRequestParams
): DoubanAggregateCollectionRequest {
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

function makeRecommendRequest(
  key: string,
  label: string,
  playType: 'movie' | 'tv',
  priority: number,
  params: RecommendRequestParams
): DoubanAggregateCollectionRequest {
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

export function mapDoubanAggregateItems(
  items: DoubanItem[],
  request: DoubanAggregateCollectionRequest
): DoubanAggregateItem[] {
  return items.map((item) => ({
    ...item,
    playType: request.playType,
    bucketKeys: [request.key],
    bucketLabels: [request.label],
    priority: request.priority,
  }));
}

export function mergeDoubanAggregateItems(
  collectionMap: Map<string, DoubanAggregateItem>,
  items: DoubanAggregateItem[]
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

    if (parseDoubanRate(item.rate) > parseDoubanRate(existing.rate)) {
      existing.rate = item.rate;
    }
  });
}

export function buildDefaultDoubanAggregationRequests(): DoubanAggregateCollectionRequest[] {
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

export function sortDoubanAggregateItems(
  items: DoubanAggregateItem[]
): DoubanAggregateItem[] {
  return items.slice().sort((left, right) => {
    if (right.bucketKeys.length !== left.bucketKeys.length) {
      return right.bucketKeys.length - left.bucketKeys.length;
    }

    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }

    const rateDiff = parseDoubanRate(right.rate) - parseDoubanRate(left.rate);
    if (rateDiff !== 0) {
      return rateDiff;
    }

    const yearDiff = parseDoubanYear(right.year) - parseDoubanYear(left.year);
    if (yearDiff !== 0) {
      return yearDiff;
    }

    return left.title.localeCompare(right.title, 'zh-Hans-CN');
  });
}
