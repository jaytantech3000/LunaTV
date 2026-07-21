import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
const mockLogoutDesktopSession = jest.fn();

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
  logoutDesktopSession: (...args: unknown[]) =>
    mockLogoutDesktopSession(...args),
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
      syncEnabled: true,
      storageType: 'redis',
      profileMode: 'shared-multi-user',
      usesRemoteUserData: true,
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

  it('renders one horizontal group of non-interactive equal-width storage tags', async () => {
    await renderUserMenu();

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    const storageTagRow = await screen.findByTestId('user-menu-storage-tags');
    const tags = within(storageTagRow).getAllByTestId(
      /^user-menu-storage-tag-/
    );

    expect(tags).toHaveLength(2);
    expect(tags.map((tag) => tag.textContent)).toEqual([
      '本地 SQLite',
      '远端 Redis',
    ]);
    expect(tags.map((tag) => tag.tagName)).toEqual(['SPAN', 'SPAN']);
    expect(storageTagRow).toHaveClass('mt-1.5', 'flex', 'gap-1');
    expect(tags.every((tag) => tag.classList.contains('flex-1'))).toBe(true);
    tags.forEach((tag) => {
      expect(tag).toHaveClass('min-h-7', 'rounded-md', 'px-1.5', 'gap-1');
    });
    expect(
      within(tags[0]).getByTestId('user-menu-storage-status-dot-local')
    ).toHaveClass('bg-emerald-400');
    expect(
      within(tags[1]).getByTestId('user-menu-storage-status-dot-remote')
    ).toHaveClass('bg-gray-400');
    expect(tags[0]).toHaveAttribute(
      'title',
      '本地 SQLite 是日常读写主数据源。'
    );
    expect(tags[1]).toHaveAttribute('title', '远端 Redis 仅作后台同步目标。');
    expect(within(storageTagRow).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText(/数据存储：/)).not.toBeInTheDocument();
    expect(storageTagRow.textContent).not.toMatch(
      /在使用|已连接|等待登录|状态异常|登录失效/
    );
  });

  it.each([
    ['upstash', '远端 Upstash'],
    ['custom-provider', '远端存储'],
    ['', '远端未配置'],
    ['localstorage', '远端未配置'],
  ])(
    'maps desktop profile-sync storage %s to %s',
    async (storageType, expectedRemoteLabel) => {
      mockResolveProfileRuntime.mockReturnValue({
        appTarget: 'desktop',
        runtimeKind: 'desktop-profile-sync',
        syncEnabled: true,
        storageType,
        profileMode: 'shared-multi-user',
        usesRemoteUserData: true,
      });

      await renderUserMenu();

      fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

      const storageTagRow = await screen.findByTestId('user-menu-storage-tags');
      expect(
        within(storageTagRow).getByTestId('user-menu-storage-tag-remote')
      ).toHaveTextContent(expectedRemoteLabel);
    }
  );

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

    const storageTagRow = await screen.findByTestId('user-menu-storage-tags');
    const tags = within(storageTagRow).getAllByTestId(
      /^user-menu-storage-tag-/
    );

    expect(tags).toHaveLength(1);
    expect(tags[0]).toHaveTextContent('本地 SQLite');
    expect(within(storageTagRow).queryByText(/远端/)).not.toBeInTheDocument();
    expect(within(storageTagRow).queryAllByRole('button')).toHaveLength(0);
  });

  it('does not render desktop storage tags for a web runtime', async () => {
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

    expect(
      screen.queryByTestId('user-menu-storage-tags')
    ).not.toBeInTheDocument();
  });

  it('does not render desktop storage tags for web-local runtime', async () => {
    mockResolveProfileRuntime.mockReturnValue({
      appTarget: 'web',
      runtimeKind: 'web-local',
      syncEnabled: false,
      storageType: 'localstorage',
      profileMode: 'single-user-local',
      usesRemoteUserData: false,
    });

    await renderUserMenu();

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    expect(
      screen.queryByTestId('user-menu-storage-tags')
    ).not.toBeInTheDocument();
  });

  it('refreshes the provider label after a desktop runtime event without status reads', async () => {
    mockResolveProfileRuntime
      .mockReturnValueOnce({
        appTarget: 'desktop',
        runtimeKind: 'desktop-profile-sync',
        syncEnabled: true,
        storageType: 'redis',
        profileMode: 'shared-multi-user',
        usesRemoteUserData: true,
      })
      .mockReturnValueOnce({
        appTarget: 'desktop',
        runtimeKind: 'desktop-profile-sync',
        syncEnabled: true,
        storageType: 'upstash',
        profileMode: 'shared-multi-user',
        usesRemoteUserData: true,
      });

    await renderUserMenu();

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    expect(
      await screen.findByTestId('user-menu-storage-tag-remote')
    ).toHaveTextContent('远端 Redis');

    act(() => {
      window.dispatchEvent(new Event('lunatv:desktop-runtime-updated'));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('user-menu-storage-tag-remote')
      ).toHaveTextContent('远端 Upstash');
    });
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
    expect(screen.getAllByText('访客')).toHaveLength(2);
    expect(screen.queryByText('未登录')).not.toBeInTheDocument();
  });

  it('clears local desktop auth when the user logs out with sync enabled', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await renderUserMenu();

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
    fireEvent.click(await screen.findByRole('button', { name: '登出' }));

    await waitFor(() => {
      expect(mockLogoutDesktopSession).toHaveBeenCalledWith({
        rememberLoggedOut: true,
      });
    });
    consoleErrorSpy.mockRestore();
  });

  it('shows a compact green service point with a local-service title when up to date', async () => {
    await renderUserMenu();

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    const servicePoint = await screen.findByTestId(
      'user-menu-version-status-dot'
    );
    expect(servicePoint).toHaveClass('h-1.5', 'w-1.5', 'bg-green-400');
    expect(servicePoint).not.toHaveClass('-translate-y-2');
    expect(servicePoint).toHaveAttribute('title', '本地服务运行正常');
  });

  it('shows an update point without the local-service title when an update is available', async () => {
    mockUseAppUpdateState.mockReturnValue({
      isChecking: false,
      updateStatus: 'has_update',
    });

    await renderUserMenu();

    fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

    const servicePoint = await screen.findByTestId(
      'user-menu-version-status-dot'
    );
    expect(servicePoint).toHaveClass('h-1.5', 'w-1.5', 'bg-yellow-500');
    expect(servicePoint).not.toHaveAttribute('title');
  });

  it.each([
    ['checking', true, null],
    ['failed', false, 'fetch_failed'],
  ])(
    'hides the version status point while update state is %s',
    async (_, isChecking, updateStatus) => {
      mockUseAppUpdateState.mockReturnValue({
        isChecking,
        updateStatus,
      });

      await renderUserMenu();

      fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));

      expect(
        screen.queryByTestId('user-menu-version-status-dot')
      ).not.toBeInTheDocument();
    }
  );
});
