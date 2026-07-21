import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockRouter = {
  replace: jest.fn(),
};
const mockSearchParams = new URLSearchParams();

const mockHasExplicitDesktopLogout = jest.fn(() => false);
const mockGetDesktopAuthRequirement = jest.fn();
const mockLoginDesktopSession = jest.fn();
const mockLoadDesktopProfileBootstrapState = jest.fn();
const mockGetRuntimeConfig = jest.fn();
const mockCheckForUpdates = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => mockRouter),
  useSearchParams: jest.fn(() => mockSearchParams),
}));

jest.mock('@/lib/auth', () => ({
  setAuthInfoInBrowser: jest.fn(),
}));

jest.mock('@/lib/desktop/auth-session', () => ({
  getDesktopAuthRequirement: (...args: unknown[]) =>
    mockGetDesktopAuthRequirement(...args),
  hasExplicitDesktopLogout: () => mockHasExplicitDesktopLogout(),
  loginDesktopSession: (...args: unknown[]) => mockLoginDesktopSession(...args),
}));

jest.mock('@/lib/desktop/profile-bootstrap', () => ({
  loadDesktopProfileBootstrapState: (...args: unknown[]) =>
    mockLoadDesktopProfileBootstrapState(...args),
}));

jest.mock('@/lib/release-urls', () => ({
  getProjectPageUrl: jest.fn(() => 'https://example.com/releases'),
}));

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: () => mockGetRuntimeConfig(),
}));

jest.mock('@/lib/transport/api-client', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('@/lib/version', () => ({
  CURRENT_VERSION: '200.0.1',
}));

jest.mock('@/lib/version_check', () => ({
  checkForUpdates: (...args: unknown[]) => mockCheckForUpdates(...args),
  UpdateStatus: {
    HAS_UPDATE: 'has_update',
    NO_UPDATE: 'no_update',
    FETCH_FAILED: 'fetch_failed',
  },
}));

jest.mock('@/components/SiteProvider', () => ({
  useSite: () => ({
    siteName: 'LunaTV',
  }),
}));

jest.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <div data-testid='theme-toggle' />,
}));

import { LoginPageClient } from './LoginPageClient';

function createDesktopBootstrapPayload(options: {
  profileSyncEnabled: boolean;
  reachable?: boolean;
  authenticated?: boolean;
  profileMode?: 'single-user-local' | 'shared-multi-user' | null;
  storageType?: string | null;
  error?: string | null;
  errorKind?:
    | 'not-configured'
    | 'invalid-base-url'
    | 'unreachable'
    | 'unauthorized'
    | 'protocol-incompatible'
    | 'upstream-failure'
    | null;
  localAuth?: {
    username: string;
    passwordRequired: boolean;
    multiUser: boolean;
    ownerPasswordConfigured: boolean;
  };
}) {
  return {
    appTarget: 'desktop',
    runtime: {
      siteName: 'LunaTV',
      profileSyncEnabled: options.profileSyncEnabled,
    },
    profileSync: {
      enabled: options.profileSyncEnabled,
      reachable: options.reachable ?? true,
      authenticated: options.authenticated ?? false,
      username: null,
      role: null,
      storageType:
        options.storageType !== undefined ? options.storageType : 'redis',
      profileMode:
        options.profileMode !== undefined
          ? options.profileMode
          : 'shared-multi-user',
      error: options.error ?? null,
      errorKind: options.errorKind ?? null,
      syncDomains: [
        'playrecords',
        'favorites',
        'follows',
        'searchhistory',
        'skipconfigs',
      ],
    },
    localAuth: options.localAuth ?? {
      username: 'owner',
      passwordRequired: true,
      multiUser: false,
      ownerPasswordConfigured: true,
    },
  };
}

describe('LoginPage desktop profile sync branches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams.forEach((_, key) => {
      mockSearchParams.delete(key);
    });
    mockGetRuntimeConfig.mockReturnValue({
      APP_TARGET: 'desktop',
    });
    mockCheckForUpdates.mockResolvedValue('fetch_failed');
    mockHasExplicitDesktopLogout.mockReturnValue(false);
    mockGetDesktopAuthRequirement.mockResolvedValue(null);
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
    };
  });

  afterEach(() => {
    delete window.RUNTIME_CONFIG;
  });

  it('keeps local desktop login as the primary login when profile sync is enabled', async () => {
    const payload = createDesktopBootstrapPayload({
      profileSyncEnabled: true,
      reachable: true,
      authenticated: false,
      profileMode: 'shared-multi-user',
    });
    mockLoadDesktopProfileBootstrapState.mockResolvedValue({
      payload,
      localAuth: payload.localAuth,
    });

    render(<LoginPageClient />);

    expect(
      await screen.findByText('桌面版当前使用云端账号与用户数据同步。')
    ).toBeInTheDocument();
    expect(mockLoadDesktopProfileBootstrapState).toHaveBeenCalledWith({
      localAuthMode: 'best-effort',
      preferCachedPayload: true,
    });
    expect(screen.queryByPlaceholderText('输入用户名')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入访问密码')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('输入访问密码'), {
      target: { value: 'local-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => {
      expect(mockLoginDesktopSession).toHaveBeenCalledWith(
        undefined,
        'local-secret'
      );
    });
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it('surfaces protocol incompatibility instead of treating sync as healthy', async () => {
    const payload = createDesktopBootstrapPayload({
      profileSyncEnabled: true,
      reachable: true,
      authenticated: false,
      profileMode: 'shared-multi-user',
      error: 'unexpected profile sync response',
      errorKind: 'protocol-incompatible',
    });
    mockLoadDesktopProfileBootstrapState.mockResolvedValue({
      payload,
      localAuth: payload.localAuth,
    });

    render(<LoginPageClient />);

    expect(
      await screen.findByText('云端账号同步协议不兼容，请升级桌面端或 Web 端。')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('桌面版当前使用云端账号与用户数据同步。')
    ).not.toBeInTheDocument();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('keeps local login available when remote sync is unavailable', async () => {
    const payload = createDesktopBootstrapPayload({
      profileSyncEnabled: true,
      reachable: false,
      authenticated: false,
      profileMode: null,
      storageType: null,
      error: 'connect failed',
      errorKind: 'unreachable',
    });
    mockLoadDesktopProfileBootstrapState.mockResolvedValue({
      payload,
      localAuth: payload.localAuth,
    });

    render(<LoginPageClient />);

    expect(
      await screen.findByText(
        '云端账号同步服务当前不可用，请检查远端服务地址。'
      )
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('输入用户名')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入访问密码')).toBeInTheDocument();
  });

  it('falls back to the local desktop auth branch when profile sync is disabled', async () => {
    const payload = createDesktopBootstrapPayload({
      profileSyncEnabled: false,
      profileMode: 'single-user-local',
      storageType: null,
      localAuth: {
        username: 'owner',
        passwordRequired: true,
        multiUser: false,
        ownerPasswordConfigured: true,
      },
    });
    mockLoadDesktopProfileBootstrapState.mockResolvedValue({
      payload,
      localAuth: payload.localAuth,
    });

    render(<LoginPageClient />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入访问密码')).toBeInTheDocument();
    });

    expect(mockLoadDesktopProfileBootstrapState).toHaveBeenCalledWith({
      localAuthMode: 'best-effort',
      preferCachedPayload: true,
    });
    expect(
      screen.queryByText('桌面版当前使用云端账号与用户数据同步。')
    ).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('输入用户名')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入访问密码')).toBeInTheDocument();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('requires manual username input after an explicit desktop logout', async () => {
    mockHasExplicitDesktopLogout.mockReturnValue(true);
    const payload = createDesktopBootstrapPayload({
      profileSyncEnabled: false,
      profileMode: 'single-user-local',
      storageType: null,
      localAuth: {
        username: 'owner',
        passwordRequired: true,
        multiUser: false,
        ownerPasswordConfigured: true,
      },
    });
    mockLoadDesktopProfileBootstrapState.mockResolvedValue({
      payload,
      localAuth: payload.localAuth,
    });

    render(<LoginPageClient />);

    const usernameInput = await screen.findByPlaceholderText('输入用户名');
    const passwordInput = screen.getByPlaceholderText('输入访问密码');

    fireEvent.change(usernameInput, {
      target: { value: 'alice' },
    });
    fireEvent.change(passwordInput, {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => {
      expect(mockLoginDesktopSession).toHaveBeenCalledWith('alice', 'secret');
    });
  });

  it('surfaces desktop local login errors instead of collapsing them into a network error', async () => {
    mockHasExplicitDesktopLogout.mockReturnValue(true);
    const payload = createDesktopBootstrapPayload({
      profileSyncEnabled: false,
      profileMode: 'single-user-local',
      storageType: null,
      localAuth: {
        username: 'owner',
        passwordRequired: true,
        multiUser: false,
        ownerPasswordConfigured: true,
      },
    });
    mockLoadDesktopProfileBootstrapState.mockResolvedValue({
      payload,
      localAuth: payload.localAuth,
    });
    mockLoginDesktopSession.mockRejectedValue(new Error('用户名或密码错误'));

    render(<LoginPageClient />);

    const usernameInput = await screen.findByPlaceholderText('输入用户名');
    const passwordInput = screen.getByPlaceholderText('输入访问密码');

    fireEvent.change(usernameInput, {
      target: { value: 'admin' },
    });
    fireEvent.change(passwordInput, {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('用户名或密码错误')).toBeInTheDocument();
  });

  it('falls back to direct desktop auth when desktop bootstrap is unavailable', async () => {
    mockHasExplicitDesktopLogout.mockReturnValue(true);
    mockLoadDesktopProfileBootstrapState.mockRejectedValue(
      new Error('bootstrap unavailable')
    );
    mockGetDesktopAuthRequirement.mockResolvedValue({
      username: 'owner',
      passwordRequired: true,
      multiUser: false,
      ownerPasswordConfigured: true,
    });

    render(<LoginPageClient />);

    const usernameInput = await screen.findByPlaceholderText('输入用户名');

    expect(usernameInput).toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入访问密码')).toBeInTheDocument();
    expect(
      screen.getByText('本地服务当前不可用，已切换到桌面本地登录。')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('桌面登录服务不可用，请通过桌面壳启动应用。')
    ).not.toBeInTheDocument();
  });
});
