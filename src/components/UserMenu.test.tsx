'use client';

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

const mockRouter = {
  back: jest.fn(),
  prefetch: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
};
const mockBeginNavigation = jest.fn();

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
  PLAYBACK_BUFFER_MODE_OPTIONS: [
    { value: 'standard', label: '默认模式' },
    { value: 'enhanced', label: '增强模式' },
    { value: 'max', label: '强力模式' },
  ],
  getPlaybackBufferModeLabel: (value: string) =>
    ({
      standard: '默认模式',
      enhanced: '增强模式',
      max: '强力模式',
    }[value] || '默认模式'),
  VISUAL_ENHANCEMENT_LEVEL_OPTIONS: [],
}));

jest.mock('@/lib/player-enhancements', () => ({
  PLAYER_ENHANCEMENTS_UPDATED_EVENT: 'player-enhancements-updated',
  readPlayerEnhancementPreferences: jest.fn(() => ({
    audioDynamicProtectionEnabled: false,
    audioFixedCeilingEnabled: false,
    audioSpikeProtectionLevel: 'off',
    playbackBufferMode: 'standard',
    visualEnhancementLevel: 'off',
  })),
  resetPlayerEnhancementPreferences: jest.fn(() => ({
    audioDynamicProtectionEnabled: false,
    audioFixedCeilingEnabled: false,
    audioSpikeProtectionLevel: 'off',
    playbackBufferMode: 'standard',
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
  checkForUpdates: jest.fn(() => new Promise((_resolve) => undefined)),
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

import { updatePlayerEnhancementPreference } from '@/lib/player-enhancements';
jest.mock('./NavigationFeedbackProvider', () => ({
  useNavigationFeedback: jest.fn(() => ({
    beginNavigation: mockBeginNavigation,
    pendingNavigation: null,
  })),
}));

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

import { useNavigationFeedback } from './NavigationFeedbackProvider';
import { UserMenu } from './UserMenu';

describe('UserMenu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    localStorage.clear();
    (
      window as Window & { RUNTIME_CONFIG?: Record<string, unknown> }
    ).RUNTIME_CONFIG = {};
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue({
      role: 'user',
      username: 'demo',
    });
    (useNavigationFeedback as jest.Mock).mockReturnValue({
      beginNavigation: mockBeginNavigation,
      pendingNavigation: null,
    });
  });

  it('opens the client download panel and closes the menu entry list', async () => {
    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    fireEvent.click(await screen.findByRole('button', { name: '客户端下载' }));

    expect(
      await screen.findByText('DownloadClientPanelMock')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '客户端下载' })
    ).not.toBeInTheDocument();
  });

  it('updates playback buffer mode from the settings panel', async () => {
    const mockUpdatePlayerEnhancementPreference =
      updatePlayerEnhancementPreference as jest.Mock;

    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '增强模式' }));

    expect(mockUpdatePlayerEnhancementPreference).toHaveBeenCalledWith(
      'playbackBufferMode',
      'enhanced'
    );
    expect(screen.getByText('当前：增强模式')).toBeInTheDocument();
  });

  it('prefetches and starts navigation feedback before opening admin panel', async () => {
    jest.useFakeTimers();
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue({
      role: 'owner',
      username: 'demo',
    });

    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    fireEvent.click(await screen.findByRole('button', { name: '管理面板' }));

    expect(mockBeginNavigation).toHaveBeenCalledWith({
      href: '/admin',
      kind: 'nav',
      label: '管理面板',
    });
    expect(mockRouter.prefetch).toHaveBeenCalledWith('/admin');
    expect(
      screen.queryByRole('button', { name: '管理面板' })
    ).not.toBeInTheDocument();

    act(() => {
      jest.runOnlyPendingTimers();
    });

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/admin');
    });
  });

  it('disables the admin action while opening the admin panel', async () => {
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue({
      role: 'admin',
      username: 'demo',
    });
    (useNavigationFeedback as jest.Mock).mockReturnValue({
      beginNavigation: mockBeginNavigation,
      pendingNavigation: {
        href: '/admin',
        kind: 'nav',
        label: '管理面板',
        startedAt: Date.now(),
      },
    });

    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    const adminButton = await screen.findByRole('button', {
      name: '正在打开管理面板...',
    });
    expect(adminButton).toBeDisabled();
    expect(adminButton).toHaveAttribute('aria-busy', 'true');
  });
});
