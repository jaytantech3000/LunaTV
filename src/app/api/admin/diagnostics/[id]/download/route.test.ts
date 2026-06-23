jest.mock('@/lib/desktop-diagnostics', () => {
  const actual = jest.requireActual('@/lib/desktop-diagnostics');

  return {
    ...actual,
    downloadDesktopDiagnosticsRawLog: jest.fn(),
    getDesktopDiagnosticsOperator: jest.fn(),
  };
});

import { NextRequest } from 'next/server';

import {
  downloadDesktopDiagnosticsRawLog,
  getDesktopDiagnosticsOperator,
} from '@/lib/desktop-diagnostics';

import { GET } from './route';

describe('/api/admin/diagnostics/[id]/download', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('streams the redacted diagnostics log for admins', async () => {
    (getDesktopDiagnosticsOperator as jest.Mock).mockResolvedValue({
      role: 'admin',
      username: 'ops',
    });
    (downloadDesktopDiagnosticsRawLog as jest.Mock).mockResolvedValue({
      fileName: 'desktop-diagnostics-report-1.txt',
      report: {
        id: 'report-1',
      },
      text: 'line 1\nline 2',
    });

    const response = await GET(
      new NextRequest(
        'http://localhost/api/admin/diagnostics/report-1/download'
      ),
      {
        params: {
          id: 'report-1',
        },
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="desktop-diagnostics-report-1.txt"'
    );
    expect(await response.text()).toBe('line 1\nline 2');
  });
});
