import {
  createMusicErrorResponse,
  createMusicJsonResponse,
  getMusicSourcesPayload,
} from '@/lib/music/netease';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return createMusicJsonResponse(getMusicSourcesPayload());
  } catch (error) {
    return createMusicErrorResponse(error, '获取音乐源失败');
  }
}
