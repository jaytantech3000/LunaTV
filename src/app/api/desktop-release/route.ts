import { NextResponse } from 'next/server';

import {
  buildSignedDesktopDownloadPath,
  fetchLatestDesktopRelease,
  getDesktopReleaseConfig,
  listDesktopReleaseAssets,
} from '@/lib/client-download';

export const runtime = 'nodejs';

function jsonError(error: string, status: number): Response {
  return NextResponse.json({ error }, { status });
}

export async function GET(): Promise<Response> {
  if (!getDesktopReleaseConfig()) {
    return jsonError('Desktop release is not configured', 503);
  }

  try {
    const release = await fetchLatestDesktopRelease();
    if (!release) {
      return jsonError('Desktop release is temporarily unavailable', 503);
    }

    const { assets, missingAssetKeys } = listDesktopReleaseAssets(release);
    const signedAssets = assets.map(({ asset, key, label }) => ({
      downloadPath: buildSignedDesktopDownloadPath({
        assetId: asset.id,
        releaseId: release.id,
      }),
      key,
      label,
      name: asset.name,
      size: asset.size,
    }));

    const response = NextResponse.json({
      assets: signedAssets,
      missingAssetKeys,
      publishedAt: release.published_at || release.created_at || null,
      releaseId: release.id,
      version: release.name?.trim() || release.tag_name,
    });

    if (signedAssets.length > 0) {
      response.headers.set(
        'Cache-Control',
        'public, max-age=300, s-maxage=300'
      );
      response.headers.set('CDN-Cache-Control', 'public, s-maxage=300');
      response.headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=300');
    } else {
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('CDN-Cache-Control', 'no-store');
      response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
    }

    return response;
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to load desktop release',
      502
    );
  }
}
