import { NextResponse } from 'next/server';

import { fetchLocalServiceReleaseSummary } from '@/lib/client-download';

export const runtime = 'nodejs';

function jsonError(error: string, status: number): Response {
  return NextResponse.json({ error }, { status });
}

export async function GET(): Promise<Response> {
  try {
    const releaseSummary = await fetchLocalServiceReleaseSummary();
    if (!releaseSummary) {
      return jsonError('Local service release is not configured', 503);
    }

    const response = NextResponse.json(releaseSummary);
    response.headers.set('Cache-Control', 'public, max-age=300, s-maxage=300');
    response.headers.set('CDN-Cache-Control', 'public, s-maxage=300');
    response.headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=300');
    return response;
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : 'Failed to load local service release',
      502
    );
  }
}
