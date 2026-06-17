jest.mock('@/lib/client-download', () => ({
  fetchLocalServiceReleaseSummary: jest.fn(),
}));

import { fetchLocalServiceReleaseSummary } from '@/lib/client-download';

import { GET } from './route';

describe('/api/local-service-release', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns local service release metadata with cache headers', async () => {
    (fetchLocalServiceReleaseSummary as jest.Mock).mockResolvedValue({
      availablePlatforms: ['mac-arm64'],
      configuredPlatforms: ['mac-arm64', 'win-x64'],
      displayName: 'LunaTV Local Service (local-service-nova-2026-06-16.3)',
      installerPlatforms: ['mac-arm64'],
      publishedAt: '2026-06-16T03:00:00.000Z',
      releaseStatus: 'release',
      version: 'local-service-nova-2026-06-16.3',
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      availablePlatforms: ['mac-arm64'],
      configuredPlatforms: ['mac-arm64', 'win-x64'],
      displayName: 'LunaTV Local Service (local-service-nova-2026-06-16.3)',
      installerPlatforms: ['mac-arm64'],
      publishedAt: '2026-06-16T03:00:00.000Z',
      releaseStatus: 'release',
      version: 'local-service-nova-2026-06-16.3',
    });
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe(
      'public, s-maxage=300'
    );
  });

  it('returns 503 when local service release metadata is unavailable', async () => {
    (fetchLocalServiceReleaseSummary as jest.Mock).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Local service release is not configured',
    });
  });
});
