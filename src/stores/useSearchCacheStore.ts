'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DoubanAggregateItem } from '@/components/search/doubanAggregationData';

export interface SearchCacheEntry {
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: DoubanAggregateItem[];
  totalCollections: number;
  completedCollections: number;
  error?: string;
  updatedAt?: number;
}

export const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;

const createEmptyEntry = (): SearchCacheEntry => ({
  status: 'idle',
  items: [],
  totalCollections: 0,
  completedCollections: 0,
});

interface SearchCacheState {
  hasHydrated: boolean;
  doubanModeEntries: Record<string, SearchCacheEntry>;
  globalDiscoveryEntries: Record<string, SearchCacheEntry>;
  setHasHydrated: (hasHydrated: boolean) => void;
  setDoubanModeEntry: (key: string, entry: SearchCacheEntry) => void;
  patchDoubanModeEntry: (
    key: string,
    updater: (previousEntry: SearchCacheEntry) => SearchCacheEntry
  ) => void;
  setGlobalDiscoveryEntry: (key: string, entry: SearchCacheEntry) => void;
  patchGlobalDiscoveryEntry: (
    key: string,
    updater: (previousEntry: SearchCacheEntry) => SearchCacheEntry
  ) => void;
}

type PersistedSearchCacheState = Pick<
  SearchCacheState,
  'doubanModeEntries' | 'globalDiscoveryEntries'
>;

const emptyPersistedSearchCacheState: PersistedSearchCacheState = {
  doubanModeEntries: {},
  globalDiscoveryEntries: {},
};

export function buildSearchCacheEntry(
  partialEntry: Partial<SearchCacheEntry> = {}
): SearchCacheEntry {
  return {
    ...createEmptyEntry(),
    ...partialEntry,
  };
}

export function isSearchCacheEntryFresh(
  entry?: SearchCacheEntry | null,
  ttlMs = SEARCH_CACHE_TTL_MS
): boolean {
  if (!entry || entry.status !== 'ready' || !entry.updatedAt) {
    return false;
  }

  return Date.now() - entry.updatedAt < ttlMs;
}

function sanitizeSearchCacheEntry(
  entry?: SearchCacheEntry | null
): SearchCacheEntry | null {
  if (!entry) {
    return null;
  }

  const normalizedEntry = buildSearchCacheEntry({
    status: entry.status,
    items: Array.isArray(entry.items) ? entry.items : [],
    totalCollections:
      typeof entry.totalCollections === 'number' ? entry.totalCollections : 0,
    completedCollections:
      typeof entry.completedCollections === 'number'
        ? entry.completedCollections
        : 0,
    error: typeof entry.error === 'string' ? entry.error : undefined,
    updatedAt:
      typeof entry.updatedAt === 'number' ? entry.updatedAt : undefined,
  });

  if (!isSearchCacheEntryFresh(normalizedEntry)) {
    return null;
  }

  return normalizedEntry;
}

function sanitizeSearchCacheEntries(
  entries?: Record<string, SearchCacheEntry>
): Record<string, SearchCacheEntry> {
  if (!entries) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(entries).flatMap(([key, entry]) => {
      const normalizedEntry = sanitizeSearchCacheEntry(entry);
      return normalizedEntry ? [[key, normalizedEntry]] : [];
    })
  );
}

export const useSearchCacheStore = create<SearchCacheState>()(
  persist(
    (set) => ({
      hasHydrated: false,
      doubanModeEntries: {},
      globalDiscoveryEntries: {},
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setDoubanModeEntry: (key, entry) =>
        set((state) => ({
          doubanModeEntries: {
            ...state.doubanModeEntries,
            [key]: entry,
          },
        })),
      patchDoubanModeEntry: (key, updater) =>
        set((state) => ({
          doubanModeEntries: {
            ...state.doubanModeEntries,
            [key]: updater(state.doubanModeEntries[key] || createEmptyEntry()),
          },
        })),
      setGlobalDiscoveryEntry: (key, entry) =>
        set((state) => ({
          globalDiscoveryEntries: {
            ...state.globalDiscoveryEntries,
            [key]: entry,
          },
        })),
      patchGlobalDiscoveryEntry: (key, updater) =>
        set((state) => ({
          globalDiscoveryEntries: {
            ...state.globalDiscoveryEntries,
            [key]: updater(
              state.globalDiscoveryEntries[key] || createEmptyEntry()
            ),
          },
        })),
    }),
    {
      name: 'search-cache-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedSearchCacheState => ({
        doubanModeEntries: sanitizeSearchCacheEntries(state.doubanModeEntries),
        globalDiscoveryEntries: sanitizeSearchCacheEntries(
          state.globalDiscoveryEntries
        ),
      }),
      merge: (persistedState, currentState) => {
        const persistedCacheState =
          (persistedState as PersistedSearchCacheState | undefined) ||
          emptyPersistedSearchCacheState;

        return {
          ...currentState,
          doubanModeEntries: sanitizeSearchCacheEntries(
            persistedCacheState.doubanModeEntries
          ),
          globalDiscoveryEntries: sanitizeSearchCacheEntries(
            persistedCacheState.globalDiscoveryEntries
          ),
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
