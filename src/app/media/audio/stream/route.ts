import { NextRequest } from 'next/server';

import {
  createMusicErrorResponse,
  getMusicAudioStreamResponse,
} from '@/lib/music/netease';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    return await getMusicAudioStreamResponse(request);
  } catch (error) {
    return createMusicErrorResponse(error, '加载音乐音频流失败');
  }
}
