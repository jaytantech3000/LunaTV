import {
  decodeSearchHistoryValue,
  decodeSearchHistoryValues,
  encodeSearchHistoryValue,
  resolveSearchHistoryRawValue,
} from './search-history';

describe('search history helpers', () => {
  it('encodes and decodes mode-aware history entries', () => {
    const rawValue = encodeSearchHistoryValue('甄嬛传', 'legacy');
    const entry = decodeSearchHistoryValue(rawValue);

    expect(entry).toEqual({
      keyword: '甄嬛传',
      mode: 'legacy',
      rawValue,
    });
  });

  it('keeps plain legacy string history entries compatible', () => {
    expect(decodeSearchHistoryValue(' 琅琊榜 ')).toEqual({
      keyword: '琅琊榜',
      rawValue: '琅琊榜',
    });
  });

  it('filters invalid entries while decoding history arrays', () => {
    expect(
      decodeSearchHistoryValues([
        encodeSearchHistoryValue('狂飙', 'new'),
        '  ',
        '庆余年',
      ])
    ).toEqual([
      {
        keyword: '狂飙',
        mode: 'new',
        rawValue: encodeSearchHistoryValue('狂飙', 'new'),
      },
      {
        keyword: '庆余年',
        rawValue: '庆余年',
      },
    ]);
  });

  it('returns raw values for precise deletion', () => {
    const rawValue = encodeSearchHistoryValue('隐秘的角落', 'new');

    expect(
      resolveSearchHistoryRawValue({
        keyword: '隐秘的角落',
        mode: 'new',
        rawValue,
      })
    ).toBe(rawValue);
  });
});
