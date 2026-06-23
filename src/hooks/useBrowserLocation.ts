'use client';

import { useSyncExternalStore } from 'react';

const LOCATION_CHANGE_EVENT = 'lunatv:locationchange';

interface BrowserLocationSnapshot {
  href: string;
  pathname: string;
  search: string;
}

const SERVER_SNAPSHOT: BrowserLocationSnapshot = {
  href: '',
  pathname: '',
  search: '',
};

let isHistoryPatched = false;
let cachedSnapshot = SERVER_SNAPSHOT;

function dispatchLocationChange() {
  window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
}

function patchHistoryMethod(method: 'pushState' | 'replaceState') {
  const originalMethod = window.history[method].bind(window.history);

  window.history[method] = ((...args: Parameters<History['pushState']>) => {
    const result = originalMethod(...args);
    dispatchLocationChange();
    return result;
  }) as History['pushState'];
}

function ensureLocationChangeEvents() {
  if (isHistoryPatched || typeof window === 'undefined') {
    return;
  }

  isHistoryPatched = true;
  patchHistoryMethod('pushState');
  patchHistoryMethod('replaceState');
  window.addEventListener('popstate', dispatchLocationChange);
  window.addEventListener('hashchange', dispatchLocationChange);
}

function getBrowserLocationSnapshot(): BrowserLocationSnapshot {
  if (typeof window === 'undefined') {
    return SERVER_SNAPSHOT;
  }

  const { pathname, search } = window.location;
  const href = `${pathname}${search}`;

  if (cachedSnapshot.href === href) {
    return cachedSnapshot;
  }

  cachedSnapshot = {
    href,
    pathname,
    search,
  };

  return cachedSnapshot;
}

function subscribeToBrowserLocationChange(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  ensureLocationChangeEvents();
  window.addEventListener(LOCATION_CHANGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener(LOCATION_CHANGE_EVENT, onStoreChange);
  };
}

export function useBrowserLocation() {
  return useSyncExternalStore(
    subscribeToBrowserLocationChange,
    getBrowserLocationSnapshot,
    () => SERVER_SNAPSHOT
  );
}
