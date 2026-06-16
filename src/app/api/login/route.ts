/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | 'kvrocks'
    | undefined) || 'localstorage';

async function generateSignature(
  data: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function generateAuthCookie(
  username?: string,
  password?: string,
  role?: 'owner' | 'admin' | 'user',
  includePassword = false
): Promise<string> {
  const authData: any = { role: role || 'user' };

  if (includePassword && password) {
    authData.password = password;
  }

  if (username && process.env.PASSWORD) {
    authData.username = username;
    authData.signature = await generateSignature(
      username,
      process.env.PASSWORD
    );
    authData.timestamp = Date.now();
  }

  return encodeURIComponent(JSON.stringify(authData));
}

async function buildAuthenticatedResponse(
  username: string,
  password: string,
  role: 'owner' | 'admin' | 'user',
  includePassword = false
): Promise<NextResponse> {
  const response = NextResponse.json({
    ok: true,
    username,
    role,
  });
  const cookieValue = await generateAuthCookie(
    username,
    password,
    role,
    includePassword
  );
  const expires = new Date();
  expires.setDate(expires.getDate() + 7);

  response.cookies.set('auth', cookieValue, {
    path: '/',
    expires,
    sameSite: 'lax',
    httpOnly: false,
    secure: false,
  });

  return response;
}

export async function POST(req: NextRequest) {
  try {
    if (STORAGE_TYPE === 'localstorage') {
      const envPassword = process.env.PASSWORD;

      if (!envPassword) {
        const response = NextResponse.json({
          ok: true,
          username: process.env.USERNAME || 'owner',
          role: 'owner',
        });

        response.cookies.set('auth', '', {
          path: '/',
          expires: new Date(0),
          sameSite: 'lax',
          httpOnly: false,
          secure: false,
        });

        return response;
      }

      const { password } = await req.json();
      if (typeof password !== 'string') {
        return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
      }

      if (password !== envPassword) {
        return NextResponse.json(
          { ok: false, error: '密码错误' },
          { status: 401 }
        );
      }

      return buildAuthenticatedResponse(
        process.env.USERNAME || 'owner',
        password,
        'owner',
        true
      );
    }

    const { username, password } = await req.json();

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    if (username === process.env.USERNAME) {
      try {
        const ownerPasswordOverridden = await db.checkUserExist(username);
        const ownerPasswordValid = ownerPasswordOverridden
          ? await db.verifyUser(username, password)
          : password === process.env.PASSWORD;

        if (!ownerPasswordValid) {
          return NextResponse.json(
            { error: '用户名或密码错误' },
            { status: 401 }
          );
        }

        return buildAuthenticatedResponse(username, password, 'owner');
      } catch (err) {
        console.error('owner 密码验证失败:', err);
        return NextResponse.json({ error: '数据库错误' }, { status: 500 });
      }
    }

    const config = await getConfig();
    const user = config.UserConfig.Users.find((u) => u.username === username);
    if (user && user.banned) {
      return NextResponse.json({ error: '用户被封禁' }, { status: 401 });
    }

    try {
      const pass = await db.verifyUser(username, password);
      if (!pass) {
        return NextResponse.json(
          { error: '用户名或密码错误' },
          { status: 401 }
        );
      }

      return buildAuthenticatedResponse(
        username,
        password,
        user?.role || 'user'
      );
    } catch (err) {
      console.error('数据库验证失败:', err);
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    console.error('登录接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
