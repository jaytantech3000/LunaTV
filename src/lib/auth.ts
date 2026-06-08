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

// 从cookie获取认证信息 (服务端使用)
export function getAuthInfoFromCookie(request: NextRequest): {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
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

    const authCookie = cookies['auth'];
    if (!authCookie) {
      return null;
    }

    // 处理可能的双重编码
    let decoded = decodeURIComponent(authCookie);

    // 如果解码后仍然包含 %，说明是双重编码，需要再次解码
    if (decoded.includes('%')) {
      decoded = decodeURIComponent(decoded);
    }

    const authData = JSON.parse(decoded);
    return authData;
  } catch (error) {
    return null;
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
