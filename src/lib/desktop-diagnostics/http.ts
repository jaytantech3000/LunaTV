/* eslint-disable no-console */

import { NextResponse } from 'next/server';

import { DesktopDiagnosticsError } from './errors';

export function buildDesktopDiagnosticsErrorResponse(
  error: unknown,
  fallbackMessage: string
) {
  if (error instanceof DesktopDiagnosticsError) {
    return NextResponse.json(
      {
        code: error.code,
        message: error.message,
        ok: false,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
        status: error.status,
      }
    );
  }

  console.error(fallbackMessage, error);

  return NextResponse.json(
    {
      code: 'storage_failed',
      message: fallbackMessage,
      ok: false,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
      status: 500,
    }
  );
}
