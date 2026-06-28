import { NextRequest } from 'next/server';

import { readMusicAccountSessionCookie } from '@/features/music/services/music-account-session';
import {
  createMusicErrorResponse,
  createMusicJsonResponse,
  getMusicProviderContext,
} from '@/features/music/services/music-route-support';
import { NeteaseApiError } from '@/features/music/services/providers/netease/client';

export const runtime = 'nodejs';

function requireMusicSessionCookie(request: NextRequest): string {
  const sessionCookie = readMusicAccountSessionCookie(request);

  if (!sessionCookie) {
    throw new NeteaseApiError('未连接网易云账号，无法获取私人 FM', 401);
  }

  return sessionCookie;
}

async function readFmRequestBody(request: NextRequest): Promise<{
  action?: string;
  trackId?: string;
}> {
  try {
    return (await request.json()) as {
      action?: string;
      trackId?: string;
    };
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  try {
    const { repository, source } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );
    const payload = await repository.discoveryRepository.getPersonalFm(source, {
      sessionCookie: requireMusicSessionCookie(request),
    });

    return createMusicJsonResponse(payload);
  } catch (error) {
    return createMusicErrorResponse(error, '获取私人 FM 失败');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { repository, source } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );
    const requestBody = await readFmRequestBody(request);
    const sessionCookie = requireMusicSessionCookie(request);
    const payload =
      requestBody.action === 'trash'
        ? await repository.discoveryRepository.trashPersonalFmTrack(
            source,
            requestBody.trackId || '',
            {
              sessionCookie,
            }
          )
        : await repository.discoveryRepository.getPersonalFm(source, {
            sessionCookie,
          });

    return createMusicJsonResponse(payload);
  } catch (error) {
    return createMusicErrorResponse(error, '操作私人 FM 失败');
  }
}
