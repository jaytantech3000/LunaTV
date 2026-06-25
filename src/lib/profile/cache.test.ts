import {
  dispatchProfileCacheUpdate,
  dispatchProfileSearchHistoryUpdated,
  subscribeToProfileCacheUpdates,
} from '@/lib/profile/cache';
import { encodeSearchHistoryValue } from '@/lib/search-history';

describe('profile cache event helpers', () => {
  it('dispatches generic profile cache events', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToProfileCacheUpdates<Record<string, number>>(
      'playRecordsUpdated',
      listener
    );

    dispatchProfileCacheUpdate('playRecordsUpdated', {
      demo: 1,
    });

    expect(listener).toHaveBeenCalledWith({
      demo: 1,
    });
    unsubscribe();
  });

  it('decodes and dispatches search history updates', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToProfileCacheUpdates(
      'searchHistoryUpdated',
      listener
    );
    const rawValue = encodeSearchHistoryValue('keyword', 'new');

    dispatchProfileSearchHistoryUpdated([rawValue]);

    expect(listener).toHaveBeenCalledWith([
      {
        keyword: 'keyword',
        mode: 'new',
        rawValue,
      },
    ]);
    unsubscribe();
  });
});
