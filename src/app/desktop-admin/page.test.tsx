import { act, render, screen, waitFor } from '@testing-library/react';

import {
  BROWSER_AUTH_UPDATED_EVENT,
  getAuthInfoFromBrowserCookie,
} from '@/lib/auth';
import { readDesktopProfileSyncStatusState } from '@/lib/desktop/profile-sync';
import {
  getDesktopAuthStatus,
  getLocalServiceStatus,
  isDesktopTauriRuntimeAvailable,
} from '@/lib/desktop/tauri-client';
import { getRuntimeConfig } from '@/lib/runtime-config';

import DesktopAdminPage from './page';

const mockOnboardingCard = jest.fn(
  ({
    currentLocalUsername,
    profileSyncEnabled,
  }: {
    currentLocalUsername?: string | null;
    profileSyncEnabled: boolean;
  }) => (
    <div data-testid='onboarding-card'>
      {`${currentLocalUsername ?? 'null'}|${String(profileSyncEnabled)}`}
    </div>
  )
);

jest.mock('@/lib/auth', () => ({
  BROWSER_AUTH_UPDATED_EVENT: 'lunatv:browser-auth-updated',
  getAuthInfoFromBrowserCookie: jest.fn(),
}));

jest.mock('@/lib/desktop/profile-sync', () => ({
  readDesktopProfileSyncStatusState: jest.fn(),
}));

jest.mock('@/lib/desktop/profile-sync-status-copy', () => ({
  buildDesktopProfileSyncStatusDetail: jest.fn(() => 'detail'),
  buildDesktopProfileSyncStatusValue: jest.fn(() => 'value'),
}));

jest.mock('@/lib/desktop/tauri-client', () => ({
  getDesktopAuthStatus: jest.fn(),
  getLocalServiceStatus: jest.fn(),
  isDesktopTauriRuntimeAvailable: jest.fn(),
}));

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: jest.fn(),
}));

jest.mock('@/components/DesktopProfileSyncDiagnosticsGrid', () => () => (
  <div data-testid='diagnostics-grid' />
));

jest.mock('@/components/DesktopProfileSyncOnboardingCard', () => ({
  __esModule: true,
  default: (props: {
    currentLocalUsername?: string | null;
    profileSyncEnabled: boolean;
  }) => mockOnboardingCard(props),
}));

jest.mock('@/components/DesktopSettingsSection', () => ({
  __esModule: true,
  default: () => <div data-testid='desktop-settings-section' />,
}));

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='page-layout'>{children}</div>
  ),
}));

describe('DesktopAdminPage', () => {
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
    (getLocalServiceStatus as jest.Mock).mockResolvedValue({
      running: true,
      port: 8787,
      baseUrl: 'http://127.0.0.1:8787',
      configPath: '/tmp/config.json',
      dataDir: '/tmp/data',
      sqlitePath: '/tmp/moontv.sqlite3',
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

  it('wires the onboarding card into desktop-admin with the current local username', async () => {
    render(<DesktopAdminPage />);

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-card')).toHaveTextContent(
        'local-owner|false'
      );
    });
    expect(screen.getByTestId('desktop-settings-section')).toBeInTheDocument();
    expect(screen.getByTestId('diagnostics-grid')).toBeInTheDocument();
  });

  it('falls back to the desktop auth username and refreshes on browser auth events', async () => {
    (getAuthInfoFromBrowserCookie as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValue({
        username: 'remote-owner',
        role: 'owner',
      });
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
        syncDomains: ['playrecords'],
      },
      error: '',
    });

    render(<DesktopAdminPage />);

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-card')).toHaveTextContent(
        'local-owner|true'
      );
    });

    act(() => {
      window.dispatchEvent(new Event(BROWSER_AUTH_UPDATED_EVENT));
    });

    await waitFor(() => {
      expect(readDesktopProfileSyncStatusState).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('onboarding-card')).toHaveTextContent(
        'remote-owner|true'
      );
    });
  });

  it('hides the onboarding flow outside desktop runtime', async () => {
    (getRuntimeConfig as jest.Mock).mockReturnValue({
      APP_TARGET: 'web',
    });

    render(<DesktopAdminPage />);

    expect(
      await screen.findByText(
        '当前不是桌面运行时。桌面管理面板只在 Tauri 桌面壳内可用。'
      )
    ).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-card')).not.toBeInTheDocument();
  });
});
