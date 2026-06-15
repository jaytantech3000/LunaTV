import { NextRequest, NextResponse } from 'next/server';

import {
  createVodProxyErrorResponse,
  createVodProxyHeaders,
  fetchVodProxyUpstream,
  resolveVodProxyRequest,
} from '@/lib/download/vod-proxy';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { upstreamUrl, apiSite } = await resolveVodProxyRequest(request);
    const upstreamResponse = await fetchVodProxyUpstream(
      request,
      apiSite,
      upstreamUrl
    );

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
          'application/octet-stream',
        {
          contentLength: Buffer.byteLength(keyBuffer).toString(),
        }
      ),
    });
  } catch (error) {
    return createVodProxyErrorResponse(error);
  }
}
