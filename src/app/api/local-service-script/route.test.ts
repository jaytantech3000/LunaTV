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
      (value: string | null) =>
        value === 'linux-x64' || value === 'mac-arm64' || value === 'win-x64'
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
    expect(body).toContain('--config-path "${CONFIG_PATH}"');
    expect(body).toContain('--data-dir "${DATA_DIR}"');
    expect(body).toContain('--sqlite-path "${SQLITE_PATH}"');
  });

  it('returns a macOS uninstall script even when the current binary mapping is unavailable', async () => {
    (resolveLocalServiceBinaryUrl as jest.Mock).mockReturnValue(null);

    const request = new NextRequest(
      'http://localhost/api/local-service-script?platform=mac-arm64&action=uninstall'
    );

    const response = await GET(request);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="lunatv-local-service-mac-arm64-uninstall.sh"'
    );
    expect(body).toContain('rm -rf "$APPLICATION_DIR"');
    expect(body).toContain('launchctl bootout system "$PLIST_PATH"');
    expect(body).toContain('pkgutil --forget "$package_id"');
    expect(body).toContain('rm -rf "$SYSTEM_SUPPORT_DIR"');
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
    expect(body).toContain('config.json');
    expect(body).toContain('run-local-service.vbs');
    expect(body).toContain('--config-path');
    expect(body).toContain(
      'Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"'
    );
  });

  it('returns a stop script for Windows', async () => {
    const request = new NextRequest(
      'http://localhost/api/local-service-script?platform=win-x64&action=stop'
    );

    const response = await GET(request);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="lunatv-local-service-win-x64-stop.ps1"'
    );
    expect(body).toContain('Get-Process -Name "lunatv-server"');
    expect(body).toContain('LunaTV local service stopped.');
  });

  it('returns a Windows uninstall script that clears the uninstall registry entry', async () => {
    const request = new NextRequest(
      'http://localhost/api/local-service-script?platform=win-x64&action=uninstall'
    );

    const response = await GET(request);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="lunatv-local-service-win-x64-uninstall.ps1"'
    );
    expect(body).toContain(
      'Remove-Item -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LunaTVLocalService"'
    );
    expect(body).toContain('Remove-Item -Recurse -Force $InstallRoot');
  });

  it('returns a Linux stop script that handles packaged systemd installs', async () => {
    const request = new NextRequest(
      'http://localhost/api/local-service-script?platform=linux-x64&action=stop'
    );

    const response = await GET(request);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="lunatv-local-service-linux-x64-stop.sh"'
    );
    expect(body).toContain('systemctl stop "$SYSTEM_SERVICE"');
    expect(body).toContain('/opt/lunatv-local-service/bin/lunatv-server');
  });

  it('returns a Linux uninstall script that removes the Debian package when present', async () => {
    const request = new NextRequest(
      'http://localhost/api/local-service-script?platform=linux-x64&action=uninstall'
    );

    const response = await GET(request);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="lunatv-local-service-linux-x64-uninstall.sh"'
    );
    expect(body).toContain('apt-get remove -y "$PACKAGE_NAME"');
    expect(body).toContain('dpkg -s "$PACKAGE_NAME"');
    expect(body).toContain('dpkg -r "$PACKAGE_NAME"');
    expect(body).toContain('/etc/lunatv-local-service');
    expect(body).toContain('/var/lib/lunatv-local-service');
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

  it('returns 400 for an unsupported script action', async () => {
    const request = new NextRequest(
      'http://localhost/api/local-service-script?platform=mac-arm64&action=restart'
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid local service script action',
    });
  });
});
