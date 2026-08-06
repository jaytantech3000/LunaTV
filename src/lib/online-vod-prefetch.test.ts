import {
  ONLINE_VOD_PREFETCH_UPDATED_EVENT,
  readOnlineVodPrefetchPreferences,
  updateOnlineVodPrefetchPreferences,
} from '@/lib/online-vod-prefetch';

describe('online VOD prefetch preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to disabled with a 30 second window', () => {
    expect(readOnlineVodPrefetchPreferences()).toEqual({
      enabled: false,
      windowMode: '30s',
    });
  });

  it('persists the switch and selected prefetch window', () => {
    const listener = jest.fn();
    window.addEventListener(ONLINE_VOD_PREFETCH_UPDATED_EVENT, listener);

    expect(
      updateOnlineVodPrefetchPreferences({
        enabled: true,
        windowMode: 'episode',
      })
    ).toEqual({
      enabled: true,
      windowMode: 'episode',
    });
    expect(readOnlineVodPrefetchPreferences()).toEqual({
      enabled: true,
      windowMode: 'episode',
    });
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(ONLINE_VOD_PREFETCH_UPDATED_EVENT, listener);
  });

  it('normalizes an invalid stored window to 30 seconds', () => {
    window.localStorage.setItem('onlineVodPrefetchEnabled', 'true');
    window.localStorage.setItem('onlineVodPrefetchWindowMode', 'invalid');

    expect(readOnlineVodPrefetchPreferences()).toEqual({
      enabled: true,
      windowMode: '30s',
    });
  });
});
