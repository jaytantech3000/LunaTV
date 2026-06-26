import { NextResponse } from 'next/server';

import {
  type GithubReleasePayload,
  buildLocalDesktopReleaseHistoryFallback,
  normalizeDesktopReleaseHistory,
} from '@/lib/desktop-release-history';
import {
  isRepositorySlug,
  normalizeRepositorySlug,
} from '@/lib/desktop-updater-proxy';
import {
  getDesktopUpdaterManifestProxyUrl,
  getReleaseRepository,
} from '@/lib/release-urls';

export const runtime = 'nodejs';

const GITHUB_API_BASE = 'https://api.github.com';

function buildResponse(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

function buildGithubHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'LunaTV-Desktop-Release-History',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const repository =
    normalizeRepositorySlug(requestUrl.searchParams.get('repo')) ||
    getReleaseRepository();
  const buildLocalFallbackResponse = () => {
    const fallbackReleases = buildLocalDesktopReleaseHistoryFallback({
      repository,
      manifestProxyBaseUrl: requestUrl.origin,
    });

    if (fallbackReleases.length === 0) {
      return null;
    }

    return buildResponse({
      releases: fallbackReleases,
    });
  };

  if (!isRepositorySlug(repository)) {
    return buildResponse(
      {
        error: 'Invalid desktop release repository configuration.',
      },
      500
    );
  }

  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${repository}/releases?per_page=100`,
      {
        headers: buildGithubHeaders(),
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      const fallbackResponse = buildLocalFallbackResponse();
      if (fallbackResponse) {
        return fallbackResponse;
      }

      return buildResponse(
        {
          error: `GitHub API error ${response.status}: ${errorText.slice(
            0,
            500
          )}`,
        },
        response.status
      );
    }

    const payload = (await response.json()) as GithubReleasePayload[];
    if (!Array.isArray(payload)) {
      const fallbackResponse = buildLocalFallbackResponse();
      if (fallbackResponse) {
        return fallbackResponse;
      }

      return buildResponse(
        {
          error: 'Unexpected desktop release payload.',
        },
        502
      );
    }

    return buildResponse({
      releases: normalizeDesktopReleaseHistory(payload).map((release) => ({
        ...release,
        manifestUrl:
          getDesktopUpdaterManifestProxyUrl({
            baseUrl: requestUrl.origin,
            repository,
            tagName: release.tagName,
          }) || release.manifestUrl,
      })),
    });
  } catch (error) {
    const fallbackResponse = buildLocalFallbackResponse();
    if (fallbackResponse) {
      return fallbackResponse;
    }

    return buildResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch desktop releases.',
      },
      500
    );
  }
}
