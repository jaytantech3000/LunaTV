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
      request.nextUrl.searchParams.get('moontv-source'),
      {
        required: false,
      }
    );
    const imageResponse = await fetchLiveProxyUpstream({
      liveSource,
      upstreamUrl,
    });

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: imageResponse.statusText },
        { status: imageResponse.status }
      );
    }

    const contentType = imageResponse.headers.get('content-type');

    if (!imageResponse.body) {
      return NextResponse.json(
        { error: 'Image response has no body' },
        { status: 500 }
      );
    }

    return new Response(imageResponse.body, {
      status: imageResponse.status,
      headers: createLiveProxyHeaders(imageResponse, contentType || undefined, {
        cacheControl: 'public, max-age=86400, s-maxage=86400',
      }),
    });
  } catch (error) {
    return createLiveProxyErrorResponse(error);
  }
}
