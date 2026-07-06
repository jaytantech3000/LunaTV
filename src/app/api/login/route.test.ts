jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    checkUserExist: jest.fn(),
    verifyUser: jest.fn(),
  },
}));

import { NextRequest } from 'next/server';
import { webcrypto } from 'node:crypto';

import { POST } from './route';

describe('/api/login localstorage fallback', () => {
  const originalStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;
  const originalUsername = process.env.USERNAME;
  const originalPassword = process.env.PASSWORD;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localstorage';
    delete process.env.USERNAME;
    delete process.env.PASSWORD;
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = originalStorageType;
    process.env.USERNAME = originalUsername;
    process.env.PASSWORD = originalPassword;
  });

  it('falls back to admin when localstorage mode has no explicit username', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/login', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      username: 'admin',
      role: 'owner',
    });
  });

  it('uses admin as the implicit owner username in password mode', async () => {
    process.env.PASSWORD = 'secret';

    const response = await POST(
      new NextRequest('http://localhost/api/login', {
        method: 'POST',
        body: JSON.stringify({ password: 'secret' }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      username: 'admin',
      role: 'owner',
    });
  });
});
