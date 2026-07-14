import { NextRequest } from 'next/server';

import {
  AppStorageType,
  getConfiguredStorageType,
  getProfileMode,
  ProfileMode,
} from '@/lib/runtime/storage-mode';

export interface AuthCookiePayload {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
  role?: 'owner' | 'admin' | 'user';
  sessionMode?: 'desktop-local' | 'desktop-profile-sync';
}

export const DESKTOP_AUTH_STORAGE_KEY = 'lunatv:desktop-auth-session';
export const BROWSER_AUTH_INFO_COOKIE_NAME = 'auth-info';
export const BROWSER_AUTH_UPDATED_EVENT = 'lunatv:browser-auth-updated';

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

export interface AuthContext {
  username: string;
  role?: 'owner' | 'admin' | 'user';
  signature?: string;
  timestamp?: number;
  source: 'request-cookie' | 'browser-cookie' | 'internal';
}

export interface ProfileContext extends AuthContext {
  storageType: AppStorageType;
  profileMode: ProfileMode;
}

export class AuthContextError extends Error {
  status: number;

  constructor(message = 'Unauthorized', status = 401) {
    super(message);
    this.name = 'AuthContextError';
    this.status = status;
  }
}

function toAuthContext(
  payload: AuthCookiePayload | null,
  source: AuthContext['source']
): AuthContext | null {
  if (!payload?.username) {
    return null;
  }

  return {
    username: payload.username,
    role: payload.role,
    signature: payload.signature,
    timestamp: payload.timestamp,
    source,
  };
}

function parseAuthCookiePayload(rawValue: string): AuthCookiePayload | null {
  try {
    let decoded = decodeURIComponent(rawValue);

    if (decoded.includes('%')) {
      decoded = decodeURIComponent(decoded);
    }

    return JSON.parse(decoded) as AuthCookiePayload;
  } catch (_) {
    return null;
  }
}

function sanitizeAuthPayloadForCookie(
  payload: AuthCookiePayload
): AuthCookiePayload {
  const { password: _password, ...cookiePayload } = payload;
  return cookiePayload;
}

function isDesktopBrowserContext(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return Boolean(
    window.__TAURI__ ||
      window.__TAURI_INTERNALS__ ||
      window.RUNTIME_CONFIG?.APP_TARGET === 'desktop'
  );
}

function readDesktopAuthInfoFromStorage(): AuthCookiePayload | null {
  if (typeof window === 'undefined' || !isDesktopBrowserContext()) {
    return null;
  }

  try {
    const rawValue = localStorage.getItem(DESKTOP_AUTH_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    return JSON.parse(rawValue) as AuthCookiePayload;
  } catch (_) {
    return null;
  }
}

function persistDesktopAuthInfo(payload: AuthCookiePayload | null) {
  if (typeof window === 'undefined' || !isDesktopBrowserContext()) {
    return;
  }

  try {
    if (payload) {
      localStorage.setItem(
        DESKTOP_AUTH_STORAGE_KEY,
        JSON.stringify(sanitizeAuthPayloadForCookie(payload))
      );
    } else {
      localStorage.removeItem(DESKTOP_AUTH_STORAGE_KEY);
    }
  } catch (_) {
    // Ignore storage write failures in restricted contexts.
  }
}

function writeAuthCookie(payload: AuthCookiePayload | null) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!payload) {
    if (isDesktopBrowserContext()) {
      document.cookie =
        'auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    }
    document.cookie = `${BROWSER_AUTH_INFO_COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
    return;
  }

  const expires = new Date();
  expires.setDate(expires.getDate() + 7);
  const value = encodeURIComponent(
    JSON.stringify(sanitizeAuthPayloadForCookie(payload))
  );
  if (isDesktopBrowserContext()) {
    document.cookie = `auth=${value}; path=/; expires=${expires.toUTCString()}; SameSite=Lax`;
  }
  document.cookie = `${BROWSER_AUTH_INFO_COOKIE_NAME}=${value}; path=/; expires=${expires.toUTCString()}; SameSite=Lax`;
}

function mergeCookieAndDesktopStorageAuthInfo(
  cookieAuthInfo: AuthCookiePayload | null
): AuthCookiePayload | null {
  const storedAuthInfo = readDesktopAuthInfoFromStorage();

  if (!cookieAuthInfo) {
    return storedAuthInfo;
  }

  if (
    !storedAuthInfo ||
    cookieAuthInfo.sessionMode !== 'desktop-profile-sync' ||
    storedAuthInfo.sessionMode !== 'desktop-profile-sync' ||
    !cookieAuthInfo.username?.trim() ||
    cookieAuthInfo.username !== storedAuthInfo.username
  ) {
    return cookieAuthInfo;
  }

  return {
    ...storedAuthInfo,
    ...cookieAuthInfo,
    password: cookieAuthInfo.password ?? storedAuthInfo.password,
  };
}

function dispatchBrowserAuthUpdated() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(BROWSER_AUTH_UPDATED_EVENT));
}

export function createProfileContext(
  authContext: AuthContext,
  options: {
    storageType?: AppStorageType;
    profileMode?: ProfileMode;
  } = {}
): ProfileContext {
  const storageType = options.storageType || getConfiguredStorageType();
  const profileMode = options.profileMode || getProfileMode(storageType);

  return {
    ...authContext,
    storageType,
    profileMode,
  };
}

export function setAuthInfoInBrowser(payload: AuthCookiePayload | null) {
  writeAuthCookie(payload);
  persistDesktopAuthInfo(payload);
  dispatchBrowserAuthUpdated();
}

export function clearAuthInfoInBrowser() {
  setAuthInfoInBrowser(null);
}

// 从cookie获取认证信息 (服务端使用)
export function getAuthInfoFromCookie(request: NextRequest): {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
  role?: 'owner' | 'admin' | 'user';
  sessionMode?: 'desktop-local' | 'desktop-profile-sync';
} | null {
  const authCookie = request.cookies.get('auth');

  if (!authCookie) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(authCookie.value);
    const authData = JSON.parse(decoded) as AuthCookiePayload;
    return authData;
  } catch (error) {
    return null;
  }
}

// 从cookie获取认证信息 (客户端使用)
export function getAuthInfoFromBrowserCookie(): {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
  role?: 'owner' | 'admin' | 'user';
  sessionMode?: 'desktop-local' | 'desktop-profile-sync';
} | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    // 解析 document.cookie
    const cookies = document.cookie.split(';').reduce((acc, cookie) => {
      const trimmed = cookie.trim();
      const firstEqualIndex = trimmed.indexOf('=');

      if (firstEqualIndex > 0) {
        const key = trimmed.substring(0, firstEqualIndex);
        const value = trimmed.substring(firstEqualIndex + 1);
        if (key && value) {
          acc[key] = value;
        }
      }

      return acc;
    }, {} as Record<string, string>);

    const authInfoCookie = cookies[BROWSER_AUTH_INFO_COOKIE_NAME];
    const cookieAuthInfo = authInfoCookie
      ? parseAuthCookiePayload(authInfoCookie)
      : null;

    return mergeCookieAndDesktopStorageAuthInfo(cookieAuthInfo);
  } catch (error) {
    return readDesktopAuthInfoFromStorage();
  }
}

export function getAuthContextFromRequest(
  request: NextRequest
): AuthContext | null {
  return toAuthContext(getAuthInfoFromCookie(request), 'request-cookie');
}

export function requireAuthContextFromRequest(
  request: NextRequest
): AuthContext {
  const authContext = getAuthContextFromRequest(request);
  if (!authContext) {
    throw new AuthContextError();
  }

  return authContext;
}

export function getAuthContextFromBrowserCookie(): AuthContext | null {
  return toAuthContext(getAuthInfoFromBrowserCookie(), 'browser-cookie');
}
