import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

import { shouldUseProfileApiStorage } from './runtime';

export const PROFILE_API_NO_REDIRECT_OPTIONS = {
  redirectOnUnauthorized: false,
} as const;

export function isProfileApiAuthPending(): boolean {
  if (typeof window === 'undefined' || !shouldUseProfileApiStorage()) {
    return false;
  }

  return !getAuthInfoFromBrowserCookie()?.username?.trim();
}

export const isDesktopLocalProfileAuthPending = isProfileApiAuthPending;
