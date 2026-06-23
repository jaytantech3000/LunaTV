jest.mock('@/lib/desktop-diagnostics', () => {
  const actual = jest.requireActual('@/lib/desktop-diagnostics');

  return {
    ...actual,
    getDesktopDiagnosticsOperator: jest.fn(),
    listDesktopDiagnosticsReports: jest.fn(),
  };
});

import { NextRequest } from 'next/server';

import {
  getDesktopDiagnosticsOperator,
  listDesktopDiagnosticsReports,
} from '@/lib/desktop-diagnostics';

import { GET } from './route';

describe('/api/admin/diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthenticated callers', async () => {
    (getDesktopDiagnosticsOperator as jest.Mock).mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/admin/diagnostics');
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Unauthorized',
    });
  });

  it('returns a paginated diagnostics list for admins', async () => {
    (getDesktopDiagnosticsOperator as jest.Mock).mockResolvedValue({
      role: 'admin',
      username: 'ops',
    });
    (listDesktopDiagnosticsReports as jest.Mock).mockResolvedValue({
      items: [
        {
          app_version: 'desktop-v1',
          arch: 'arm64',
          channel: 'nova',
          created_at: '2026-06-22T00:00:00.000Z',
          desktop_commit: 'abc123',
          error_fingerprint: 'f1',
          findings: ['LaunchDaemon is missing'],
          id: 'report-1',
          local_service_version: 'local-service-nova-2026-06-22.1',
          operator_notes: null,
          os_name: 'macOS',
          os_version: '15.5',
          platform: 'macos',
          profile_sync_enabled: true,
          raw_log_excerpt: 'line 1',
          raw_log_sha256: 'sha',
          raw_log_size_bytes: 120,
          recommendations: ['Reinstall local service'],
          remote_site_origin: 'https://nova.example.com',
          resolved_at: null,
          status: 'new',
          summary: 'Local service failed to start',
          updated_at: '2026-06-22T00:00:00.000Z',
        },
      ],
      page: 2,
      pageSize: 10,
      total: 13,
    });

    const request = new NextRequest(
      'http://localhost/api/admin/diagnostics?page=2&pageSize=10&status=new&channel=nova'
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(listDesktopDiagnosticsReports).toHaveBeenCalledWith({
      channel: 'nova',
      from: undefined,
      page: 2,
      pageSize: 10,
      platform: undefined,
      status: 'new',
      to: undefined,
    });
    expect(await response.json()).toEqual({
      items: [
        {
          app_version: 'desktop-v1',
          arch: 'arm64',
          channel: 'nova',
          created_at: '2026-06-22T00:00:00.000Z',
          desktop_commit: 'abc123',
          error_fingerprint: 'f1',
          findings: ['LaunchDaemon is missing'],
          id: 'report-1',
          local_service_version: 'local-service-nova-2026-06-22.1',
          operator_notes: null,
          os_name: 'macOS',
          os_version: '15.5',
          platform: 'macos',
          profile_sync_enabled: true,
          raw_log_excerpt: 'line 1',
          raw_log_sha256: 'sha',
          raw_log_size_bytes: 120,
          recommendations: ['Reinstall local service'],
          remote_site_origin: 'https://nova.example.com',
          resolved_at: null,
          status: 'new',
          summary: 'Local service failed to start',
          updated_at: '2026-06-22T00:00:00.000Z',
        },
      ],
      ok: true,
      page: 2,
      pageSize: 10,
      total: 13,
    });
  });
});
