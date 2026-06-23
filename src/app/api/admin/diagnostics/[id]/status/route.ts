import { NextRequest, NextResponse } from 'next/server';

import {
  buildDesktopDiagnosticsErrorResponse,
  DESKTOP_DIAGNOSTICS_STATUSES,
  DesktopDiagnosticsError,
  getDesktopDiagnosticsOperator,
  updateDesktopDiagnosticsReportStatus,
} from '@/lib/desktop-diagnostics';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const operator = await getDesktopDiagnosticsOperator(request);
  if (!operator) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new DesktopDiagnosticsError(
        'invalid_payload',
        'Status update payload must be a JSON object.',
        400
      );
    }

    const payload = body as {
      operatorNotes?: unknown;
      status?: unknown;
    };

    if (
      payload.operatorNotes !== undefined &&
      typeof payload.operatorNotes !== 'string'
    ) {
      throw new DesktopDiagnosticsError(
        'invalid_payload',
        'operatorNotes must be a string.',
        400
      );
    }

    if (
      typeof payload.status !== 'string' ||
      !DESKTOP_DIAGNOSTICS_STATUSES.includes(payload.status as never)
    ) {
      throw new DesktopDiagnosticsError(
        'invalid_payload',
        'status must be a supported diagnostics status.',
        400
      );
    }

    const report = await updateDesktopDiagnosticsReportStatus(params.id, {
      operatorNotes: payload.operatorNotes,
      status: payload.status as (typeof DESKTOP_DIAGNOSTICS_STATUSES)[number],
    });

    return NextResponse.json(
      {
        ok: true,
        report,
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
      'Failed to update diagnostics report.'
    );
  }
}
