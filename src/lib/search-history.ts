export type SearchHistoryMode = 'new' | 'legacy';

export interface SearchHistoryEntry {
  keyword: string;
  mode?: SearchHistoryMode;
  rawValue: string;
}

const SEARCH_HISTORY_MODE_PREFIX = '__moontv_search_history_v1__';

function isSearchHistoryMode(value: unknown): value is SearchHistoryMode {
  return value === 'new' || value === 'legacy';
}

export function encodeSearchHistoryValue(
  keyword: string,
  mode?: SearchHistoryMode
): string {
  const normalizedKeyword = keyword.trim();

  if (!normalizedKeyword) {
    return '';
  }

  if (!mode) {
    return normalizedKeyword;
  }

  return `${SEARCH_HISTORY_MODE_PREFIX}${JSON.stringify({
    keyword: normalizedKeyword,
    mode,
  })}`;
}

export function decodeSearchHistoryValue(
  rawValue: string
): SearchHistoryEntry | null {
  const normalizedRawValue = rawValue.trim();

  if (!normalizedRawValue) {
    return null;
  }

  if (!normalizedRawValue.startsWith(SEARCH_HISTORY_MODE_PREFIX)) {
    return {
      keyword: normalizedRawValue,
      rawValue: normalizedRawValue,
    };
  }

  try {
    const payload = JSON.parse(
      normalizedRawValue.slice(SEARCH_HISTORY_MODE_PREFIX.length)
    ) as {
      keyword?: unknown;
      mode?: unknown;
    };
    const normalizedKeyword =
      typeof payload.keyword === 'string' ? payload.keyword.trim() : '';

    if (!normalizedKeyword) {
      return null;
    }

    return {
      keyword: normalizedKeyword,
      mode: isSearchHistoryMode(payload.mode) ? payload.mode : undefined,
      rawValue: normalizedRawValue,
    };
  } catch {
    return {
      keyword: normalizedRawValue,
      rawValue: normalizedRawValue,
    };
  }
}

export function decodeSearchHistoryValues(
  rawValues: string[]
): SearchHistoryEntry[] {
  if (!Array.isArray(rawValues)) {
    return [];
  }

  return rawValues
    .map((rawValue) => decodeSearchHistoryValue(rawValue))
    .filter((entry): entry is SearchHistoryEntry => Boolean(entry));
}

export function resolveSearchHistoryRawValue(
  entry: SearchHistoryEntry | string
): string {
  if (typeof entry === 'string') {
    return entry.trim();
  }

  return entry.rawValue.trim();
}

export function getSearchHistoryModeLabel(mode?: SearchHistoryMode): string {
  return mode === 'legacy' ? '全局' : '豆瓣';
}
