import { act, render, screen, waitFor } from '@testing-library/react';

import {
  BROWSER_AUTH_UPDATED_EVENT,
  getAuthInfoFromBrowserCookie,
} from '@/lib/auth';
import { readDesktopProfileSyncStatusState } from '@/lib/desktop/profile-sync';
import { DESKTOP_RUNTIME_REFRESH_EVENT } from '@/lib/desktop/runtime-config';
import {
  getDesktopAuthStatus,
  isDesktopTauriRuntimeAvailable,
} from '@/lib/desktop/tauri-client';
import { getRuntimeConfig } from '@/lib/runtime-config';

import AccountSyncPage from './page';

const mockOnboardingCard = jest.fn(
  ({
    currentLocalUsername,
    profileSyncEnabled,
    selectedSyncDomains,
    isSyncUnavailable,
    requiresRemoteLogin,
  }: {
    currentLocalUsername?: string | null;
    profileSyncEnabled: boolean;
    selectedSyncDomains?: readonly string[];
    isSyncUnavailable?: boolean;
    requiresRemoteLogin?: boolean;
  }) => (
    <div data-testid='onboarding-card'>
      <div>开启帐号同步</div>
      {`${currentLocalUsername ?? 'null'}|${String(profileSyncEnabled)}|${
        selectedSyncDomains?.join(',') ?? ''
      }|${String(isSyncUnavailable ?? false)}|${String(
        requiresRemoteLogin ?? false
      )}`}
    </div>
  )
);

const mockScopeCard = jest.fn(
  ({
    selectedDomains,
    isAdminRole,
    disabled,
  }: {
    selectedDomains: readonly string[];
    isAdminRole: boolean;
    disabled?: boolean;
  }) => (
    <div data-testid='scope-card'>
      <div>管理同步范围</div>
      {`${selectedDomains.join(',')}|${String(isAdminRole)}|${String(
        disabled ?? false
      )}`}
    </div>
  )
);

jest.mock('@/lib/auth', () => ({
  BROWSER_AUTH_UPDATED_EVENT: 'lunatv:browser-auth-updated',
  getAuthInfoFromBrowserCookie: jest.fn(),
}));

jest.mock('@/lib/desktop/profile-sync', () => ({
  readDesktopProfileSyncStatusState: jest.fn(),
  resolveDesktopProfileSyncState: jest.fn((status) => {
    if (!status?.enabled) {
      return 'disabled';
    }

    if (!status.reachable) {
      return 'offline';
    }

    if (status.errorKind === 'unauthorized') {
      return 'auth-expired';
    }

    if (status.errorKind) {
      return 'degraded';
    }

    return status.authenticated ? 'ready' : 'connected';
  }),
}));

jest.mock('@/lib/desktop/tauri-client', () => ({
  getDesktopAuthStatus: jest.fn(),
  isDesktopTauriRuntimeAvailable: jest.fn(),
}));

jest.mock('@/lib/desktop/runtime-config', () => ({
  DESKTOP_RUNTIME_REFRESH_EVENT: 'lunatv:refresh-runtime-config',
}));

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: jest.fn(),
}));

jest.mock('@/components/DesktopProfileSyncDiagnosticsGrid', () => ({
  __esModule: true,
  default: () => <div data-testid='sync-diagnostics'>同步队列诊断</div>,
}));

jest.mock('@/components/DesktopProfileSyncOnboardingCard', () => ({
  __esModule: true,
  default: (props: {
    currentLocalUsername?: string | null;
    profileSyncEnabled: boolean;
    selectedSyncDomains?: readonly string[];
    isSyncUnavailable?: boolean;
    requiresRemoteLogin?: boolean;
  }) => mockOnboardingCard(props),
}));

jest.mock('@/components/DesktopProfileSyncScopeCard', () => ({
  __esModule: true,
  default: (props: {
    selectedDomains: readonly string[];
    isAdminRole: boolean;
    disabled?: boolean;
  }) => mockScopeCard(props),
}));

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='page-layout'>{children}</div>
  ),
}));

describe('AccountSyncPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getRuntimeConfig as jest.Mock).mockReturnValue({
      APP_TARGET: 'desktop',
    });
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue({
      username: 'local-owner',
      role: 'owner',
    });
    (isDesktopTauriRuntimeAvailable as jest.Mock).mockReturnValue(true);
    (getDesktopAuthStatus as jest.Mock).mockResolvedValue({
      username: 'local-owner',
      passwordRequired: true,
      multiUser: false,
      ownerPasswordConfigured: true,
    });
    (readDesktopProfileSyncStatusState as jest.Mock).mockResolvedValue({
      status: {
        enabled: false,
        reachable: false,
        authenticated: false,
        username: null,
        role: null,
        storageType: null,
        profileMode: null,
        error: null,
        errorKind: 'not-configured',
        syncDomains: null,
      },
      error: '',
    });
  });

  it('renders the minimal account sync layout without helper copy or diagnostics', async () => {
    render(<AccountSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-card')).toHaveTextContent(
        'local-owner|false|playrecords,favorites,follows,searchhistory,skipconfigs|false'
      );
    });

    expect(
      screen.getByRole('heading', { level: 1, name: '帐号同步' })
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/这里只保留帐号同步状态、开通和诊断/)
    ).not.toBeInTheDocument();
    expect(screen.getByText('同步状态摘要')).toBeInTheDocument();
    expect(screen.getByText('开启帐号同步')).toBeInTheDocument();
    expect(screen.getByText('管理同步范围')).toBeInTheDocument();
    expect(screen.getByText('本地保存与后台同步')).toBeInTheDocument();
    expect(screen.getByTestId('sync-diagnostics')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /诊断详情/ })
    ).not.toBeInTheDocument();
  });

  it('passes admin-selected domains through to the scope card', async () => {
    (readDesktopProfileSyncStatusState as jest.Mock).mockResolvedValue({
      status: {
        enabled: true,
        reachable: true,
        authenticated: true,
        username: 'remote-owner',
        role: 'owner',
        storageType: 'redis',
        profileMode: 'shared-multi-user',
        error: null,
        errorKind: null,
        syncDomains: ['playrecords', 'adminsettings'],
      },
      error: '',
    });

    render(<AccountSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('scope-card')).toHaveTextContent(
        'playrecords,adminsettings|true|false'
      );
    });
    expect(screen.getByTestId('onboarding-card')).toHaveTextContent(
      'local-owner|true|playrecords,adminsettings|false'
    );
  });

  it('removes adminsettings when the current role is not admin', async () => {
    (readDesktopProfileSyncStatusState as jest.Mock).mockResolvedValue({
      status: {
        enabled: true,
        reachable: true,
        authenticated: true,
        username: 'kid',
        role: 'user',
        storageType: 'redis',
        profileMode: 'shared-multi-user',
        error: null,
        errorKind: null,
        syncDomains: ['playrecords', 'adminsettings'],
      },
      error: '',
    });

    render(<AccountSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('scope-card')).toHaveTextContent(
        'playrecords|false|false'
      );
    });
  });

  it('keeps the desktop account-sync page usable for a guest and defers remote login until an action', async () => {
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue(null);
    (getDesktopAuthStatus as jest.Mock).mockRejectedValue(
      new Error('本地认证状态不可用')
    );
    (readDesktopProfileSyncStatusState as jest.Mock).mockResolvedValue({
      status: {
        enabled: true,
        reachable: true,
        authenticated: false,
        username: null,
        role: null,
        storageType: 'redis',
        profileMode: 'shared-multi-user',
        error: null,
        errorKind: null,
        syncDomains: null,
      },
      error: '',
    });

    render(<AccountSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-card')).toHaveTextContent(
        'null|true|playrecords,favorites,follows,searchhistory,skipconfigs|false|true'
      );
    });

    expect(screen.getByText('需要处理')).toBeInTheDocument();
    expect(screen.getByText('帐号：')).toHaveTextContent('帐号：未登录');
    expect(screen.getByText('开启帐号同步')).toBeInTheDocument();
    expect(screen.getByTestId('scope-card')).toHaveTextContent(
      'playrecords,favorites,follows,searchhistory,skipconfigs|false|false'
    );
  });

  it('refreshes the page state on browser auth and runtime refresh events', async () => {
    (getAuthInfoFromBrowserCookie as jest.Mock)
      .mockReturnValueOnce({ username: 'local-owner', role: 'owner' })
      .mockReturnValueOnce({ username: 'local-owner', role: 'owner' })
      .mockReturnValueOnce({ username: 'remote-owner', role: 'owner' })
      .mockReturnValue({ username: 'remote-owner', role: 'owner' });
    (readDesktopProfileSyncStatusState as jest.Mock)
      .mockResolvedValueOnce({
        status: {
          enabled: false,
          reachable: false,
          authenticated: false,
          username: null,
          role: null,
          storageType: null,
          profileMode: null,
          error: null,
          errorKind: 'not-configured',
          syncDomains: null,
        },
        error: '',
      })
      .mockResolvedValue({
        status: {
          enabled: true,
          reachable: true,
          authenticated: true,
          username: 'remote-owner',
          role: 'owner',
          storageType: 'redis',
          profileMode: 'shared-multi-user',
          error: null,
          errorKind: null,
          syncDomains: ['favorites'],
        },
        error: '',
      });

    render(<AccountSyncPage />);

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-card')).toHaveTextContent(
        'local-owner|false|playrecords,favorites,follows,searchhistory,skipconfigs|false'
      );
    });

    act(() => {
      window.dispatchEvent(new Event(BROWSER_AUTH_UPDATED_EVENT));
      window.dispatchEvent(new Event(DESKTOP_RUNTIME_REFRESH_EVENT));
    });

    await waitFor(() => {
      expect(readDesktopProfileSyncStatusState).toHaveBeenCalledTimes(3);
      expect(screen.getByTestId('onboarding-card')).toHaveTextContent(
        'remote-owner|true|favorites|false'
      );
    });
  });

  it('shows a desktop-only warning outside desktop runtime', async () => {
    (getRuntimeConfig as jest.Mock).mockReturnValue({
      APP_TARGET: 'web',
    });

    render(<AccountSyncPage />);

    expect(
      await screen.findByText(
        '当前不是桌面运行时。帐号同步页只在 Tauri 桌面壳内可用。'
      )
    ).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scope-card')).not.toBeInTheDocument();
  });
});
