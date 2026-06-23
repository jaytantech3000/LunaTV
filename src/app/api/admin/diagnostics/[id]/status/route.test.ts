jest.mock('@/lib/desktop-diagnostics', () => {
  const actual = jest.requireActual('@/lib/desktop-diagnostics');

  return {
    ...actual,
    getDesktopDiagnosticsOperator: jest.fn(),
    updateDesktopDiagnosticsReportStatus: jest.fn(),
  };
});

import { NextRequest } from 'next/server';

import {
  getDesktopDiagnosticsOperator,
  updateDesktopDiagnosticsReportStatus,
} from '@/lib/desktop-diagnostics';

import { POST } from './route';

describe('/api/admin/diagnostics/[id]/status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates diagnostics status and notes for operators', async () => {
    (getDesktopDiagnosticsOperator as jest.Mock).mockResolvedValue({
      role: 'owner',
      username: 'owner',
    });
    (updateDesktopDiagnosticsReportStatus as jest.Mock).mockResolvedValue({
      id: 'report-1',
      operator_notes: 'Investigating.',
      status: 'triaged',
    });

    const request = new NextRequest(
      'http://localhost/api/admin/diagnostics/report-1/status',
      {
        body: JSON.stringify({
          operatorNotes: 'Investigating.',
          status: 'triaged',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }
    );

    const response = await POST(request, {
      params: {
        id: 'report-1',
      },
    });

    expect(response.status).toBe(200);
    expect(updateDesktopDiagnosticsReportStatus).toHaveBeenCalledWith(
      'report-1',
      {
        operatorNotes: 'Investigating.',
        status: 'triaged',
      }
    );
  });

  it('rejects unsupported status values', async () => {
    (getDesktopDiagnosticsOperator as jest.Mock).mockResolvedValue({
      role: 'owner',
      username: 'owner',
    });

    const request = new NextRequest(
      'http://localhost/api/admin/diagnostics/report-1/status',
      {
        body: JSON.stringify({
          status: 'closed',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }
    );

    const response = await POST(request, {
      params: {
        id: 'report-1',
      },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'invalid_payload',
      message: 'status must be a supported diagnostics status.',
      ok: false,
    });
  });
});
