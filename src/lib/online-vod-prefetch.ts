import { apiFetch } from '@/lib/transport/api-client';

export type OnlineVodPrefetchWindowMode = '30s' | '60s' | 'episode';

export interface OnlineVodPrefetchPreferences {
  enabled: boolean;
  windowMode: OnlineVodPrefetchWindowMode;
}

export type OnlineVodPrefetchTaskState =
  | 'running'
  | 'paused'
  | 'completed'
  | 'stopped';

export interface OnlineVodPrefetchStatus {
  sessionId: string;
  state: OnlineVodPrefetchTaskState;
  windowMode: OnlineVodPrefetchWindowMode;
  queuedCount: number;
  completedCount: number;
  cachedCount: number;
  cacheBytes: number;
  currentRendition: string;
  failureReason: string | null;
  canRetry: boolean;
}

export const ONLINE_VOD_PREFETCH_UPDATED_EVENT =
  'lunatv:online-vod-prefetch-updated';

const ENABLED_STORAGE_KEY = 'onlineVodPrefetchEnabled';
const WINDOW_MODE_STORAGE_KEY = 'onlineVodPrefetchWindowMode';

function normalizeWindowMode(
  value: string | null
): OnlineVodPrefetchWindowMode {
  if (value === '60s' || value === 'episode') {
    return value;
  }
  return '30s';
}

function parseStoredBoolean(value: string | null): boolean {
  return value === 'true';
}

export function readOnlineVodPrefetchPreferences(): OnlineVodPrefetchPreferences {
  if (typeof window === 'undefined') {
    return { enabled: false, windowMode: '30s' };
  }
  return {
    enabled: parseStoredBoolean(
      window.localStorage.getItem(ENABLED_STORAGE_KEY)
    ),
    windowMode: normalizeWindowMode(
      window.localStorage.getItem(WINDOW_MODE_STORAGE_KEY)
    ),
  };
}

export function updateOnlineVodPrefetchPreferences(
  update: Partial<OnlineVodPrefetchPreferences>
): OnlineVodPrefetchPreferences {
  const preferences = {
    ...readOnlineVodPrefetchPreferences(),
    ...update,
  };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      ENABLED_STORAGE_KEY,
      String(preferences.enabled)
    );
    window.localStorage.setItem(
      WINDOW_MODE_STORAGE_KEY,
      preferences.windowMode
    );
    window.dispatchEvent(
      new CustomEvent<OnlineVodPrefetchPreferences>(
        ONLINE_VOD_PREFETCH_UPDATED_EVENT,
        { detail: preferences }
      )
    );
  }
  return preferences;
}

async function parsePrefetchResponse<T>(
  responsePromise: Promise<Response>
): Promise<T> {
  const response = await responsePromise;
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || `VOD 预取请求失败 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function startOnlineVodPrefetch(
  sessionId: string,
  manifestUrl: string,
  windowMode: OnlineVodPrefetchWindowMode
): Promise<OnlineVodPrefetchStatus> {
  return parsePrefetchResponse<OnlineVodPrefetchStatus>(
    apiFetch('/api/vod-prefetch/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, manifestUrl, windowMode }),
    })
  );
}

export function advanceOnlineVodPrefetch(
  sessionId: string,
  segmentUrl: string
): Promise<OnlineVodPrefetchStatus> {
  return parsePrefetchResponse<OnlineVodPrefetchStatus>(
    apiFetch('/api/vod-prefetch/session/advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, segmentUrl }),
    })
  );
}

export function retryOnlineVodPrefetch(
  sessionId: string
): Promise<OnlineVodPrefetchStatus> {
  return parsePrefetchResponse<OnlineVodPrefetchStatus>(
    apiFetch('/api/vod-prefetch/session/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
  );
}

export function getOnlineVodPrefetchStatus(
  sessionId: string
): Promise<OnlineVodPrefetchStatus | null> {
  return parsePrefetchResponse<OnlineVodPrefetchStatus | null>(
    apiFetch('/api/vod-prefetch/session', { searchParams: { sessionId } })
  );
}

export function stopOnlineVodPrefetch(
  sessionId: string
): Promise<OnlineVodPrefetchStatus | null> {
  return parsePrefetchResponse<OnlineVodPrefetchStatus | null>(
    apiFetch('/api/vod-prefetch/session', {
      method: 'DELETE',
      searchParams: { sessionId },
    })
  );
}
