jest.mock('@/lib/transport/api-client', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('@/lib/transport/endpoint', () => ({
  buildApiUrl: jest.fn(),
}));

import { apiFetch } from '@/lib/transport/api-client';
import { buildApiUrl } from '@/lib/transport/endpoint';

import {
  buildContentSearchStreamUrl,
  fetchContentDetail,
  fetchContentSearchResults,
  fetchContentSuggestions,
} from './content-discovery-client';

function createJsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

const apiFetchMock = apiFetch as jest.MockedFunction<typeof apiFetch>;
const buildApiUrlMock = buildApiUrl as jest.MockedFunction<typeof buildApiUrl>;

describe('content discovery client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads content detail through the shared detail route', async () => {
    const payload = {
      id: '1001',
      source: 'demo',
      title: '测试影片',
      episodes: ['https://example.com/1.m3u8'],
      episodes_titles: ['第1集'],
    };
    apiFetchMock.mockResolvedValue(createJsonResponse(payload));

    await expect(
      fetchContentDetail(
        {
          source: 'demo',
          id: '1001',
        },
        {
          cache: 'no-store',
        }
      )
    ).resolves.toEqual(payload);

    expect(apiFetchMock).toHaveBeenCalledWith('/detail', {
      cache: 'no-store',
      searchParams: {
        source: 'demo',
        id: '1001',
      },
    });
  });

  it('propagates detail route errors through the shared client', async () => {
    apiFetchMock.mockResolvedValue(
      createJsonResponse(
        {
          error: 'detail failed',
        },
        false
      )
    );

    await expect(
      fetchContentDetail({
        source: 'demo',
        id: 'missing',
      })
    ).rejects.toThrow('detail failed');
  });

  it('loads content search results and can opt into adult candidates', async () => {
    const payload = {
      results: [
        {
          id: '2002',
          source: 'adult',
          title: '测试归集',
          episodes: ['https://example.com/1.m3u8'],
          episodes_titles: ['第1集'],
        },
      ],
    };
    apiFetchMock.mockResolvedValue(createJsonResponse(payload));

    await expect(
      fetchContentSearchResults('测试归集', {
        allowAdultResults: true,
        credentials: 'same-origin',
      })
    ).resolves.toEqual(payload.results);

    expect(apiFetchMock).toHaveBeenCalledWith('/search', {
      credentials: 'same-origin',
      searchParams: {
        q: '测试归集',
        adult: '1',
      },
    });
  });

  it('loads search suggestions through the shared suggestion route', async () => {
    const payload = {
      suggestions: [
        {
          text: '测试剧',
          type: 'related',
          score: 1.5,
        },
      ],
    };
    apiFetchMock.mockResolvedValue(createJsonResponse(payload));

    await expect(fetchContentSuggestions('测试')).resolves.toEqual(
      payload.suggestions
    );
    expect(apiFetchMock).toHaveBeenCalledWith('/search/suggestions', {
      searchParams: {
        q: '测试',
      },
    });
  });

  it('builds the shared content search stream url', () => {
    buildApiUrlMock.mockReturnValue('/api/search/ws?q=测试');

    expect(buildContentSearchStreamUrl('测试')).toBe('/api/search/ws?q=测试');
    expect(buildApiUrlMock).toHaveBeenCalledWith('/search/ws', {
      q: '测试',
    });
  });
});
