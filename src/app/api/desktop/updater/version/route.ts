import { NextRequest, NextResponse } from 'next/server';

import {
  buildGithubRawBranchFileUrl,
  isRepositorySlug,
  normalizeGithubRef,
  normalizeRepositorySlug,
} from '@/lib/desktop-updater-proxy';
import { getReleaseRepository, getUpdaterBranch } from '@/lib/release-urls';

export const runtime = 'nodejs';

const VERSION_FILE_NAME = 'VERSION.txt';

function buildErrorResponse(message: string, status: number) {
  return new NextResponse(message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

export async function GET(request: NextRequest) {
  const repository =
    normalizeRepositorySlug(request.nextUrl.searchParams.get('repo')) ||
    getReleaseRepository();
  const branch =
    normalizeGithubRef(request.nextUrl.searchParams.get('branch')) ||
    getUpdaterBranch();

  if (!isRepositorySlug(repository) || !branch) {
    return buildErrorResponse('Invalid desktop updater target.', 400);
  }

  try {
    const upstreamResponse = await fetch(
      buildGithubRawBranchFileUrl(repository, branch, VERSION_FILE_NAME),
      {
        cache: 'no-store',
        headers: {
          'User-Agent': 'LunaTV-Desktop-Updater-Proxy',
        },
      }
    );

    if (!upstreamResponse.ok) {
      return buildErrorResponse(
        `Failed to fetch upstream version file: HTTP ${upstreamResponse.status}`,
        upstreamResponse.status
      );
    }

    const versionText = await upstreamResponse.text();

    return new NextResponse(versionText, {
      status: 200,
      headers: {
        'Cache-Control':
          'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
        'CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'Vercel-CDN-Cache-Control':
          'public, s-maxage=300, stale-while-revalidate=600',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  } catch (error) {
    return buildErrorResponse(
      error instanceof Error
        ? error.message
        : 'Failed to fetch desktop updater version file.',
      502
    );
  }
}
