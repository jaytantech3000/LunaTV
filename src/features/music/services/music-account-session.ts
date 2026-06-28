import type { NextRequest, NextResponse } from 'next/server';

import { NeteaseApiError } from './providers/netease/client';

const MUSIC_ACCOUNT_SESSION_COOKIE_NAME = 'lunatv_music_netease_session';
const MUSIC_ACCOUNT_SESSION_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 30;
const ALLOWED_NETEASE_SESSION_COOKIE_KEYS = new Set([
  'MUSIC_U',
  'MUSIC_A',
  '__csrf',
  'NMTID',
  'MUSIC_R_T',
  'MUSIC_RT',
]);

interface StoredMusicAccountSessionCookiePayload {
  cookieHeader: string;
  source: 'netease';
}

function normalizeOptionalText(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function encodeSessionCookieValue(
  payload: StoredMusicAccountSessionCookiePayload
): string {
  return encodeURIComponent(JSON.stringify(payload));
}

function parseSessionCookieValue(
  value: string | undefined
): StoredMusicAccountSessionCookiePayload | null {
  if (!value) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(value);
    const payload = JSON.parse(
      decoded
    ) as StoredMusicAccountSessionCookiePayload;

    if (
      payload.source !== 'netease' ||
      !normalizeOptionalText(payload.cookieHeader)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function normalizeNeteaseSessionCookie(rawCookie: string): string {
  const normalizedCookie = normalizeOptionalText(
    rawCookie.replace(/^cookie\s*:\s*/i, '')
  );

  if (!normalizedCookie) {
    throw new NeteaseApiError('网易云 cookie 不能为空', 400);
  }

  const cookieMap = new Map<string, string>();
  const looksLikeRawToken = !normalizedCookie.includes('=');

  if (looksLikeRawToken) {
    cookieMap.set('MUSIC_U', normalizedCookie);
  } else {
    normalizedCookie
      .split(/[;\n\r]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const separatorIndex = entry.indexOf('=');

        if (separatorIndex <= 0) {
          return;
        }

        const key = entry.slice(0, separatorIndex).trim();
        const value = entry.slice(separatorIndex + 1).trim();

        if (!ALLOWED_NETEASE_SESSION_COOKIE_KEYS.has(key) || !value) {
          return;
        }

        cookieMap.set(key, value);
      });
  }

  const musicU = cookieMap.get('MUSIC_U') || cookieMap.get('MUSIC_A');

  if (!musicU) {
    throw new NeteaseApiError(
      '未找到可用的网易云登录字段，请粘贴 MUSIC_U 或完整 cookie',
      400
    );
  }

  return Array.from(cookieMap.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

export function readMusicAccountSessionCookie(
  request: NextRequest
): string | null {
  const cookieValue = request.cookies.get(
    MUSIC_ACCOUNT_SESSION_COOKIE_NAME
  )?.value;
  const payload = parseSessionCookieValue(cookieValue);

  return payload?.cookieHeader || null;
}

export function writeMusicAccountSessionCookie(
  response: NextResponse,
  cookieHeader: string
): NextResponse {
  response.cookies.set(
    MUSIC_ACCOUNT_SESSION_COOKIE_NAME,
    encodeSessionCookieValue({
      source: 'netease',
      cookieHeader,
    }),
    {
      httpOnly: true,
      maxAge: MUSIC_ACCOUNT_SESSION_COOKIE_TTL_SECONDS,
      path: '/',
      sameSite: 'lax',
    }
  );

  return response;
}

export function clearMusicAccountSessionCookie(
  response: NextResponse
): NextResponse {
  response.cookies.set(MUSIC_ACCOUNT_SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'lax',
  });

  return response;
}
