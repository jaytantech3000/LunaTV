import { NextRequest, NextResponse } from 'next/server';

import {
  createLiveProxyErrorResponse,
  createLiveProxyHeaders,
  fetchLiveProxyUpstream,
  resolveLiveProxySource,
  rewriteLiveManifestContent,
  shouldRewriteLiveManifest,
} from '@/lib/core/media/live-proxy';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const upstreamUrl = request.nextUrl.searchParams.get('url');
    const allowCORS = request.nextUrl.searchParams.get('allowCORS') === 'true';
    const sourceKey = request.nextUrl.searchParams.get('moontv-source');
    const liveSource = await resolveLiveProxySource(sourceKey);
    const upstreamResponse = await fetchLiveProxyUpstream({
      liveSource,
      upstreamUrl,
    });

    if (!upstreamResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch m3u8' },
        { status: 500 }
      );
    }

    if (shouldRewriteLiveManifest(upstreamResponse, upstreamUrl)) {
      const manifestContent = await upstreamResponse.text();
      const modifiedContent = rewriteLiveManifestContent(
        manifestContent,
        upstreamResponse.url || decodeURIComponent(upstreamUrl || ''),
        {
          sourceKey: liveSource.key,
          allowCORS,
        }
      );

      return new Response(modifiedContent, {
        headers: createLiveProxyHeaders(
          upstreamResponse,
          upstreamResponse.headers.get('Content-Type') ||
            'application/vnd.apple.mpegurl',
          {
            contentLength: Buffer.byteLength(modifiedContent).toString(),
          }
        ),
      });
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: createLiveProxyHeaders(upstreamResponse),
    });
  } catch (error) {
    return createLiveProxyErrorResponse(error);
  }
}
