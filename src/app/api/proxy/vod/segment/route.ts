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
        { error: `Failed to fetch segment: ${upstreamResponse.status}` },
        { status: 500 }
      );
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: createVodProxyHeaders(upstreamResponse),
    });
  } catch (error) {
    return createVodProxyErrorResponse(error);
  }
}
