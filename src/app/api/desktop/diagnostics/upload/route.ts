import { NextRequest, NextResponse } from 'next/server';

import {
  buildDesktopDiagnosticsErrorResponse,
  DesktopDiagnosticsError,
  ingestDesktopDiagnosticsReport,
} from '@/lib/desktop-diagnostics';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      throw new DesktopDiagnosticsError(
        'invalid_payload',
        'Request body must be valid JSON.',
        400
      );
    }

    const result = await ingestDesktopDiagnosticsReport(body);

    return NextResponse.json(
      {
        forwardedToGithub: result.forwardedToGithub,
        ok: true,
        reportId: result.reportId,
        status: result.status,
        stored: result.stored,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    return buildDesktopDiagnosticsErrorResponse(
      error,
      'Failed to store desktop diagnostics.'
    );
  }
}
