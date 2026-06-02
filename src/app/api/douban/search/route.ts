import { NextRequest, NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { DoubanItem, DoubanResult } from '@/lib/types';

const SEARCH_PAGE_SIZE = 15;
const MAX_SEARCH_LIMIT = 60;

interface DoubanSearchPageLabel {
  text?: string;
}

interface DoubanSearchPageItem {
  tpl_name?: string;
  id?: number;
  title?: string;
  cover_url?: string;
  labels?: DoubanSearchPageLabel[];
  rating?: {
    value?: number;
    count?: number;
  };
}

interface DoubanSearchPageData {
  count: number;
  start: number;
  total: number;
  text: string;
  items: DoubanSearchPageItem[];
}

export const runtime = 'nodejs';

function normalizeLimit(rawLimit: string | null): number {
  const parsedLimit = Number.parseInt(rawLimit || '', 10);
  if (!Number.isFinite(parsedLimit)) {
    return SEARCH_PAGE_SIZE;
  }

  return Math.max(1, Math.min(parsedLimit, MAX_SEARCH_LIMIT));
}

function normalizeStart(rawStart: string | null): number {
  const parsedStart = Number.parseInt(rawStart || '', 10);
  if (!Number.isFinite(parsedStart) || parsedStart < 0) {
    return 0;
  }

  return parsedStart;
}

function extractSearchData(html: string): DoubanSearchPageData {
  const match = html.match(/window\.__DATA__\s*=\s*(\{[\s\S]*?\})\s*;/);

  if (!match?.[1]) {
    throw new Error('未找到豆瓣搜索结果数据');
  }

  return JSON.parse(match[1]) as DoubanSearchPageData;
}

function sanitizeTitle(rawTitle: string): string {
  return rawTitle
    .replace(/\u200e/g, '')
    .replace(/\s*[（(]\d{4}[)）]\s*$/, '')
    .trim();
}

function extractYear(rawTitle: string): string {
  return rawTitle.match(/[（(](\d{4})[)）]\s*$/)?.[1] || '';
}

function inferPlayType(item: DoubanSearchPageItem): 'movie' | 'tv' {
  const hasTvLabel = item.labels?.some((label) => label.text === '剧集');
  return hasTvLabel ? 'tv' : 'movie';
}

function isSearchSubjectItem(
  item: DoubanSearchPageItem
): item is DoubanSearchPageItem & { id: number; title: string } {
  return (
    item.tpl_name === 'search_subject' &&
    typeof item.id === 'number' &&
    Number.isFinite(item.id) &&
    typeof item.title === 'string' &&
    item.title.trim().length > 0
  );
}

function countSearchSubjectItems(items: DoubanSearchPageItem[]): number {
  return items.filter(isSearchSubjectItem).length;
}

function mapSearchItem(
  item: DoubanSearchPageItem & { id: number; title: string }
): DoubanItem {
  const ratingValue = item.rating?.value;
  const ratingCount = item.rating?.count || 0;

  return {
    id: item.id.toString(),
    title: sanitizeTitle(item.title),
    poster: item.cover_url || '',
    rate:
      typeof ratingValue === 'number' &&
      Number.isFinite(ratingValue) &&
      ratingValue > 0 &&
      ratingCount > 0
        ? ratingValue.toFixed(1)
        : '',
    year: extractYear(item.title),
    playType: inferPlayType(item),
  };
}

async function fetchDoubanSearchPage(
  query: string,
  start: number
): Promise<DoubanSearchPageData> {
  const targetUrl = new URL('https://search.douban.com/movie/subject_search');
  targetUrl.searchParams.set('search_text', query);
  targetUrl.searchParams.set('cat', '1002');
  if (start > 0) {
    targetUrl.searchParams.set('start', start.toString());
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(targetUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Referer: 'https://movie.douban.com/',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const html = await response.text();
    return extractSearchData(html);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.trim() || '';
  const limit = normalizeLimit(searchParams.get('limit'));
  const start = normalizeStart(searchParams.get('start'));

  if (!query) {
    return NextResponse.json({ error: '缺少必要参数: q' }, { status: 400 });
  }

  try {
    const firstPage = await fetchDoubanSearchPage(query, start);
    const collectedItems = [...firstPage.items];
    const total = Math.max(
      firstPage.total || 0,
      start + countSearchSubjectItems(firstPage.items)
    );
    const desiredCount = Math.max(
      0,
      Math.min(limit, total - start, MAX_SEARCH_LIMIT)
    );

    const remainingStarts: number[] = [];
    for (
      let nextStart = start + SEARCH_PAGE_SIZE;
      nextStart < total && nextStart < start + desiredCount;
      nextStart += SEARCH_PAGE_SIZE
    ) {
      remainingStarts.push(nextStart);
    }

    const remainingPages = await Promise.allSettled(
      remainingStarts.map((pageStart) =>
        fetchDoubanSearchPage(query, pageStart)
      )
    );

    remainingPages.forEach((result) => {
      if (result.status === 'fulfilled') {
        collectedItems.push(...result.value.items);
      }
    });

    const uniqueItems = Array.from(
      new Map(
        collectedItems
          .filter(isSearchSubjectItem)
          .map((item) => [item.id.toString(), mapSearchItem(item)])
      ).values()
    ).slice(0, desiredCount || limit);

    const response: DoubanResult = {
      code: 200,
      message: '获取成功',
      list: uniqueItems,
    };

    const cacheTime = await getCacheTime();
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: '获取豆瓣标题搜索结果失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
