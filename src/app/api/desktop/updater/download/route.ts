import { NextRequest, NextResponse } from 'next/server';

import {
  isAllowedGithubReleaseAssetUrl,
  isRepositorySlug,
  normalizeRepositorySlug,
} from '@/lib/desktop-updater-proxy';
import { getReleaseRepository } from '@/lib/release-urls';

export const runtime = 'nodejs';

const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function buildErrorResponse(message: string, status: number) {
  return new NextResponse(message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

function copyUpstreamHeaders(upstreamHeaders: Headers) {
  const headers = new Headers();

  [
    'accept-ranges',
    'content-disposition',
    'content-length',
    'content-range',
    'content-type',
    'etag',
    'last-modified',
  ].forEach((headerName) => {
    const value = upstreamHeaders.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  });

  headers.set('Cache-Control', ASSET_CACHE_CONTROL);
  headers.set('CDN-Cache-Control', ASSET_CACHE_CONTROL);
  headers.set('Vercel-CDN-Cache-Control', ASSET_CACHE_CONTROL);

  return headers;
}

async function proxyAssetRequest(request: NextRequest, method: 'GET' | 'HEAD') {
  const repository =
    normalizeRepositorySlug(request.nextUrl.searchParams.get('repo')) ||
    getReleaseRepository();
  const targetUrl = request.nextUrl.searchParams.get('target')?.trim() || '';

  if (!isRepositorySlug(repository) || !targetUrl) {
    return buildErrorResponse('Invalid desktop updater asset target.', 400);
  }

  if (!isAllowedGithubReleaseAssetUrl(targetUrl, repository)) {
    return buildErrorResponse('Rejected desktop updater asset target.', 403);
  }

  const upstreamHeaders = new Headers({
    'User-Agent': 'LunaTV-Desktop-Updater-Proxy',
  });
  const range = request.headers.get('range');
  if (range) {
    upstreamHeaders.set('Range', range);
  }

  try {
    const upstreamResponse = await fetch(targetUrl, {
      method,
      headers: upstreamHeaders,
      redirect: 'follow',
      cache: 'no-store',
    });

    if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
      return buildErrorResponse(
        `Failed to fetch desktop updater asset: HTTP ${upstreamResponse.status}`,
        upstreamResponse.status
      );
    }

    return new NextResponse(method === 'HEAD' ? null : upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: copyUpstreamHeaders(upstreamResponse.headers),
    });
  } catch (error) {
    return buildErrorResponse(
      error instanceof Error
        ? error.message
        : 'Failed to proxy desktop updater asset.',
      502
    );
  }
}

export async function GET(request: NextRequest) {
  return proxyAssetRequest(request, 'GET');
}

export async function HEAD(request: NextRequest) {
  return proxyAssetRequest(request, 'HEAD');
}
