jest.mock('@/lib/client-download', () => ({
  isLocalServicePlatformKey: jest.fn(),
  resolveLocalServiceBinaryUrl: jest.fn(),
}));

import { NextRequest } from 'next/server';

import {
  isLocalServicePlatformKey,
  resolveLocalServiceBinaryUrl,
} from '@/lib/client-download';

import { GET, HEAD } from './route';

describe('/api/local-service-script', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isLocalServicePlatformKey as unknown as jest.Mock).mockImplementation(
      (value: string | null) => value === 'mac-arm64' || value === 'win-x64'
    );
    (resolveLocalServiceBinaryUrl as jest.Mock).mockReturnValue(
      'https://objects.githubusercontent.com/lunatv-server'
    );
  });

  it('returns a shell installer script for macOS platforms', async () => {
    const request = new NextRequest(
      'http://localhost/api/local-service-script?platform=mac-arm64'
    );

    const response = await GET(request);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="lunatv-local-service-mac-arm64.sh"'
    );
    expect(body).toContain(
      'curl -fsSL "https://objects.githubusercontent.com/lunatv-server"'
    );
  });

  it('returns a PowerShell installer script for Windows', async () => {
    const request = new NextRequest(
      'http://localhost/api/local-service-script?platform=win-x64'
    );

    const response = await GET(request);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="lunatv-local-service-win-x64.ps1"'
    );
    expect(body).toContain('Invoke-WebRequest -UseBasicParsing');
  });

  it('uses HEAD to report script availability without returning a body', async () => {
    const request = new NextRequest(
      'http://localhost/api/local-service-script?platform=win-x64'
    );

    const response = await HEAD(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('returns 503 when the local-service binary is not configured', async () => {
    (resolveLocalServiceBinaryUrl as jest.Mock).mockReturnValue(null);

    const request = new NextRequest(
      'http://localhost/api/local-service-script?platform=mac-arm64'
    );

    const response = await GET(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Local service binary is unavailable',
    });
  });
});
