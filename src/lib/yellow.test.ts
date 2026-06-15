import {
  filterAdultContentResults,
  isAdultContentResult,
  isAdultLibraryEntry,
} from './yellow';

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

  it('prefers persisted adult flags for history and favorites', () => {
    expect(
      isAdultLibraryEntry({
        title: '普通标题',
        source_name: '普通资源',
        is_adult: true,
      })
    ).toBe(true);
  });

  it('falls back to title and search keywords when history and favorites lack flags', () => {
    expect(
      isAdultLibraryEntry({
        title: '普通标题',
        source_name: '普通资源',
        search_title: 'onlyfans',
      })
    ).toBe(true);
  });
});
