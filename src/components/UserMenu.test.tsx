'use client';

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const mockRouter = {
  back: jest.fn(),
  prefetch: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
};

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => mockRouter),
}));

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromBrowserCookie: jest.fn(() => ({
    role: 'user',
    username: 'demo',
  })),
}));

jest.mock('@/lib/download/session', () => ({
  purgeOfflineDownloads: jest.fn(),
}));

jest.mock('@/lib/player-enhancement-types', () => ({
  AUDIO_SPIKE_PROTECTION_LEVEL_OPTIONS: [],
  VISUAL_ENHANCEMENT_LEVEL_OPTIONS: [],
}));

jest.mock('@/lib/player-enhancements', () => ({
  PLAYER_ENHANCEMENTS_UPDATED_EVENT: 'player-enhancements-updated',
  readPlayerEnhancementPreferences: jest.fn(() => ({
    audioDynamicProtectionEnabled: false,
    audioFixedCeilingEnabled: false,
    audioSpikeProtectionLevel: 'off',
    visualEnhancementLevel: 'off',
  })),
  resetPlayerEnhancementPreferences: jest.fn(() => ({
    audioDynamicProtectionEnabled: false,
    audioFixedCeilingEnabled: false,
    audioSpikeProtectionLevel: 'off',
    visualEnhancementLevel: 'off',
  })),
  updatePlayerEnhancementPreference: jest.fn(),
}));

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: jest.fn(() => ({})),
}));

jest.mock('@/lib/scroll-lock', () => ({
  acquireScrollLock: jest.fn(() => jest.fn()),
}));

jest.mock('@/lib/version_check', () => ({
  UpdateStatus: {
    FETCH_FAILED: 'fetch_failed',
    HAS_UPDATE: 'has_update',
    NO_UPDATE: 'no_update',
  },
  checkForUpdates: jest.fn().mockResolvedValue('no_update'),
}));

jest.mock('./VersionPanel', () => ({
  VersionPanel: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div>VersionPanelMock</div> : null,
}));

jest.mock('./DownloadClientPanel', () => ({
  __esModule: true,
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div>DownloadClientPanelMock</div> : null,
}));

import { UserMenu } from './UserMenu';

describe('UserMenu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (window as Window & { RUNTIME_CONFIG?: Record<string, unknown> }).RUNTIME_CONFIG =
      {};
  });

  it('opens the client download panel and closes the menu entry list', async () => {
    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    fireEvent.click(await screen.findByRole('button', { name: '客户端下载' }));

    expect(await screen.findByText('DownloadClientPanelMock')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '客户端下载' })
    ).not.toBeInTheDocument();
  });
});
