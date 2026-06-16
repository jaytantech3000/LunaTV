import { NextRequest, NextResponse } from 'next/server';

import { buildAuthCookieOptions } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });

  // 清除认证cookie
  response.cookies.set('auth', '', {
    ...buildAuthCookieOptions(request, new Date(0)),
  });

  return response;
}
