jest.mock('@/lib/desktop-diagnostics', () => {
  const actual = jest.requireActual('@/lib/desktop-diagnostics');

  return {
    ...actual,
    getDesktopDiagnosticsOperator: jest.fn(),
    getDesktopDiagnosticsReport: jest.fn(),
  };
});

import { NextRequest } from 'next/server';

import {
  getDesktopDiagnosticsOperator,
  getDesktopDiagnosticsReport,
} from '@/lib/desktop-diagnostics';

import { GET } from './route';

describe('/api/admin/diagnostics/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns one diagnostics report', async () => {
    (getDesktopDiagnosticsOperator as jest.Mock).mockResolvedValue({
      role: 'owner',
      username: 'owner',
    });
    (getDesktopDiagnosticsReport as jest.Mock).mockResolvedValue({
      app_version: 'desktop-v1',
      arch: 'arm64',
      channel: 'nova',
      created_at: '2026-06-22T00:00:00.000Z',
      desktop_commit: 'abc123',
      error_fingerprint: 'f1',
      findings: ['LaunchDaemon is missing'],
      forwarded_to_github_at: null,
      github_issue_number: null,
      github_issue_url: null,
      id: 'report-1',
      local_service_version: 'local-service-nova-2026-06-22.1',
      operator_notes: null,
      os_name: 'macOS',
      os_version: '15.5',
      platform: 'macos',
      profile_sync_enabled: true,
      raw_log_excerpt: 'line 1',
      raw_log_object_path: 'nova/2026/06/22/report-1.txt',
      raw_log_sha256: 'sha',
      raw_log_size_bytes: 120,
      recommendations: ['Reinstall local service'],
      remote_site_origin: 'https://nova.example.com',
      report_payload: {
        serviceStatus: 'stopped',
      },
      resolved_at: null,
      status: 'new',
      summary: 'Local service failed to start',
      updated_at: '2026-06-22T00:00:00.000Z',
    });

    const response = await GET(
      new NextRequest('http://localhost/api/admin/diagnostics/report-1'),
      {
        params: {
          id: 'report-1',
        },
      }
    );

    expect(response.status).toBe(200);
    expect(getDesktopDiagnosticsReport).toHaveBeenCalledWith('report-1');
    expect((await response.json()).ok).toBe(true);
  });
});
