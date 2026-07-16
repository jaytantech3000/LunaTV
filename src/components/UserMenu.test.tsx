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
const mockReadDesktopProfileSyncStatusState = jest.fn();
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

jest.mock('@/lib/desktop/profile-sync', () => ({
  readDesktopProfileSyncStatusState: () =>
    mockReadDesktopProfileSyncStatusState(),
  resolveDesktopProfileSyncState: (status: {
    enabled?: boolean;
    reachable?: boolean;
    authenticated?: boolean;
    reauthRequired?: boolean;
    errorKind?: string | null;
  }) => {
    if (!status?.enabled) return 'disabled';
    if (!status.reachable) return 'offline';
    if (status.reauthRequired || status.errorKind === 'unauthorized') {
      return 'auth-expired';
    }
    if (status.errorKind) return 'degraded';
    return status.authenticated ? 'ready' : 'connected';
  },
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
      syncEnabled: true,
      storageType: 'redis',
      profileMode: 'shared-multi-user',
      usesRemoteUserData: true,
    });
    mockReadDesktopProfileSyncStatusState.mockResolvedValue({
      status: {
        enabled: true,
        reachable: true,
        authenticated: true,
        reauthRequired: false,
        storageType: 'redis',
        errorKind: null,
        pendingOutboxCount: 0,
      },
      error: '',
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

  const renderUserMenu = async () => {
    await act(async () => {
      render(<UserMenu />);
    });
  };

  it('shows a desktop account sync entry for desktop owner users and routes it to /account-sync', async () => {
    await renderUserMenu();

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

    await renderUserMenu();

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    expect(
      await screen.findByRole('button', { name: '正在打开帐号同步...' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: '管理面板' })).not.toBeDisabled();
  });

  it('routes the settings entry to /config', async () => {
    await renderUserMenu();

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

  it('shows local SQLite as the primary store and Redis as the remote sync provider', async () => {
    await renderUserMenu();

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    await waitFor(() => {
      expect(screen.getByText(/数据存储：/)).toHaveTextContent(
        '数据存储：本地 SQLite · 远端同步：Redis'
      );
    });
  });

  it('renders equal-width local and remote status rows with accessible details', async () => {
    await renderUserMenu();

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    expect(
      await screen.findByRole('button', { name: '已连接' })
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('user-menu-storage-status-local-row')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('user-menu-storage-status-remote-row')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '本地 SQLite' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '在使用' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '远端 Redis' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已连接' })).toBeInTheDocument();

    const localTag = screen.getByRole('button', { name: '本地 SQLite' });
    const tooltipId = localTag.getAttribute('aria-describedby');
    expect(tooltipId).toBeTruthy();
    expect(document.getElementById(tooltipId || '')).toHaveAttribute(
      'role',
      'tooltip'
    );
    expect(document.getElementById(tooltipId || '')).toHaveTextContent(
      '本地 SQLite 是日常读写主数据源'
    );

    fireEvent.focus(localTag);
    expect(document.getElementById(tooltipId || '')).toBeInTheDocument();
  });

  it('renders waiting login instead of disconnected for a reachable unauthenticated remote', async () => {
    mockReadDesktopProfileSyncStatusState.mockResolvedValue({
      status: {
        enabled: true,
        reachable: true,
        authenticated: false,
        reauthRequired: false,
        storageType: 'redis',
        errorKind: null,
      },
      error: '',
    });

    await renderUserMenu();

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    expect(
      await screen.findByRole('button', { name: '等待登录' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '未连接' })
    ).not.toBeInTheDocument();
  });

  it('renders status exception instead of disconnected for a reachable protocol error', async () => {
    mockReadDesktopProfileSyncStatusState.mockResolvedValue({
      status: {
        enabled: true,
        reachable: true,
        authenticated: false,
        reauthRequired: false,
        storageType: 'redis',
        errorKind: 'protocol-incompatible',
      },
      error: '',
    });

    await renderUserMenu();

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    expect(
      await screen.findByRole('button', { name: '状态异常' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '未连接' })
    ).not.toBeInTheDocument();
  });

  it('renders an unconfigured tag for a disabled remote without an error kind', async () => {
    mockReadDesktopProfileSyncStatusState.mockResolvedValue({
      status: {
        enabled: false,
        reachable: false,
        authenticated: false,
        reauthRequired: false,
        storageType: null,
        errorKind: null,
      },
      error: '',
    });

    await renderUserMenu();

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    expect(
      await screen.findByRole('button', { name: '未配置' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '未连接' })
    ).not.toBeInTheDocument();
  });

  it('does not render a local SQLite tag for web-remote runtime', async () => {
    mockResolveProfileRuntime.mockReturnValue({
      appTarget: 'web',
      runtimeKind: 'web-remote',
      syncEnabled: false,
      storageType: 'redis',
      profileMode: 'shared-multi-user',
      usesRemoteUserData: true,
    });

    await renderUserMenu();

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    await waitFor(() => {
      expect(screen.getByText('数据存储：Redis 远端存储')).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: '本地 SQLite' })
    ).not.toBeInTheDocument();
  });

  it('shows only the local SQLite tag for desktop-local runtime', async () => {
    mockResolveProfileRuntime.mockReturnValue({
      appTarget: 'desktop',
      runtimeKind: 'desktop-local',
      syncEnabled: false,
      storageType: 'localstorage',
      profileMode: 'single-user-local',
      usesRemoteUserData: false,
    });

    await renderUserMenu();

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    expect(
      await screen.findByRole('button', { name: '本地 SQLite' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /远端/ })
    ).not.toBeInTheDocument();
    expect(mockReadDesktopProfileSyncStatusState).not.toHaveBeenCalled();
  });

  it('refreshes runtime tags and profile sync status after the desktop runtime event', async () => {
    mockReadDesktopProfileSyncStatusState
      .mockResolvedValueOnce({
        status: {
          enabled: true,
          reachable: true,
          authenticated: true,
          reauthRequired: false,
          storageType: 'redis',
          errorKind: null,
          pendingOutboxCount: 0,
        },
        error: '',
      })
      .mockResolvedValueOnce({
        status: {
          enabled: true,
          reachable: true,
          authenticated: false,
          reauthRequired: true,
          storageType: 'upstash',
          errorKind: 'unauthorized',
          error: '远端会话已过期',
          pendingOutboxCount: 2,
        },
        error: '',
      });

    await renderUserMenu();

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    expect(
      await screen.findByRole('button', { name: '远端 Redis' })
    ).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('lunatv:desktop-runtime-updated'));
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '远端 Upstash' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: '登录失效' })
      ).toBeInTheDocument();
    });
    expect(mockReadDesktopProfileSyncStatusState).toHaveBeenCalledTimes(2);
  });

  it('keeps account sync and management discoverable for desktop guests', async () => {
    mockGetAuthInfoFromBrowserCookie.mockReturnValue(null);

    await renderUserMenu();

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
