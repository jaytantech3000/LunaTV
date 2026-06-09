import { filterM3U8 } from './ad-filter';

describe('filterM3U8', () => {
  it('removes casino and gambling ad domains from variant playlists', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXTINF:6.0,',
      'https://vip.ffzyad.com/casino-roll.ts',
      '#EXTINF:10.0,',
      'https://video.example.com/main.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterM3U8(playlist);

    expect(result.changed).toBe(true);
    expect(result.adsRemoved).toBe(1);
    expect(result.filtered).not.toContain('vip.ffzyad.com');
    expect(result.filtered).toContain('video.example.com/main.ts');
  });
});
