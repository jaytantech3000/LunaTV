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
    const signedAssets = assets.map(({ asset, key, label }) => {
      const downloadPath = buildSignedDesktopDownloadPath({
        assetId: asset.id,
        releaseId: release.id,
      });

      if (!downloadPath) {
        throw new Error('Download signing unavailable');
      }

      return {
        downloadPath,
        key,
        label,
        name: asset.name,
        size: asset.size,
      };
    });

    const response = NextResponse.json({
      assets: signedAssets,
      missingAssetKeys,
      publishedAt: release.published_at || release.created_at || null,
      releaseId: release.id,
      version: release.name?.trim() || release.tag_name,
    });

    response.headers.set('Cache-Control', 'public, max-age=300, s-maxage=300');
    response.headers.set('CDN-Cache-Control', 'public, s-maxage=300');
    response.headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=300');
    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to load desktop release';
    const status =
      message === 'Download signing unavailable' ? 503 : 502;

    return jsonError(message, status);
  }
}
