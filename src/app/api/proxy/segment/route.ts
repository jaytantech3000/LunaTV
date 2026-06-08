import { NextRequest, NextResponse } from 'next/server';

import {
  createLiveProxyErrorResponse,
  createLiveProxyHeaders,
  fetchLiveProxyUpstream,
  resolveLiveProxySource,
} from '@/lib/core/media/live-proxy';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const upstreamUrl = request.nextUrl.searchParams.get('url');
    const liveSource = await resolveLiveProxySource(
      request.nextUrl.searchParams.get('moontv-source')
    );
    const upstreamResponse = await fetchLiveProxyUpstream({
      liveSource,
      upstreamUrl,
      requestHeaders: request.headers,
      includeRange: true,
    });
    if (!upstreamResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch segment' },
        { status: 500 }
      );
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: createLiveProxyHeaders(
        upstreamResponse,
        upstreamResponse.headers.get('Content-Type') || 'video/mp2t'
      ),
    });
  } catch (error) {
    return createLiveProxyErrorResponse(error);
  }
}
