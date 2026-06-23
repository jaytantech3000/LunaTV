import { NextRequest, NextResponse } from 'next/server';

import {
  buildDesktopDiagnosticsErrorResponse,
  downloadDesktopDiagnosticsRawLog,
  getDesktopDiagnosticsOperator,
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
    const download = await downloadDesktopDiagnosticsRawLog(params.id);

    return new NextResponse(download.text, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${download.fileName}"`,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      status: 200,
    });
  } catch (error) {
    return buildDesktopDiagnosticsErrorResponse(
      error,
      'Failed to download diagnostics log.'
    );
  }
}
