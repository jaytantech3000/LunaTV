import { NextRequest, NextResponse } from 'next/server';

import {
  buildDesktopDiagnosticsErrorResponse,
  getDesktopDiagnosticsOperator,
  getDesktopDiagnosticsReport,
} from '@/lib/desktop-diagnostics';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const operator = await getDesktopDiagnosticsOperator(request);
  if (!operator) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const report = await getDesktopDiagnosticsReport(params.id);

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
      'Failed to load diagnostics report.'
    );
  }
}
