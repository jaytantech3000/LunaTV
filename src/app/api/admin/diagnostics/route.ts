import { NextRequest, NextResponse } from 'next/server';

import {
  buildDesktopDiagnosticsErrorResponse,
  DESKTOP_DIAGNOSTICS_STATUSES,
  DesktopDiagnosticsError,
  getDesktopDiagnosticsOperator,
  listDesktopDiagnosticsReports,
} from '@/lib/desktop-diagnostics';

export const runtime = 'nodejs';

function parsePositiveInteger(
  value: string | null,
  fallback: number,
  fieldName: string
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new DesktopDiagnosticsError(
      'invalid_payload',
      `${fieldName} must be a positive integer.`,
      400
    );
  }

  return parsed;
}

function parseDateString(
  value: string | null,
  fieldName: string
): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DesktopDiagnosticsError(
      'invalid_payload',
      `${fieldName} must be a valid date.`,
      400
    );
  }

  return parsed.toISOString();
}

export async function GET(request: NextRequest) {
  const operator = await getDesktopDiagnosticsOperator(request);
  if (!operator) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const statusParam = searchParams.get('status');

    if (
      statusParam &&
      !DESKTOP_DIAGNOSTICS_STATUSES.includes(statusParam as never)
    ) {
      throw new DesktopDiagnosticsError(
        'invalid_payload',
        'status must be a supported diagnostics status.',
        400
      );
    }

    const result = await listDesktopDiagnosticsReports({
      channel: searchParams.get('channel')?.trim() || undefined,
      from: parseDateString(searchParams.get('from'), 'from'),
      page: parsePositiveInteger(searchParams.get('page'), 1, 'page'),
      pageSize: parsePositiveInteger(
        searchParams.get('pageSize'),
        20,
        'pageSize'
      ),
      platform: searchParams.get('platform')?.trim() || undefined,
      status:
        (statusParam as (typeof DESKTOP_DIAGNOSTICS_STATUSES)[number]) ||
        undefined,
      to: parseDateString(searchParams.get('to'), 'to'),
    });

    return NextResponse.json(
      {
        ok: true,
        ...result,
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
      'Failed to list diagnostics reports.'
    );
  }
}
