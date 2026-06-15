import {
  getVideoQualityFromResolution,
  parseVideoQualityFromManifest,
  parseVideoQualityHints,
} from './video-quality';

describe('video quality helpers', () => {
  it('detects the highest quality from master playlists', () => {
    const manifestText = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720,NAME="720p"
720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4200000,RESOLUTION=1920x1080,NAME="1080p"
1080/index.m3u8
`;

    expect(parseVideoQualityFromManifest(manifestText)).toBe('1080p');
  });

  it('falls back to textual quality hints when resolution is absent', () => {
    expect(
      parseVideoQualityFromManifest(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,NAME="4K"\n4k/index.m3u8'
      )
    ).toBe('4K');
  });

  it('extracts quality hints from urls and labels', () => {
    expect(
      parseVideoQualityHints([
        'https://example.com/video_2160p/index.m3u8',
        '备用线路',
      ])
    ).toBe('4K');
  });

  it('maps dimensions to human-readable quality labels', () => {
    expect(getVideoQualityFromResolution(3840, 2160)).toBe('4K');
    expect(getVideoQualityFromResolution(1920, 1080)).toBe('1080p');
    expect(getVideoQualityFromResolution(640, 360)).toBe('SD');
    expect(getVideoQualityFromResolution()).toBe('未知');
  });
});
