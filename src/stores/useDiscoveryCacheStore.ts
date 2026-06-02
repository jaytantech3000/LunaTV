'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { BangumiCalendarData } from '@/lib/bangumi.client';
import type { DoubanItem } from '@/lib/types';

export const DISCOVERY_CACHE_TTL_MS = 30 * 60 * 1000;

interface TimedCacheEntry {
  updatedAt?: number;
}

export interface HomeDiscoveryCacheEntry extends TimedCacheEntry {
  hotMovies: DoubanItem[];
  hotTvShows: DoubanItem[];
  hotVarietyShows: DoubanItem[];
  bangumiCalendarData: BangumiCalendarData[];
}

export interface DoubanPageCacheEntry extends TimedCacheEntry {
  items: DoubanItem[];
  loadedPageIndex: number;
  hasMore: boolean;
}

interface DiscoveryCacheState {
  hasHydrated: boolean;
  homeDiscoveryEntry: HomeDiscoveryCacheEntry | null;
  doubanPageEntries: Record<string, DoubanPageCacheEntry>;
  setHasHydrated: (hasHydrated: boolean) => void;
  setHomeDiscoveryEntry: (entry: HomeDiscoveryCacheEntry | null) => void;
  setDoubanPageEntry: (key: string, entry: DoubanPageCacheEntry) => void;
}

type PersistedDiscoveryCacheState = Pick<
  DiscoveryCacheState,
  'homeDiscoveryEntry' | 'doubanPageEntries'
>;

const emptyPersistedDiscoveryCacheState: PersistedDiscoveryCacheState = {
  homeDiscoveryEntry: null,
  doubanPageEntries: {},
};

export function buildHomeDiscoveryCacheEntry(
  partialEntry: Partial<HomeDiscoveryCacheEntry> = {}
): HomeDiscoveryCacheEntry {
  return {
    hotMovies: [],
    hotTvShows: [],
    hotVarietyShows: [],
    bangumiCalendarData: [],
    ...partialEntry,
  };
}

export function buildDoubanPageCacheEntry(
  partialEntry: Partial<DoubanPageCacheEntry> = {}
): DoubanPageCacheEntry {
  return {
    items: [],
    loadedPageIndex: 0,
    hasMore: true,
    ...partialEntry,
  };
}

export function isDiscoveryCacheEntryFresh(
  entry?: TimedCacheEntry | null,
  ttlMs = DISCOVERY_CACHE_TTL_MS
): boolean {
  if (!entry?.updatedAt) {
    return false;
  }

  return Date.now() - entry.updatedAt < ttlMs;
}

function sanitizeHomeDiscoveryCacheEntry(
  entry?: HomeDiscoveryCacheEntry | null
): HomeDiscoveryCacheEntry | null {
  if (!entry || !isDiscoveryCacheEntryFresh(entry)) {
    return null;
  }

  return buildHomeDiscoveryCacheEntry({
    hotMovies: Array.isArray(entry.hotMovies) ? entry.hotMovies : [],
    hotTvShows: Array.isArray(entry.hotTvShows) ? entry.hotTvShows : [],
    hotVarietyShows: Array.isArray(entry.hotVarietyShows)
      ? entry.hotVarietyShows
      : [],
    bangumiCalendarData: Array.isArray(entry.bangumiCalendarData)
      ? entry.bangumiCalendarData
      : [],
    updatedAt: entry.updatedAt,
  });
}

function sanitizeDoubanPageCacheEntry(
  entry?: DoubanPageCacheEntry | null
): DoubanPageCacheEntry | null {
  if (!entry || !isDiscoveryCacheEntryFresh(entry)) {
    return null;
  }

  return buildDoubanPageCacheEntry({
    items: Array.isArray(entry.items) ? entry.items : [],
    loadedPageIndex:
      typeof entry.loadedPageIndex === 'number' ? entry.loadedPageIndex : 0,
    hasMore: entry.hasMore !== false,
    updatedAt: entry.updatedAt,
  });
}

function sanitizeDoubanPageCacheEntries(
  entries?: Record<string, DoubanPageCacheEntry>
): Record<string, DoubanPageCacheEntry> {
  if (!entries) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(entries).flatMap(([key, entry]) => {
      const sanitizedEntry = sanitizeDoubanPageCacheEntry(entry);
      return sanitizedEntry ? [[key, sanitizedEntry]] : [];
    })
  );
}

export const useDiscoveryCacheStore = create<DiscoveryCacheState>()(
  persist(
    (set) => ({
      hasHydrated: false,
      homeDiscoveryEntry: null,
      doubanPageEntries: {},
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setHomeDiscoveryEntry: (entry) => set({ homeDiscoveryEntry: entry }),
      setDoubanPageEntry: (key, entry) =>
        set((state) => ({
          doubanPageEntries: {
            ...state.doubanPageEntries,
            [key]: entry,
          },
        })),
    }),
    {
      name: 'discovery-cache-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedDiscoveryCacheState => ({
        homeDiscoveryEntry: sanitizeHomeDiscoveryCacheEntry(
          state.homeDiscoveryEntry
        ),
        doubanPageEntries: sanitizeDoubanPageCacheEntries(
          state.doubanPageEntries
        ),
      }),
      merge: (persistedState, currentState) => {
        const persistedDiscoveryCacheState =
          (persistedState as PersistedDiscoveryCacheState | undefined) ||
          emptyPersistedDiscoveryCacheState;

        return {
          ...currentState,
          homeDiscoveryEntry: sanitizeHomeDiscoveryCacheEntry(
            persistedDiscoveryCacheState.homeDiscoveryEntry
          ),
          doubanPageEntries: sanitizeDoubanPageCacheEntries(
            persistedDiscoveryCacheState.doubanPageEntries
          ),
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
