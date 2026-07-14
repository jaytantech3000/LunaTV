import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

const mockRouter = {
  back: jest.fn(),
  prefetch: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
};

const beginNavigation = jest.fn();
const mockGetAuthInfoFromBrowserCookie = jest.fn();
const mockGetDesktopAuthRequirement = jest.fn();
const mockGetRuntimeConfig = jest.fn();
const mockResolveProfileRuntime = jest.fn();
const mockUseAppUpdateState = jest.fn();

let mockPendingNavigation: {
  href: string;
  kind: 'nav' | 'card';
  label: string;
  startedAt: number;
} | null = null;

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => mockRouter),
}));

jest.mock('@/lib/auth', () => ({
  BROWSER_AUTH_UPDATED_EVENT: 'lunatv:browser-auth-updated',
  getAuthInfoFromBrowserCookie: () => mockGetAuthInfoFromBrowserCookie(),
}));

jest.mock('@/lib/desktop/auth-session', () => ({
  buildLoginPath: jest.fn((redirectPath?: string) =>
    redirectPath
      ? `/login?redirect=${encodeURIComponent(redirectPath)}`
      : '/login'
  ),
  getDesktopAuthRequirement: () => mockGetDesktopAuthRequirement(),
  logoutDesktopSession: jest.fn(),
}));

jest.mock('@/lib/desktop/runtime-config', () => ({
  DESKTOP_RUNTIME_UPDATED_EVENT: 'lunatv:desktop-runtime-updated',
}));

jest.mock('@/lib/desktop/tauri-client', () => ({
  changeDesktopPassword: jest.fn(),
}));

jest.mock('@/lib/download/session', () => ({
  purgeOfflineDownloads: jest.fn(),
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
  resetPlayerEnhancementPreferences: jest.fn(),
  updatePlayerEnhancementPreference: jest.fn(),
}));

jest.mock('@/lib/profile/runtime', () => ({
  resolveProfileRuntime: (...args: unknown[]) =>
    mockResolveProfileRuntime(...args),
}));

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: () => mockGetRuntimeConfig(),
}));

jest.mock('@/lib/scroll-lock', () => ({
  acquireScrollLock: jest.fn(() => jest.fn()),
}));

jest.mock('@/lib/transport/api-client', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('@/lib/use-app-update', () => ({
  useAppUpdateState: () => mockUseAppUpdateState(),
}));

jest.mock('@/lib/version', () => ({
  CURRENT_VERSION: '200.0.1',
}));

jest.mock('@/lib/version_check', () => ({
  UpdateStatus: {
    FETCH_FAILED: 'fetch_failed',
    HAS_UPDATE: 'has_update',
    NO_UPDATE: 'no_update',
  },
}));

jest.mock('./DesktopSettingsSection', () => () => null);

jest.mock('./NavigationFeedbackProvider', () => ({
  useNavigationFeedback: jest.fn(() => ({
    beginNavigation,
    pendingNavigation: mockPendingNavigation,
  })),
}));

jest.mock('./VersionPanel', () => ({
  VersionPanel: () => null,
}));

import { UserMenu } from './UserMenu';

describe('UserMenu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockPendingNavigation = null;
    mockGetAuthInfoFromBrowserCookie.mockReturnValue({
      username: 'owner',
      role: 'owner',
    });
    mockGetDesktopAuthRequirement.mockResolvedValue({
      passwordRequired: true,
      username: 'owner',
      ownerPasswordConfigured: true,
    });
    mockGetRuntimeConfig.mockReturnValue({
      APP_TARGET: 'desktop',
      ENABLE_ADMIN_PANEL: true,
    });
    mockResolveProfileRuntime.mockReturnValue({
      appTarget: 'desktop',
      runtimeKind: 'desktop-profile-sync',
      storageType: 'redis',
    });
    mockUseAppUpdateState.mockReturnValue({
      isChecking: false,
      updateStatus: 'no_update',
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('shows a desktop account sync entry for desktop owner users and routes it to /account-sync', async () => {
    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    const syncEntry = await screen.findByRole('button', { name: '帐号同步' });
    fireEvent.click(syncEntry);

    expect(beginNavigation).toHaveBeenCalledWith({
      href: '/account-sync',
      kind: 'nav',
      label: '帐号同步',
    });

    act(() => {
      jest.advanceTimersByTime(1);
    });

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/account-sync');
    });
  });

  it('keeps admin and account sync pending states independent', async () => {
    mockPendingNavigation = {
      href: '/account-sync',
      kind: 'nav',
      label: '帐号同步',
      startedAt: Date.now(),
    };

    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    expect(
      await screen.findByRole('button', { name: '正在打开帐号同步...' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: '管理面板' })).not.toBeDisabled();
  });

  it('routes the settings entry to /config', async () => {
    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    fireEvent.click(await screen.findByRole('button', { name: '设置' }));

    expect(beginNavigation).toHaveBeenCalledWith({
      href: '/config',
      kind: 'nav',
      label: '设置',
    });

    act(() => {
      jest.advanceTimersByTime(1);
    });

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/config');
    });
  });

  it('keeps account sync and management discoverable for desktop guests', async () => {
    mockGetAuthInfoFromBrowserCookie.mockReturnValue(null);

    render(<UserMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    expect(
      await screen.findByRole('button', { name: '帐号同步' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '管理面板' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
  });
});
