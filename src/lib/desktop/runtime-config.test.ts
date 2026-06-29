import { AppRuntimeConfig } from '@/lib/runtime-config';

import { mergeDesktopRuntimePublicConfig } from './runtime-config';

describe('mergeDesktopRuntimePublicConfig', () => {
  function buildRuntimeConfig(
    overrides: Partial<AppRuntimeConfig> = {}
  ): AppRuntimeConfig {
    return {
      DOUBAN_PROXY_TYPE: '',
      DOUBAN_PROXY: '',
      DOUBAN_IMAGE_PROXY_TYPE: '',
      DOUBAN_IMAGE_PROXY: '',
      DISABLE_YELLOW_FILTER: false,
      FLUID_SEARCH: true,
      ENABLE_WEB_LIVE: false,
      ...overrides,
    };
  }

  it('defaults desktop music to enabled when both current and payload omit the switch', () => {
    expect(
      mergeDesktopRuntimePublicConfig(buildRuntimeConfig(), {})
    ).toMatchObject({
      ENABLE_WEB_MUSIC: true,
    });
  });

  it('respects an explicit desktop music disable from the payload', () => {
    expect(
      mergeDesktopRuntimePublicConfig(buildRuntimeConfig(), {
        enableWebMusic: false,
      })
    ).toMatchObject({
      ENABLE_WEB_MUSIC: false,
    });
  });
});
