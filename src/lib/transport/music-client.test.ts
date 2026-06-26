import { apiFetch } from './api-client';
import { fetchMusicTrack } from './music-client';

jest.mock('./api-client', () => ({
  apiFetch: jest.fn(),
}));

const apiFetchMock = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe('music-client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('surfaces backend music error messages instead of generic fallbacks', async () => {
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: '当前曲目受版权或会员限制，暂不可播放',
        }),
        {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
          status: 403,
        }
      )
    );

    await expect(
      fetchMusicTrack({
        source: 'netease',
        id: '9901',
      })
    ).rejects.toThrow('当前曲目受版权或会员限制，暂不可播放');
  });
});
