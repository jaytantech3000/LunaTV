/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

const ROOT_DOMAIN = 'hkcu.qzz.io';
const AUTH_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type AuthRole = 'owner' | 'admin' | 'user';

function buildAuthSignaturePayload(
  username: string,
  role: AuthRole,
  timestamp: number
): string {
  return `${username}:${role}:${timestamp}`;
}

export async function middleware(request: NextRequest) {
  const host = normalizeHost(request.headers.get('host'));
  const { pathname } = request.nextUrl;
  const appTarget =
    process.env.NEXT_PUBLIC_APP_TARGET || process.env.APP_TARGET;

  if (appTarget === 'desktop') {
    return NextResponse.next();
  }

  if (process.env.NODE_ENV !== 'development' && !isAllowedHost(host)) {
    return new NextResponse('Access Denied: Please use the official domain.', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // 跳过不需要认证的路径
  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  if (!process.env.PASSWORD) {
    const warningUrl = new URL('/warning', request.url);
    return NextResponse.redirect(warningUrl);
  }

  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo) {
    return handleAuthFailure(request, pathname);
  }

  // localstorage mode uses the same signed, expiring cookie as other modes.
  if (
    !authInfo.username ||
    !authInfo.signature ||
    !authInfo.timestamp ||
    !isAuthRole(authInfo.role) ||
    !isValidAuthTimestamp(authInfo.timestamp)
  ) {
    return handleAuthFailure(request, pathname);
  }

  const isValidSignature = await verifySignature(
    buildAuthSignaturePayload(
      authInfo.username,
      authInfo.role,
      authInfo.timestamp
    ),
    authInfo.signature,
    process.env.PASSWORD || ''
  );

  return isValidSignature
    ? NextResponse.next()
    : handleAuthFailure(request, pathname);
}

function isAuthRole(value: unknown): value is AuthRole {
  return value === 'owner' || value === 'admin' || value === 'user';
}

function isValidAuthTimestamp(timestamp: number): boolean {
  return (
    Number.isSafeInteger(timestamp) &&
    timestamp <= Date.now() &&
    Date.now() - timestamp <= AUTH_SESSION_MAX_AGE_MS
  );
}

// 验证签名
async function verifySignature(
  data: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  try {
    // 导入密钥
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // 将十六进制字符串转换为Uint8Array
    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
    );

    // 验证签名
    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      messageData
    );
  } catch (error) {
    console.error('签名验证失败:', error);
    return false;
  }
}

// 处理认证失败的情况
function handleAuthFailure(
  request: NextRequest,
  pathname: string
): NextResponse {
  // 如果是 API 路由，返回 401 状态码
  if (pathname.startsWith('/api')) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // 否则重定向到登录页面
  const loginUrl = new URL('/login', request.url);
  // 保留完整的URL，包括查询参数
  const fullUrl = `${pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set('redirect', fullUrl);
  return NextResponse.redirect(loginUrl);
}

function normalizeHost(host: string | null): string {
  return host?.split(':')[0].trim().toLowerCase() || '';
}

function isAllowedHost(host: string): boolean {
  return (
    Boolean(host) &&
    !host.includes('vercel.app') &&
    (host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`))
  );
}

// 判断是否需要跳过认证的路径
function shouldSkipAuth(pathname: string): boolean {
  const skipExactPaths = new Set([
    '/login',
    '/warning',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/sw.js',
  ]);

  if (skipExactPaths.has(pathname)) {
    return true;
  }

  const skipPaths = [
    '/_next',
    '/_offline',
    '/workbox-',
    '/worker-',
    '/icons/',
    '/logo.png',
    '/screenshot.png',
    '/api/login',
    '/api/register',
    '/api/logout',
    '/api/cron',
    '/api/server-config',
  ];

  return skipPaths.some((path) => pathname.startsWith(path));
}

// 配置middleware匹配规则
export const config = {
  matcher: '/:path*',
};
