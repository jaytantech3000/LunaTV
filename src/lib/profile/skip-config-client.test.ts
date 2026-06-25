jest.mock('@/lib/profile/runtime', () => ({
  shouldUseRemoteProfileStorage: jest.fn(() => false),
}));

import {
  deleteSkipConfig,
  getAllSkipConfigs,
  getSkipConfig,
  saveSkipConfig,
} from '@/lib/profile/skip-config-client';

describe('skip config client', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads, writes, and deletes skip configs in local mode', async () => {
    await saveSkipConfig('demo', '1', {
      enable: true,
      intro_time: 12,
      outro_time: 34,
    });

    expect(await getSkipConfig('demo', '1')).toEqual({
      enable: true,
      intro_time: 12,
      outro_time: 34,
    });
    expect(await getAllSkipConfigs()).toEqual({
      'demo+1': {
        enable: true,
        intro_time: 12,
        outro_time: 34,
      },
    });

    await deleteSkipConfig('demo', '1');

    expect(await getSkipConfig('demo', '1')).toBeNull();
    expect(await getAllSkipConfigs()).toEqual({});
  });
});
