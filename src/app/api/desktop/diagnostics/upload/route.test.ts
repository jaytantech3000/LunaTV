jest.mock('@/lib/desktop-diagnostics', () => {
  const actual = jest.requireActual('@/lib/desktop-diagnostics');

  return {
    ...actual,
    ingestDesktopDiagnosticsReport: jest.fn(),
  };
});

import { NextRequest } from 'next/server';

import {
  DesktopDiagnosticsError,
  ingestDesktopDiagnosticsReport,
} from '@/lib/desktop-diagnostics';

import { POST } from './route';

describe('/api/desktop/diagnostics/upload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores a diagnostics report and returns the report id', async () => {
    (ingestDesktopDiagnosticsReport as jest.Mock).mockResolvedValue({
      forwardedToGithub: false,
      reportId: 'report-1',
      status: 'new',
      stored: true,
    });

    const request = new NextRequest(
      'http://localhost/api/desktop/diagnostics/upload',
      {
        body: JSON.stringify({
          platform: 'macos',
          rawLogText: 'line 1',
          summary: 'Local service failed to start',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      forwardedToGithub: false,
      ok: true,
      reportId: 'report-1',
      status: 'new',
      stored: true,
    });
  });

  it('maps diagnostics errors into structured API failures', async () => {
    (ingestDesktopDiagnosticsReport as jest.Mock).mockRejectedValue(
      new DesktopDiagnosticsError(
        'disabled',
        'Desktop diagnostics upload is disabled.',
        503
      )
    );

    const request = new NextRequest(
      'http://localhost/api/desktop/diagnostics/upload',
      {
        body: JSON.stringify({
          platform: 'macos',
          rawLogText: 'line 1',
          summary: 'Local service failed to start',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'disabled',
      message: 'Desktop diagnostics upload is disabled.',
      ok: false,
    });
  });
});
