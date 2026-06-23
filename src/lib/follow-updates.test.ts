import {
  advanceAcknowledgedEpisodeCount,
  canManageFollowUpdates,
  getNewEpisodeRange,
  hasNewEpisodes,
  mergeLatestEpisodeCountWithoutRegression,
} from './follow-updates';
import { FollowRecord } from './types';

function buildFollowRecord(
  overrides: Partial<FollowRecord> = {}
): FollowRecord {
  return {
    title: '测试剧',
    source_name: '测试源',
    year: '2026',
    cover: 'cover.jpg',
    search_title: '测试剧',
    followed_at: 1,
    followed_episode_count: 12,
    acknowledged_episode_count: 12,
    latest_episode_count: 12,
    last_checked_at: 1,
    ...overrides,
  };
}

describe('follow-updates helpers', () => {
  it('detects new episodes and returns the correct range', () => {
    const followRecord = buildFollowRecord({
      acknowledged_episode_count: 12,
      latest_episode_count: 14,
    });

    expect(hasNewEpisodes(followRecord)).toBe(true);
    expect(getNewEpisodeRange(followRecord)).toEqual({
      start: 13,
      end: 14,
    });
  });

  it('does not regress latest episode count when upstream count goes backward', () => {
    const followRecord = buildFollowRecord({
      acknowledged_episode_count: 12,
      latest_episode_count: 14,
      last_checked_at: 10,
    });

    expect(
      mergeLatestEpisodeCountWithoutRegression(followRecord, 13, 99)
    ).toEqual(
      buildFollowRecord({
        acknowledged_episode_count: 12,
        latest_episode_count: 14,
        last_checked_at: 99,
      })
    );
  });

  it('advances acknowledged episode count and latest count together when needed', () => {
    const followRecord = buildFollowRecord({
      acknowledged_episode_count: 12,
      latest_episode_count: 12,
    });

    expect(
      advanceAcknowledgedEpisodeCount(followRecord, 14, {
        latestEpisodeCount: 14,
        checkedAt: 88,
      })
    ).toEqual(
      buildFollowRecord({
        acknowledged_episode_count: 14,
        latest_episode_count: 14,
        last_checked_at: 88,
      })
    );
  });

  it('allows desktop follow-updates for VOD cards with either a stable source or a resolvable title', () => {
    expect(
      canManageFollowUpdates({
        source: 'demo',
        id: '1',
        origin: 'vod',
        from: 'search',
        isAggregate: false,
      })
    ).toBe(true);
    expect(
      canManageFollowUpdates({
        source: 'demo',
        id: '1',
        origin: 'live',
        from: 'favorite',
      })
    ).toBe(false);
    expect(
      canManageFollowUpdates({
        origin: 'vod',
        from: 'douban',
        title: '测试剧集',
      })
    ).toBe(true);
    expect(
      canManageFollowUpdates({
        origin: 'vod',
        from: 'search',
        isAggregate: true,
        title: '测试剧集',
      })
    ).toBe(true);
    expect(
      canManageFollowUpdates({
        origin: 'vod',
        from: 'search',
        title: '   ',
      })
    ).toBe(false);
  });
});
