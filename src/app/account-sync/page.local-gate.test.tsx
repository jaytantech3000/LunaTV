import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { getDesktopAdminCapability } from '@/lib/desktop/admin-capability';
import {
  getDesktopAuthRequirement,
  loginDesktopSession,
} from '@/lib/desktop/auth-session';
import { readDesktopProfileSyncStatusState } from '@/lib/desktop/profile-sync';
import {
  getDesktopAuthStatus,
  isDesktopTauriRuntimeAvailable,
} from '@/lib/desktop/tauri-client';
import { getRuntimeConfig } from '@/lib/runtime-config';

import AccountSyncPage from './page';

jest.mock('@/lib/auth', () => ({
  BROWSER_AUTH_UPDATED_EVENT: 'lunatv:browser-auth-updated',
  getAuthInfoFromBrowserCookie: jest.fn(),
  setAuthInfoInBrowser: jest.fn(),
}));

jest.mock('@/lib/desktop/admin-capability', () => ({
  getDesktopAdminCapability: jest.fn(),
}));

jest.mock('@/lib/desktop/auth-session', () => ({
  getDesktopAuthRequirement: jest.fn(),
  loginDesktopSession: jest.fn(),
}));

jest.mock('@/lib/desktop/profile-sync', () => ({
  readDesktopProfileSyncStatusState: jest.fn(),
  resolveDesktopProfileSyncState: jest.fn((status) =>
    status?.enabled ? 'connected' : 'disabled'
  ),
  executeDesktopProfileSyncOnboarding: jest.fn(),
  previewDesktopProfileSyncOnboarding: jest.fn(),
  syncDesktopProfileNow: jest.fn(),
}));

jest.mock('@/lib/desktop/tauri-client', () => ({
  getDesktopAuthStatus: jest.fn(),
  isDesktopTauriRuntimeAvailable: jest.fn(),
}));

jest.mock('@/lib/desktop/runtime-config', () => ({
  DESKTOP_RUNTIME_REFRESH_EVENT: 'lunatv:refresh-runtime-config',
  requestDesktopRuntimeRefresh: jest.fn(),
}));

jest.mock('@/lib/runtime-config', () => ({ getRuntimeConfig: jest.fn() }));

jest.mock('@/components/DesktopProfileSyncDiagnosticsGrid', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/DesktopProfileSyncScopeCard', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('AccountSyncPage local authorization gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getRuntimeConfig as jest.Mock).mockReturnValue({ APP_TARGET: 'desktop' });
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue(null);
    (isDesktopTauriRuntimeAvailable as jest.Mock).mockReturnValue(true);
    (getDesktopAuthStatus as jest.Mock).mockResolvedValue(null);
    (readDesktopProfileSyncStatusState as jest.Mock).mockResolvedValue({
      status: undefined,
      error: 'Failed to load profile sync status: 401',
    });
    (getDesktopAdminCapability as jest.Mock).mockReturnValue(false);
    (getDesktopAuthRequirement as jest.Mock).mockResolvedValue({
      multiUser: false,
    });
    (loginDesktopSession as jest.Mock).mockResolvedValue({ role: 'owner' });
  });

  it('requires local owner verification before showing Web credentials after a guest receives status 401', async () => {
    render(<AccountSyncPage />);

    await screen.findByText('无法读取');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '开启同步' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: '开启同步' }));

    expect(
      await screen.findByRole('heading', { name: '验证管理员身份' })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Web 用户名')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Web 密码')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'owner-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '验证并进入' }));

    await waitFor(() => {
      expect(loginDesktopSession).toHaveBeenCalledWith(
        undefined,
        'owner-secret'
      );
    });
    expect(await screen.findByLabelText('Web 用户名')).toBeInTheDocument();
    expect(screen.getByLabelText('Web 密码')).toBeInTheDocument();
  });
});
