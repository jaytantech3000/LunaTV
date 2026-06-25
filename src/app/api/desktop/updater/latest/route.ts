import { NextRequest, NextResponse } from 'next/server';

import {
  buildGithubRawBranchFileUrl,
  buildGithubReleaseDownloadUrl,
  isRepositorySlug,
  normalizeGithubRef,
  normalizeRepositorySlug,
  parseDesktopUpdaterManifest,
  rewriteDesktopUpdaterManifestUrls,
} from '@/lib/desktop-updater-proxy';
import { getReleaseRepository, getUpdaterBranch } from '@/lib/release-urls';

export const runtime = 'nodejs';

const MANIFEST_FILE_NAME = 'latest.json';

function buildJsonResponse(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      'Cache-Control':
        'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      'CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      'Vercel-CDN-Cache-Control':
        'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}

function buildErrorResponse(message: string, status: number) {
  return NextResponse.json(
    {
      error: message,
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}

function resolveManifestSourceUrl(
  repository: string,
  branch: string,
  tagName: string | null
) {
  if (tagName) {
    return buildGithubReleaseDownloadUrl(
      repository,
      tagName,
      MANIFEST_FILE_NAME
    );
  }

  return buildGithubRawBranchFileUrl(repository, branch, MANIFEST_FILE_NAME);
}

export async function GET(request: NextRequest) {
  const repository =
    normalizeRepositorySlug(request.nextUrl.searchParams.get('repo')) ||
    getReleaseRepository();
  const branch =
    normalizeGithubRef(request.nextUrl.searchParams.get('branch')) ||
    getUpdaterBranch();
  const tagName = normalizeGithubRef(request.nextUrl.searchParams.get('tag'));

  if (!isRepositorySlug(repository) || (!branch && !tagName)) {
    return buildErrorResponse('Invalid desktop updater target.', 400);
  }

  try {
    const upstreamResponse = await fetch(
      resolveManifestSourceUrl(repository, branch, tagName),
      {
        cache: 'no-store',
        headers: {
          'User-Agent': 'LunaTV-Desktop-Updater-Proxy',
        },
      }
    );

    if (!upstreamResponse.ok) {
      return buildErrorResponse(
        `Failed to fetch upstream manifest: HTTP ${upstreamResponse.status}`,
        upstreamResponse.status
      );
    }

    const upstreamPayload = await upstreamResponse.text();
    const manifest = parseDesktopUpdaterManifest(upstreamPayload);

    return buildJsonResponse(
      rewriteDesktopUpdaterManifestUrls(manifest, {
        proxyBaseUrl: request.nextUrl.origin,
        repository,
      })
    );
  } catch (error) {
    return buildErrorResponse(
      error instanceof Error
        ? error.message
        : 'Failed to fetch desktop updater manifest.',
      502
    );
  }
}
