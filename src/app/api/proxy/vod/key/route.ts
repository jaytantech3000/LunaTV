import { NextRequest, NextResponse } from 'next/server';

import { requireAuthContextFromRequest } from '@/lib/auth';
import { proxyDesktopDevVodRequest } from '@/lib/desktop/dev-vod-proxy';
import {
  createVodProxyErrorResponse,
  createVodProxyHeaders,
  fetchVodProxyUpstream,
  resolveVodProxyRequest,
} from '@/lib/download/vod-proxy';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const desktopProxyResponse = await proxyDesktopDevVodRequest(
      request,
      '/api/proxy/vod/key'
    );
    if (desktopProxyResponse) {
      return desktopProxyResponse;
    }

    const authContext = requireAuthContextFromRequest(request);
    const { upstreamUrl, apiSite } = await resolveVodProxyRequest({
      authContext,
      source: request.nextUrl.searchParams.get('source'),
      upstreamUrl: request.nextUrl.searchParams.get('url'),
    });
    const upstreamResponse = await fetchVodProxyUpstream({
      apiSite,
      upstreamUrl,
      requestHeaders: request.headers,
    });

    if (!upstreamResponse.ok) {
      return NextResponse.json(
        { error: `Failed to fetch key: ${upstreamResponse.status}` },
        { status: 500 }
      );
    }

    const keyBuffer = await upstreamResponse.arrayBuffer();
    return new Response(keyBuffer, {
      status: upstreamResponse.status,
      headers: createVodProxyHeaders(
        upstreamResponse,
        upstreamResponse.headers.get('Content-Type') ||
          'application/octet-stream'
      ),
    });
  } catch (error) {
    return createVodProxyErrorResponse(error);
  }
}
