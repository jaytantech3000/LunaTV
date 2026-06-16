import { NextRequest } from 'next/server';

const SHARED_AUTH_COOKIE_ROOT_DOMAIN = 'hkcu.qzz.io';

function normalizeHost(host: string | null | undefined): string {
  return host?.split(',')[0]?.split(':')[0].trim().toLowerCase() || '';
}

function resolveSharedAuthCookieDomain(
  request: NextRequest
): string | undefined {
  const configuredDomain = process.env.AUTH_COOKIE_DOMAIN?.trim().toLowerCase();
  if (configuredDomain) {
    return configuredDomain;
  }

  const forwardedHost = normalizeHost(request.headers.get('x-forwarded-host'));
  const requestHost =
    normalizeHost(request.headers.get('host')) ||
    normalizeHost(request.nextUrl.hostname);

  if (!forwardedHost || !requestHost || forwardedHost === requestHost) {
    return undefined;
  }

  const usesSharedRootDomain = [forwardedHost, requestHost].every(
    (host) =>
      host === SHARED_AUTH_COOKIE_ROOT_DOMAIN ||
      host.endsWith(`.${SHARED_AUTH_COOKIE_ROOT_DOMAIN}`)
  );

  return usesSharedRootDomain ? SHARED_AUTH_COOKIE_ROOT_DOMAIN : undefined;
}

function isSecureRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();

  return forwardedProto === 'https' || request.nextUrl.protocol === 'https:';
}

export function buildAuthCookieOptions(
  request: NextRequest,
  expires: Date
): {
  domain?: string;
  expires: Date;
  httpOnly: false;
  path: '/';
  sameSite: 'lax';
  secure: boolean;
} {
  const domain = resolveSharedAuthCookieDomain(request);

  return {
    ...(domain ? { domain } : {}),
    expires,
    httpOnly: false,
    path: '/',
    sameSite: 'lax',
    secure: isSecureRequest(request),
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
    const authData = JSON.parse(decoded);
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
