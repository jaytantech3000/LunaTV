import { clearAuthInfoInBrowser } from '@/lib/auth';
import { purgeOfflineDownloads } from '@/lib/download/session';
import { buildApiUrl } from '@/lib/transport/endpoint';

import { PROFILE_SESSION_API_PATHS } from './contracts';

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
  const response = await fetch(requestUrl, {
    ...requestOptions,
    credentials: credentials || 'same-origin',
  });

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
