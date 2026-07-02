import { AppRuntimeConfig } from '@/lib/runtime-config';

import { mergeDesktopRuntimePublicConfig } from './runtime-config';

const removedRuntimeKey = ['ENABLE', 'WEB', 'MUSIC'].join('_');
const removedPayloadKey = ['enable', 'WebMusic'].join('');

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

  it('strips the legacy music flag from current desktop runtime config', () => {
    expect(
      mergeDesktopRuntimePublicConfig(
        buildRuntimeConfig({
          [removedRuntimeKey]: true,
        } as unknown as Partial<AppRuntimeConfig>),
        {}
      )
    ).not.toHaveProperty(removedRuntimeKey);
  });

  it('ignores the legacy desktop music flag from runtime payloads', () => {
    expect(
      mergeDesktopRuntimePublicConfig(buildRuntimeConfig(), {
        [removedPayloadKey]: false,
      } as never)
    ).not.toHaveProperty(removedRuntimeKey);
  });
});
