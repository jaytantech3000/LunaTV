import {
  createMusicErrorResponse,
  createMusicJsonResponse,
} from '@/features/music/services/music-route-support';
import { createNeteaseRepository } from '@/features/music/services/providers/netease/repository';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const repository = createNeteaseRepository();
    const payload = await repository.sourceRepository.getSources();

    return createMusicJsonResponse(payload);
  } catch (error) {
    return createMusicErrorResponse(error, '获取音乐源失败');
  }
}
