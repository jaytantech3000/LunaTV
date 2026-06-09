import { NextRequest, NextResponse } from 'next/server';

import { requireAuthContextFromRequest } from '@/lib/auth';
import { proxyDesktopDevVodRequest } from '@/lib/desktop/dev-vod-proxy';
import {
  createVodProxyErrorResponse,
  createVodProxyHeaders,
  fetchVodProxyUpstream,
  resolveVodProxyRequest,
  rewriteVodManifestContent,
} from '@/lib/download/vod-proxy';

export const runtime = 'nodejs';

async function handleRequest(
  request: NextRequest,
  method: 'GET' | 'HEAD'
): Promise<Response> {
  try {
    const desktopProxyResponse = await proxyDesktopDevVodRequest(
      request,
      '/api/proxy/vod/m3u8',
      {
        rewriteManifest: true,
      }
    );
    if (desktopProxyResponse) {
      return desktopProxyResponse;
    }

    const authContext = requireAuthContextFromRequest(request);
    const { source, upstreamUrl, apiSite } = await resolveVodProxyRequest({
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
        { error: `Failed to fetch manifest: ${upstreamResponse.status}` },
        { status: 500 }
      );
    }

    const manifestContent = await upstreamResponse.text();
    const rewrittenContent = rewriteVodManifestContent(
      manifestContent,
      upstreamResponse.url || upstreamUrl,
      source
    );
    const manifestHeaders = createVodProxyHeaders(
      upstreamResponse,
      upstreamResponse.headers.get('Content-Type') ||
        'application/vnd.apple.mpegurl',
      {
        contentLength: Buffer.byteLength(rewrittenContent).toString(),
      }
    );

    if (method === 'HEAD') {
      return new Response(null, {
        status: upstreamResponse.status,
        headers: manifestHeaders,
      });
    }

    return new Response(rewrittenContent, {
      status: upstreamResponse.status,
      headers: manifestHeaders,
    });
  } catch (error) {
    return createVodProxyErrorResponse(error);
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  return handleRequest(request, 'GET');
}

export async function HEAD(request: NextRequest): Promise<Response> {
  return handleRequest(request, 'HEAD');
}
