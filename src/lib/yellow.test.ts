import { filterAdultContentResults, isAdultContentResult } from './yellow';

describe('yellow helpers', () => {
  it('marks onlyfans-branded titles as adult content for downstream playback', () => {
    expect(
      isAdultContentResult({
        title: 'OnlyFans 精选合集',
        source_name: '普通资源',
      })
    ).toBe(true);
  });

  it('filters onlyfans-branded results when adult filtering is enabled upstream', () => {
    expect(
      filterAdultContentResults([
        {
          title: 'Only Fans 精选合集',
          source_name: '普通资源',
        },
      ])
    ).toEqual([]);
  });
});
