import { render, screen, waitFor } from '@testing-library/react';

const mockRouter = {
  replace: jest.fn(),
};
const mockSearchParams = new URLSearchParams();

const mockHasExplicitDesktopLogout = jest.fn(() => false);
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
  profileMode?: 'single-user-local' | 'shared-multi-user';
  storageType?: string | null;
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
      storageType: options.storageType ?? 'redis',
      profileMode: options.profileMode ?? 'shared-multi-user',
      error: null,
      errorKind: null,
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
  });

  it('shows the remote sync login branch when desktop profile sync is enabled', async () => {
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
    expect(screen.getByPlaceholderText('输入用户名')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入访问密码')).toBeInTheDocument();
    expect(mockRouter.replace).not.toHaveBeenCalled();
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

    expect(
      screen.queryByText('桌面版当前使用云端账号与用户数据同步。')
    ).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('输入用户名')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入访问密码')).toBeInTheDocument();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
