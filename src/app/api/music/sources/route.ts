import {
  createMusicErrorResponse,
  createMusicJsonResponse,
} from '@/lib/music/netease';
import { getMusicSourcesPayload } from '@/lib/music/service';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return createMusicJsonResponse(getMusicSourcesPayload());
  } catch (error) {
    return createMusicErrorResponse(error, '获取音乐源失败');
  }
}
