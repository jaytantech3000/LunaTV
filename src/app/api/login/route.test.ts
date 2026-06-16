jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    verifyUser: jest.fn(),
  },
}));

import { webcrypto } from 'crypto';
import { NextRequest } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

import { POST } from './route';

const mutableEnv = process.env as Record<string, string | undefined>;

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete mutableEnv[key];
    return;
  }

  mutableEnv[key] = value;
}

function createJsonRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/login', {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

describe('/api/login', () => {
  const originalEnv = {
    NEXT_PUBLIC_STORAGE_TYPE: mutableEnv.NEXT_PUBLIC_STORAGE_TYPE,
    PASSWORD: mutableEnv.PASSWORD,
    USERNAME: mutableEnv.USERNAME,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
    mutableEnv.USERNAME = 'owner';
    mutableEnv.PASSWORD = 'secret';
    mutableEnv.NEXT_PUBLIC_STORAGE_TYPE = 'localstorage';
    (getConfig as jest.Mock).mockResolvedValue({
      UserConfig: {
        Users: [],
      },
    });
    (db.verifyUser as jest.Mock).mockResolvedValue(false);
  });

  afterAll(() => {
    restoreEnvValue(
      'NEXT_PUBLIC_STORAGE_TYPE',
      originalEnv.NEXT_PUBLIC_STORAGE_TYPE
    );
    restoreEnvValue('PASSWORD', originalEnv.PASSWORD);
    restoreEnvValue('USERNAME', originalEnv.USERNAME);
  });

  it('returns owner identity and auth cookie in localstorage mode', async () => {
    const response = await POST(
      createJsonRequest({
        password: 'secret',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      role: 'owner',
      username: 'owner',
    });
    expect(response.headers.get('set-cookie')).toContain('auth=');
  });

  it('trims username before authenticating the owner account', async () => {
    mutableEnv.NEXT_PUBLIC_STORAGE_TYPE = 'redis';

    const response = await POST(
      createJsonRequest({
        password: 'secret',
        username: ' owner ',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      role: 'owner',
      username: 'owner',
    });
  });

  it('rejects blank usernames after trimming in multi-user mode', async () => {
    mutableEnv.NEXT_PUBLIC_STORAGE_TYPE = 'redis';

    const response = await POST(
      createJsonRequest({
        password: 'secret',
        username: '   ',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: '用户名不能为空',
    });
    expect(db.verifyUser).not.toHaveBeenCalled();
  });

  it('stops banned users before hitting password verification', async () => {
    mutableEnv.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    (getConfig as jest.Mock).mockResolvedValue({
      UserConfig: {
        Users: [
          {
            banned: true,
            role: 'user',
            username: 'demo-user',
          },
        ],
      },
    });

    const response = await POST(
      createJsonRequest({
        password: 'secret',
        username: 'demo-user',
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: '用户被封禁',
    });
    expect(db.verifyUser).not.toHaveBeenCalled();
  });

  it('authenticates regular users with their configured role', async () => {
    mutableEnv.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    (getConfig as jest.Mock).mockResolvedValue({
      UserConfig: {
        Users: [
          {
            banned: false,
            role: 'admin',
            username: 'demo-user',
          },
        ],
      },
    });
    (db.verifyUser as jest.Mock).mockResolvedValue(true);

    const response = await POST(
      createJsonRequest({
        password: 'secret',
        username: 'demo-user',
      })
    );

    expect(db.verifyUser).toHaveBeenCalledWith('demo-user', 'secret');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      role: 'admin',
      username: 'demo-user',
    });
    expect(response.headers.get('set-cookie')).toContain('auth=');
  });
});
