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
    });
    if (!upstreamResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch key' },
        { status: 500 }
      );
    }

    const keyData = await upstreamResponse.arrayBuffer();
    return new Response(keyData, {
      status: upstreamResponse.status,
      headers: createLiveProxyHeaders(
        upstreamResponse,
        upstreamResponse.headers.get('Content-Type') ||
          'application/octet-stream',
        {
          cacheControl: 'public, max-age=3600',
        }
      ),
    });
  } catch (error) {
    return createLiveProxyErrorResponse(error);
  }
}
