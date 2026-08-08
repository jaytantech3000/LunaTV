jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

import { middleware } from './middleware';

describe('middleware', () => {
  const originalTrustedRootDomain = process.env.TRUSTED_ROOT_DOMAIN;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.TRUSTED_ROOT_DOMAIN;
    process.env.PASSWORD = 'demo-password';
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'upstash';
  });

  afterEach(() => {
    if (originalTrustedRootDomain === undefined) {
      delete process.env.TRUSTED_ROOT_DOMAIN;
      return;
    }

    process.env.TRUSTED_ROOT_DOMAIN = originalTrustedRootDomain;
  });

  it('allows desktop diagnostics uploads without authentication', async () => {
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue(null);

    const response = await middleware(
      new NextRequest(
        'https://vcma.hkcu.qzz.io/api/desktop/diagnostics/upload',
        {
          headers: {
            host: 'vcma.hkcu.qzz.io',
          },
        }
      )
    );

    expect(response.status).toBe(200);
  });

  it('still rejects other unauthenticated api routes', async () => {
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue(null);

    const response = await middleware(
      new NextRequest('https://vcma.hkcu.qzz.io/api/admin/diagnostics', {
        headers: {
          host: 'vcma.hkcu.qzz.io',
        },
      })
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Unauthorized');
  });

  it('allows the configured Cloudflare custom domain', async () => {
    process.env.TRUSTED_ROOT_DOMAIN = 'hkcu.cc.cd';
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue(null);

    const response = await middleware(
      new NextRequest(
        'https://luna.hkcu.cc.cd/api/desktop/diagnostics/upload',
        {
          headers: {
            host: 'luna.hkcu.cc.cd',
          },
        }
      )
    );

    expect(response.status).toBe(200);
  });

  it('blocks direct vercel.app hosts outside development', async () => {
    const response = await middleware(
      new NextRequest(
        'https://lunatv-example.vercel.app/api/desktop/diagnostics/upload',
        {
          headers: {
            host: 'lunatv-example.vercel.app',
          },
        }
      )
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain('Access Denied');
  });
});
