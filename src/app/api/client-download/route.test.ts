jest.mock('@/lib/client-download', () => ({
  fetchDesktopReleaseById: jest.fn(),
  getDesktopAssetKeyForName: jest.fn(),
  getDesktopReleaseConfig: jest.fn(),
  isClientDownloadSigningEnabled: jest.fn(),
  isLocalServiceInstallerPlatformKey: jest.fn(),
  isLocalServicePlatformKey: jest.fn(),
  matchesDesktopReleaseConfig: jest.fn(),
  resolveLocalServiceBinaryUrl: jest.fn(),
  resolveLocalServiceInstallerUrl: jest.fn(),
  verifySignedDesktopDownload: jest.fn(),
}));

jest.mock('@/lib/proxy-security', () => ({
  fetchWithValidatedRedirects: jest.fn(),
  validateProxyTargetUrl: jest.fn(),
}));

import { NextRequest } from 'next/server';

import {
  fetchDesktopReleaseById,
  getDesktopAssetKeyForName,
  getDesktopReleaseConfig,
  isClientDownloadSigningEnabled,
  isLocalServiceInstallerPlatformKey,
  isLocalServicePlatformKey,
  matchesDesktopReleaseConfig,
  resolveLocalServiceBinaryUrl,
  resolveLocalServiceInstallerUrl,
  verifySignedDesktopDownload,
} from '@/lib/client-download';
import {
  fetchWithValidatedRedirects,
  validateProxyTargetUrl,
} from '@/lib/proxy-security';

import { GET, HEAD } from './route';

describe('/api/client-download', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getDesktopReleaseConfig as jest.Mock).mockReturnValue({
      repo: 'demo/LunaTV',
      targetCommitish: 'desktop',
    });
    (isClientDownloadSigningEnabled as jest.Mock).mockReturnValue(true);
    (verifySignedDesktopDownload as jest.Mock).mockReturnValue(true);
    (matchesDesktopReleaseConfig as jest.Mock).mockReturnValue(true);
    (getDesktopAssetKeyForName as jest.Mock).mockReturnValue('mac-arm64');
    (fetchDesktopReleaseById as jest.Mock).mockResolvedValue({
      assets: [
        {
          browser_download_url:
            'https://objects.githubusercontent.com/demo.dmg',
          id: 401,
          name: 'LunaTV-aarch64.dmg',
          size: 123,
        },
      ],
      id: 39,
      prerelease: true,
      tag_name: 'desktop-v0.1.0',
      target_commitish: 'desktop',
    });
    (validateProxyTargetUrl as jest.Mock).mockResolvedValue(
      'https://objects.githubusercontent.com/demo.dmg'
    );
    (fetchWithValidatedRedirects as jest.Mock).mockResolvedValue(
      new Response('demo-binary', {
        headers: {
          'accept-ranges': 'bytes',
          'content-length': '11',
          'content-type': 'application/octet-stream',
        },
        status: 200,
      })
    );
    (isLocalServicePlatformKey as unknown as jest.Mock).mockImplementation(
      (value: string | null) => value === 'win-x64'
    );
    (resolveLocalServiceBinaryUrl as jest.Mock).mockReturnValue(
      'https://objects.githubusercontent.com/lunatv-server.exe'
    );
    (
      isLocalServiceInstallerPlatformKey as unknown as jest.Mock
    ).mockImplementation(
      (value: string | null) =>
        value === 'mac-arm64' || value === 'linux-x64' || value === 'win-x64'
    );
    (resolveLocalServiceInstallerUrl as jest.Mock).mockReturnValue(
      'https://objects.githubusercontent.com/lunatv-local-service-mac-arm64.pkg'
    );
  });

  it('streams signed desktop downloads through the download gateway', async () => {
    const request = new NextRequest(
      'http://localhost/api/client-download?kind=desktop&releaseId=39&assetId=401&expires=9999999999999&sig=demo'
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="demo.dmg"'
    );
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(await response.text()).toBe('demo-binary');
  });

  it('rejects desktop download requests with invalid signatures', async () => {
    (verifySignedDesktopDownload as jest.Mock).mockReturnValue(false);

    const request = new NextRequest(
      'http://localhost/api/client-download?kind=desktop&releaseId=39&assetId=401&expires=9999999999999&sig=bad'
    );

    const response = await GET(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      details: undefined,
      error: 'Invalid download signature',
    });
  });

  it('allows fixed local-service downloads without a signed desktop token', async () => {
    (validateProxyTargetUrl as jest.Mock).mockResolvedValue(
      'https://objects.githubusercontent.com/lunatv-server.exe'
    );

    const request = new NextRequest(
      'http://localhost/api/client-download?kind=local-service&platform=win-x64'
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(resolveLocalServiceBinaryUrl).toHaveBeenCalledWith('win-x64');
    expect(await response.text()).toBe('demo-binary');
  });

  it('allows desktop downloads without a signature when signing is disabled', async () => {
    (isClientDownloadSigningEnabled as jest.Mock).mockReturnValue(false);

    const request = new NextRequest(
      'http://localhost/api/client-download?kind=desktop&releaseId=39&assetId=401'
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(verifySignedDesktopDownload).not.toHaveBeenCalled();
    expect(await response.text()).toBe('demo-binary');
  });

  it('allows mac local-service installer downloads through the same gateway', async () => {
    (validateProxyTargetUrl as jest.Mock).mockResolvedValue(
      'https://objects.githubusercontent.com/lunatv-local-service-mac-arm64.pkg'
    );

    const request = new NextRequest(
      'http://localhost/api/client-download?kind=local-service-installer&platform=mac-arm64'
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(resolveLocalServiceInstallerUrl).toHaveBeenCalledWith('mac-arm64');
    expect(await response.text()).toBe('demo-binary');
  });

  it('uses an .exe fallback filename for the Windows local-service installer', async () => {
    (resolveLocalServiceInstallerUrl as jest.Mock).mockReturnValue(
      'https://objects.githubusercontent.com/'
    );
    (validateProxyTargetUrl as jest.Mock).mockResolvedValue(
      'https://objects.githubusercontent.com/'
    );

    const request = new NextRequest(
      'http://localhost/api/client-download?kind=local-service-installer&platform=win-x64'
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(resolveLocalServiceInstallerUrl).toHaveBeenCalledWith('win-x64');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="lunatv-local-service-win-x64.exe"'
    );
  });

  it('uses a .deb fallback filename for the Linux local-service installer', async () => {
    (resolveLocalServiceInstallerUrl as jest.Mock).mockReturnValue(
      'https://objects.githubusercontent.com/'
    );
    (validateProxyTargetUrl as jest.Mock).mockResolvedValue(
      'https://objects.githubusercontent.com/'
    );

    const request = new NextRequest(
      'http://localhost/api/client-download?kind=local-service-installer&platform=linux-x64'
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(resolveLocalServiceInstallerUrl).toHaveBeenCalledWith('linux-x64');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="lunatv-local-service-linux-x64.deb"'
    );
  });

  it('returns 503 when a local-service platform is not configured', async () => {
    (resolveLocalServiceBinaryUrl as jest.Mock).mockReturnValue(null);

    const request = new NextRequest(
      'http://localhost/api/client-download?kind=local-service&platform=win-x64'
    );

    const response = await GET(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      details: undefined,
      error: 'Local service binary is unavailable',
    });
  });

  it('returns 503 when a local-service installer is not configured', async () => {
    (resolveLocalServiceInstallerUrl as jest.Mock).mockReturnValue(null);

    const request = new NextRequest(
      'http://localhost/api/client-download?kind=local-service-installer&platform=mac-arm64'
    );

    const response = await GET(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      details: undefined,
      error: 'Local service installer is unavailable',
    });
  });

  it('supports HEAD requests without returning a body', async () => {
    const request = new NextRequest(
      'http://localhost/api/client-download?kind=desktop&releaseId=39&assetId=401&expires=9999999999999&sig=demo'
    );

    const response = await HEAD(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });
});
