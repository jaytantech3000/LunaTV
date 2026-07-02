import { render, screen } from '@testing-library/react';

import ConfigPageClient from './ConfigPageClient';

jest.mock('@/lib/desktop/runtime-config', () => ({
  DESKTOP_RUNTIME_UPDATED_EVENT: 'lunatv:desktop-runtime-updated',
}));

jest.mock('@/lib/fluid-search', () => ({
  getDefaultFluidSearchSetting: jest.fn(() => true),
  getPreferredFluidSearchSetting: jest.fn(() => true),
  isFluidSearchSupported: jest.fn(() => true),
  setPreferredFluidSearchSetting: jest.fn(),
}));

jest.mock('@/lib/player-enhancement-types', () => ({
  AUDIO_SPIKE_PROTECTION_LEVEL_OPTIONS: [],
  VISUAL_ENHANCEMENT_LEVEL_OPTIONS: [],
}));

jest.mock('@/lib/player-enhancements', () => ({
  PLAYER_ENHANCEMENTS_UPDATED_EVENT: 'lunatv:player-enhancements-updated',
  readPlayerEnhancementPreferences: jest.fn(() => ({
    audioSpikeProtectionLevel: 'off',
    audioDynamicProtectionEnabled: false,
    audioFixedCeilingEnabled: false,
    visualEnhancementLevel: 'off',
  })),
  resetPlayerEnhancementPreferences: jest.fn(() => ({
    audioSpikeProtectionLevel: 'off',
    audioDynamicProtectionEnabled: false,
    audioFixedCeilingEnabled: false,
    visualEnhancementLevel: 'off',
  })),
  updatePlayerEnhancementPreference: jest.fn(),
}));

jest.mock('@/lib/profile/runtime', () => ({
  resolveProfileRuntime: jest.fn(() => ({
    appTarget: 'desktop',
    runtimeKind: 'desktop-profile-sync',
    storageType: 'redis',
  })),
}));

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: jest.fn(() => ({
    APP_TARGET: 'desktop',
  })),
}));

jest.mock('./DesktopSettingsSection', () => ({
  __esModule: true,
  default: () => <div data-testid='desktop-settings-section' />,
}));

describe('ConfigPageClient', () => {
  beforeEach(() => {
    Object.assign(window, {
      RUNTIME_CONFIG: {
        APP_TARGET: 'desktop',
        DOUBAN_PROXY_TYPE: 'cmliussss-cdn-tencent',
        DOUBAN_PROXY: '',
        DOUBAN_IMAGE_PROXY_TYPE: 'cmliussss-cdn-tencent',
        DOUBAN_IMAGE_PROXY: '',
      },
    });
  });

  it('renders local preferences together with desktop config controls', async () => {
    render(<ConfigPageClient />);

    expect(await screen.findByText('配置')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '恢复默认' })
    ).toBeInTheDocument();
    expect(screen.getByText('豆瓣数据代理')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-settings-section')).toBeInTheDocument();
  });
});
