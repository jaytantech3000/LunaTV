import type {
  Favorite,
  FollowRecord,
  PlayRecord,
  SkipConfig,
} from '@/lib/types';

export type DesktopProfileMergeStrategy = 'web-first' | 'local-first';

export interface DesktopProfileSnapshot {
  playRecords: Record<string, PlayRecord>;
  favorites: Record<string, Favorite>;
  follows: Record<string, FollowRecord>;
  searchHistory: string[];
  skipConfigs: Record<string, SkipConfig>;
}

export interface DesktopProfileSnapshotSummary {
  playRecordCount: number;
  favoriteCount: number;
  followCount: number;
  searchHistoryCount: number;
  skipConfigCount: number;
}

function mergeKeyedDomain<T>(
  remoteDomain: Record<string, T>,
  localDomain: Record<string, T>,
  strategy: DesktopProfileMergeStrategy
): Record<string, T> {
  if (strategy === 'local-first') {
    return {
      ...remoteDomain,
      ...localDomain,
    };
  }

  return {
    ...localDomain,
    ...remoteDomain,
  };
}

function normalizeSearchKeyword(keyword: string): string | null {
  const normalizedKeyword = keyword.trim();
  return normalizedKeyword ? normalizedKeyword : null;
}

export function mergeSearchHistory(
  remoteHistory: readonly string[],
  localHistory: readonly string[],
  strategy: DesktopProfileMergeStrategy,
  limit = 20
): string[] {
  const preferredHistory =
    strategy === 'local-first' ? localHistory : remoteHistory;
  const secondaryHistory =
    strategy === 'local-first' ? remoteHistory : localHistory;
  const mergedHistory: string[] = [];
  const seenKeywords = new Set<string>();

  [preferredHistory, secondaryHistory].forEach((history) => {
    history.forEach((keyword) => {
      const normalizedKeyword = normalizeSearchKeyword(keyword);
      if (!normalizedKeyword || seenKeywords.has(normalizedKeyword)) {
        return;
      }

      seenKeywords.add(normalizedKeyword);
      mergedHistory.push(normalizedKeyword);
    });
  });

  return mergedHistory.slice(0, Math.max(0, limit));
}

export function mergeDesktopProfileSnapshot(
  remoteSnapshot: DesktopProfileSnapshot,
  localSnapshot: DesktopProfileSnapshot,
  strategy: DesktopProfileMergeStrategy
): DesktopProfileSnapshot {
  return {
    playRecords: mergeKeyedDomain(
      remoteSnapshot.playRecords,
      localSnapshot.playRecords,
      strategy
    ),
    favorites: mergeKeyedDomain(
      remoteSnapshot.favorites,
      localSnapshot.favorites,
      strategy
    ),
    follows: mergeKeyedDomain(
      remoteSnapshot.follows,
      localSnapshot.follows,
      strategy
    ),
    searchHistory: mergeSearchHistory(
      remoteSnapshot.searchHistory,
      localSnapshot.searchHistory,
      strategy
    ),
    skipConfigs: mergeKeyedDomain(
      remoteSnapshot.skipConfigs,
      localSnapshot.skipConfigs,
      strategy
    ),
  };
}

export function summarizeDesktopProfileSnapshot(
  snapshot: DesktopProfileSnapshot
): DesktopProfileSnapshotSummary {
  return {
    playRecordCount: Object.keys(snapshot.playRecords).length,
    favoriteCount: Object.keys(snapshot.favorites).length,
    followCount: Object.keys(snapshot.follows).length,
    searchHistoryCount: snapshot.searchHistory.length,
    skipConfigCount: Object.keys(snapshot.skipConfigs).length,
  };
}
