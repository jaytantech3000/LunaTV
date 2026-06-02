'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  DEFAULT_GLOBAL_MINIMUM_RATING,
  normalizeMinimumRating,
} from '@/lib/rating-filter';

interface GlobalRatingFilterState {
  hasHydrated: boolean;
  enabled: boolean;
  minimumRating: number;
  setHasHydrated: (hasHydrated: boolean) => void;
  setEnabled: (enabled: boolean) => void;
  setMinimumRating: (minimumRating: number) => void;
}

type PersistedGlobalRatingFilterState = Pick<
  GlobalRatingFilterState,
  'enabled' | 'minimumRating'
>;

const LEGACY_GLOBAL_MINIMUM_RATING = 8;

const emptyPersistedGlobalRatingFilterState: PersistedGlobalRatingFilterState =
  {
    enabled: false,
    minimumRating: DEFAULT_GLOBAL_MINIMUM_RATING,
  };

function normalizePersistedState(
  state?: PersistedGlobalRatingFilterState
): PersistedGlobalRatingFilterState {
  return {
    enabled: state?.enabled === true,
    minimumRating: normalizeMinimumRating(
      state?.minimumRating ?? DEFAULT_GLOBAL_MINIMUM_RATING
    ),
  };
}

export const useGlobalRatingFilterStore = create<GlobalRatingFilterState>()(
  persist(
    (set) => ({
      hasHydrated: false,
      enabled: false,
      minimumRating: DEFAULT_GLOBAL_MINIMUM_RATING,
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setEnabled: (enabled) => set({ enabled }),
      setMinimumRating: (minimumRating) =>
        set({ minimumRating: normalizeMinimumRating(minimumRating) }),
    }),
    {
      name: 'global-rating-filter-v1',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedGlobalRatingFilterState => ({
        enabled: state.enabled,
        minimumRating: normalizeMinimumRating(state.minimumRating),
      }),
      migrate: (persistedState, version) => {
        const normalizedState = normalizePersistedState(
          persistedState as PersistedGlobalRatingFilterState | undefined
        );

        if (
          version < 2 &&
          normalizedState.enabled === false &&
          normalizedState.minimumRating === LEGACY_GLOBAL_MINIMUM_RATING
        ) {
          return {
            ...normalizedState,
            minimumRating: DEFAULT_GLOBAL_MINIMUM_RATING,
          };
        }

        return normalizedState;
      },
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizePersistedState(
          (persistedState as PersistedGlobalRatingFilterState | undefined) ||
            emptyPersistedGlobalRatingFilterState
        ),
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
