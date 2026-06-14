import { SearchResult } from '@/lib/types';
import { isAdultContentResult } from '@/lib/yellow';

const ADULT_GROUPING_STOPWORDS = [
  'fc2',
  'porn',
  'swag',
  'vlog',
  '无码视频',
  '无码',
  '有码',
  '合集',
  '作品',
  '写真',
  '视频',
  '影片',
  '剧情',
  '专区',
  '传媒',
  '社区',
  '俱乐部',
  '平台',
  '官方',
  '原创',
  '国产',
  '麻豆',
  '糖心',
  '海角',
  '天美',
  '果冻',
  '蜜桃',
  '福利',
  '偷拍',
  '国产自拍',
  '无码高清',
];

function normalizeAdultGroupingText(value: string): string {
  return value.trim().toLowerCase().normalize('NFKC').replace(/\s+/g, ' ');
}

function sanitizeAdultGroupingCandidate(value: string): string {
  return value
    .replace(/^[\s"'“”‘’《》【】[\]()（）]+/, '')
    .replace(/[\s"'“”‘’《》【】[\]()（）]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAdultGroupingStopword(value: string): boolean {
  const normalizedValue = normalizeAdultGroupingText(value);
  return ADULT_GROUPING_STOPWORDS.some((word) =>
    normalizedValue.includes(word)
  );
}

function isReasonableAdultGroupingQuery(
  value: string,
  title?: string | null
): boolean {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return false;
  }

  if (normalizedValue.length < 2 || normalizedValue.length > 24) {
    return false;
  }

  if (/^\d+$/.test(normalizedValue)) {
    return false;
  }

  if (hasAdultGroupingStopword(normalizedValue)) {
    return false;
  }

  const normalizedTitle = normalizeAdultGroupingText(title || '');
  const normalizedQuery = normalizeAdultGroupingText(normalizedValue);

  if (!normalizedTitle || normalizedQuery === normalizedTitle) {
    return false;
  }

  return true;
}

function scoreAdultGroupingToken(token: string): number {
  if (!token || hasAdultGroupingStopword(token)) {
    return Number.NEGATIVE_INFINITY;
  }

  if (/\d/.test(token)) {
    return Number.NEGATIVE_INFINITY;
  }

  if (/^[\u4e00-\u9fa5]{2,4}$/.test(token)) {
    return 180;
  }

  if (/^[\u4e00-\u9fa5]{5,8}$/.test(token)) {
    return 120;
  }

  if (/^[A-Za-z][A-Za-z.'-]{1,15}$/.test(token)) {
    return 100;
  }

  if (/^[A-Za-z][A-Za-z0-9.'-]{1,15}$/.test(token)) {
    return 70;
  }

  if (token.length >= 2 && token.length <= 8) {
    return 40;
  }

  return Number.NEGATIVE_INFINITY;
}

function extractAdultGroupingTokens(title: string): string[] {
  return title
    .replace(/[【】[\]（）()]/g, ' ')
    .split(/[\s._·•|｜/\\:：,，!！?？;；]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function isEnglishNameToken(token: string): boolean {
  return /^[A-Za-z][A-Za-z.'-]{1,15}$/.test(token);
}

function extractFirstEnglishNamePhrase(value: string): string | null {
  const tokens = extractAdultGroupingTokens(value);

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const left = tokens[index];
    const right = tokens[index + 1];

    if (!isEnglishNameToken(left) || !isEnglishNameToken(right)) {
      continue;
    }

    const candidate = `${left} ${right}`;
    if (candidate.length <= 24 && !hasAdultGroupingStopword(candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractBracketedAdultGroupingCandidates(title: string): string[] {
  const candidates: string[] = [];
  const pattern = /[【[(（]([^】\]）)]{2,40})[】\]）)]/g;
  let currentMatch = pattern.exec(title);

  while (currentMatch) {
    const rawCandidate = sanitizeAdultGroupingCandidate(currentMatch[1] || '');
    if (!rawCandidate) {
      currentMatch = pattern.exec(title);
      continue;
    }

    const englishNameCandidate = extractFirstEnglishNamePhrase(rawCandidate);
    if (englishNameCandidate) {
      candidates.push(englishNameCandidate);
    }

    candidates.push(rawCandidate);

    currentMatch = pattern.exec(title);
  }

  return candidates;
}

function extractDelimitedAdultGroupingCandidates(title: string): string[] {
  const candidates: string[] = [];
  const segments = title.split(/\s[-—–|｜:：]\s/);

  segments.slice(1).forEach((segment) => {
    const rawCandidate = sanitizeAdultGroupingCandidate(segment);
    if (!rawCandidate) {
      return;
    }

    const englishNameCandidate = extractFirstEnglishNamePhrase(rawCandidate);
    if (englishNameCandidate) {
      candidates.push(englishNameCandidate);
    }

    if (rawCandidate.length <= 24) {
      candidates.push(rawCandidate);
    }
  });

  return candidates;
}

export function buildAdultDownloadGroupingQuery(
  content: Partial<{
    title: string;
    searchTitle: string;
    sourceName: string;
    desc: string;
    typeName: string;
  }>
): string | null {
  const title = content.title?.trim() || '';
  if (!title) {
    return null;
  }

  if (
    !isAdultContentResult({
      title,
      source_name: content.sourceName,
      desc: content.desc,
      type_name: content.typeName,
    })
  ) {
    return null;
  }

  const preferredQuery = content.searchTitle?.trim();
  if (preferredQuery && isReasonableAdultGroupingQuery(preferredQuery, title)) {
    return preferredQuery;
  }

  const explicitCandidates = [
    ...extractBracketedAdultGroupingCandidates(title),
    ...extractDelimitedAdultGroupingCandidates(title),
  ];

  for (const candidate of explicitCandidates) {
    if (isReasonableAdultGroupingQuery(candidate, title)) {
      return candidate;
    }
  }

  const tokens = extractAdultGroupingTokens(title);
  let bestToken: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  tokens.forEach((token, index) => {
    let score = scoreAdultGroupingToken(token);
    if (!Number.isFinite(score)) {
      return;
    }

    if (index === 0) {
      score += 120;
    } else if (index === 1) {
      score += 20;
    }

    if (score > bestScore) {
      bestToken = token;
      bestScore = score;
    }
  });

  return bestToken && Number.isFinite(bestScore) ? bestToken : null;
}

export function buildAdultDownloadGroupingKey(
  content: Partial<{
    title: string;
    searchTitle: string;
    sourceName: string;
    desc: string;
    typeName: string;
  }>
): string | null {
  const query = buildAdultDownloadGroupingQuery(content);
  return query ? normalizeAdultGroupingText(query) : null;
}

function normalizeAdultResultTitle(title: string): string {
  return title.trim().toLowerCase().normalize('NFKC').replace(/\s+/g, '');
}

function normalizeAdultResultKey(result: SearchResult): string {
  return normalizeAdultResultTitle(result.title);
}

export function buildAdultContentMatchKey(
  result: Pick<SearchResult, 'source' | 'id'>
): string {
  return `${result.source}:${result.id}`;
}

export function filterAdultGroupingSearchResults(
  results: SearchResult[],
  query: string,
  current?: Pick<SearchResult, 'source' | 'id' | 'title'>
): SearchResult[] {
  const normalizedQuery = normalizeAdultGroupingText(query);
  const currentKey = current ? buildAdultContentMatchKey(current) : null;
  const normalizedCurrentTitle = current?.title
    ? normalizeAdultResultTitle(current.title)
    : '';
  const seenTitles = new Set<string>();

  return results
    .filter((result) => isAdultContentResult(result))
    .filter((result) => {
      if (currentKey && buildAdultContentMatchKey(result) === currentKey) {
        return false;
      }

      const searchableText = normalizeAdultGroupingText(
        [result.title, result.desc, result.source_name]
          .filter(Boolean)
          .join(' ')
      );

      return searchableText.includes(normalizedQuery);
    })
    .sort((left, right) => {
      const leftIsCurrentTitle =
        normalizedCurrentTitle &&
        normalizeAdultResultKey(left) === normalizedCurrentTitle;
      const rightIsCurrentTitle =
        normalizedCurrentTitle &&
        normalizeAdultResultKey(right) === normalizedCurrentTitle;

      if (leftIsCurrentTitle !== rightIsCurrentTitle) {
        return leftIsCurrentTitle ? -1 : 1;
      }

      if (right.episodes.length !== left.episodes.length) {
        return right.episodes.length - left.episodes.length;
      }

      if (left.title !== right.title) {
        return left.title.localeCompare(right.title, 'zh-CN');
      }

      return left.source_name.localeCompare(right.source_name, 'zh-CN');
    })
    .filter((result) => {
      const key = `${normalizeAdultResultKey(result)}:${
        result.episodes.length
      }`;
      if (seenTitles.has(key)) {
        return false;
      }

      seenTitles.add(key);
      return true;
    });
}
