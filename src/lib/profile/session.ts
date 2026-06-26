import { clearAuthInfoInBrowser } from '@/lib/auth';
import { purgeOfflineDownloads } from '@/lib/download/session';
import { buildApiUrl } from '@/lib/transport/endpoint';

import { PROFILE_SESSION_API_PATHS } from './contracts';
import { isDesktopLocalProfileRuntime } from './runtime';

const DESKTOP_LOCAL_PROFILE_FETCH_RETRY_COUNT = 10;
const DESKTOP_LOCAL_PROFILE_FETCH_RETRY_DELAY_MS = 300;
const RETRYABLE_DESKTOP_LOCAL_PROFILE_RESPONSE_STATUSES = new Set([
  408, 425, 429, 500, 502, 503, 504,
]);

export interface ProfileRequestInit extends RequestInit {
  redirectOnUnauthorized?: boolean;
}

export class ProfileRequestError extends Error {
  status: number | null;
  redirectedToLogin: boolean;

  constructor(
    message: string,
    options?: {
      status?: number | null;
      redirectedToLogin?: boolean;
    }
  ) {
    super(message);
    this.name = 'ProfileRequestError';
    this.status = options?.status ?? null;
    this.redirectedToLogin = options?.redirectedToLogin ?? false;
  }
}

export function isProfileRequestError(
  error: unknown
): error is ProfileRequestError {
  return error instanceof ProfileRequestError;
}

export function isUnauthorizedProfileRequestError(error: unknown): boolean {
  return isProfileRequestError(error) && error.status === 401;
}

export function wasProfileRequestRedirectedToLogin(error: unknown): boolean {
  return isProfileRequestError(error) && error.redirectedToLogin;
}

export function resolveProfileApiRequestUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : buildApiUrl(url);
}

export function buildProfileLoginRedirectUrl(
  currentUrl: string,
  origin: string
): string {
  const loginUrl = new URL('/login', origin);
  if (currentUrl.trim()) {
    loginUrl.searchParams.set('redirect', currentUrl);
  }

  return loginUrl.toString();
}

function isRecoverableDesktopLocalProfileRequestError(error: unknown): boolean {
  if (!isDesktopLocalProfileRuntime()) {
    return false;
  }

  if (error instanceof TypeError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return /failed to fetch|load failed|network|err_connection_refused/i.test(
    error.message
  );
}

function isSafeProfileRequestMethod(method?: string | null): boolean {
  const normalizedMethod = method?.trim().toUpperCase();
  return (
    !normalizedMethod ||
    normalizedMethod === 'GET' ||
    normalizedMethod === 'HEAD'
  );
}

function shouldRetryDesktopLocalProfileResponse(
  response: Response,
  requestInit: RequestInit
): boolean {
  return (
    isDesktopLocalProfileRuntime() &&
    isSafeProfileRequestMethod(requestInit.method) &&
    RETRYABLE_DESKTOP_LOCAL_PROFILE_RESPONSE_STATUSES.has(response.status)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function logoutProfileSession(): Promise<void> {
  await purgeOfflineDownloads();
  await fetch(buildApiUrl(PROFILE_SESSION_API_PATHS.logout), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function fetchProfileResponse(
  url: string,
  options?: ProfileRequestInit
): Promise<Response> {
  const {
    redirectOnUnauthorized = true,
    credentials,
    ...requestOptions
  } = options || {};
  const requestUrl = resolveProfileApiRequestUrl(url);
  const requestInit: RequestInit = {
    ...requestOptions,
    credentials: credentials || 'same-origin',
  };

  let response: Response | null = null;

  for (
    let attempt = 0;
    attempt < DESKTOP_LOCAL_PROFILE_FETCH_RETRY_COUNT;
    attempt += 1
  ) {
    try {
      response = await fetch(requestUrl, requestInit);
    } catch (error) {
      if (
        !isRecoverableDesktopLocalProfileRequestError(error) ||
        attempt + 1 >= DESKTOP_LOCAL_PROFILE_FETCH_RETRY_COUNT
      ) {
        throw error;
      }

      await delay(DESKTOP_LOCAL_PROFILE_FETCH_RETRY_DELAY_MS);
      continue;
    }

    if (
      response &&
      shouldRetryDesktopLocalProfileResponse(response, requestInit) &&
      attempt + 1 < DESKTOP_LOCAL_PROFILE_FETCH_RETRY_COUNT
    ) {
      await delay(DESKTOP_LOCAL_PROFILE_FETCH_RETRY_DELAY_MS);
      response = null;
      continue;
    }

    break;
  }

  if (!response) {
    throw new ProfileRequestError(`Request ${requestUrl} failed to start.`, {
      status: null,
    });
  }

  if (response.ok) {
    return response;
  }

  if (response.status === 401) {
    if (!redirectOnUnauthorized || typeof window === 'undefined') {
      throw new ProfileRequestError(
        `Request ${requestUrl} failed: ${response.status}`,
        {
          status: response.status,
        }
      );
    }

    clearAuthInfoInBrowser();

    try {
      await logoutProfileSession();
    } catch (error) {
      // Keep a local diagnostic here because losing the cleanup error hides auth bugs.
      // eslint-disable-next-line no-console
      console.error('Failed to clear profile session after 401:', error);
    }

    const currentUrl = `${window.location.pathname}${window.location.search}`;
    window.location.href = buildProfileLoginRedirectUrl(
      currentUrl,
      window.location.origin
    );
    throw new ProfileRequestError(
      'Unauthorized profile request redirected to login.',
      {
        status: response.status,
        redirectedToLogin: true,
      }
    );
  }

  throw new ProfileRequestError(
    `Request ${requestUrl} failed: ${response.status}`,
    {
      status: response.status,
    }
  );
}

export async function fetchProfileJson<T>(
  url: string,
  options?: ProfileRequestInit
): Promise<T> {
  const response = await fetchProfileResponse(url, options);
  return (await response.json()) as T;
}
