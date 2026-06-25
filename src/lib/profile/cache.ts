import {
  type SearchHistoryEntry,
  decodeSearchHistoryValues,
} from '@/lib/search-history';

import { type ProfileCacheUpdateEvent } from './contracts';

export function dispatchProfileCacheUpdate<T>(
  eventType: ProfileCacheUpdateEvent,
  detail: T
): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(eventType, {
      detail,
    })
  );
}

export function dispatchProfileSearchHistoryUpdated(
  rawHistory: string[]
): void {
  dispatchProfileCacheUpdate<SearchHistoryEntry[]>(
    'searchHistoryUpdated',
    decodeSearchHistoryValues(rawHistory)
  );
}

export function subscribeToProfileCacheUpdates<T>(
  eventType: ProfileCacheUpdateEvent,
  callback: (data: T) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleUpdate = (event: CustomEvent) => {
    callback(event.detail);
  };

  window.addEventListener(eventType, handleUpdate as EventListener);

  return () => {
    window.removeEventListener(eventType, handleUpdate as EventListener);
  };
}
