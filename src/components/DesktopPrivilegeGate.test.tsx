import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockGetAuthInfoFromBrowserCookie = jest.fn();
const mockGetDesktopAuthRequirement = jest.fn();
const mockLoginDesktopSession = jest.fn();
const mockGetRuntimeConfig = jest.fn();

jest.mock('@/lib/auth', () => ({
  BROWSER_AUTH_UPDATED_EVENT: 'lunatv:browser-auth-updated',
  getAuthInfoFromBrowserCookie: () => mockGetAuthInfoFromBrowserCookie(),
}));

jest.mock('@/lib/desktop/auth-session', () => ({
  getDesktopAuthRequirement: () => mockGetDesktopAuthRequirement(),
  loginDesktopSession: (...args: unknown[]) => mockLoginDesktopSession(...args),
}));

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: () => mockGetRuntimeConfig(),
}));

import DesktopPrivilegeGate from './DesktopPrivilegeGate';

describe('DesktopPrivilegeGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRuntimeConfig.mockReturnValue({
      APP_TARGET: 'desktop',
      PROFILE_SYNC_ENABLED: false,
    });
    mockGetAuthInfoFromBrowserCookie.mockReturnValue(null);
    mockGetDesktopAuthRequirement.mockResolvedValue({
      username: 'admin',
      passwordRequired: true,
      multiUser: false,
      ownerPasswordConfigured: true,
    });
  });

  it('asks a desktop guest to prove identity before rendering privileged content', async () => {
    render(
      <DesktopPrivilegeGate>
        <div>管理内容</div>
      </DesktopPrivilegeGate>
    );

    expect(await screen.findByText('验证管理员身份')).toBeInTheDocument();
    expect(screen.queryByText('管理内容')).not.toBeInTheDocument();
  });

  it('renders privileged content after a successful owner verification', async () => {
    mockLoginDesktopSession.mockResolvedValue({
      username: 'admin',
      role: 'owner',
    });

    render(
      <DesktopPrivilegeGate>
        <div>管理内容</div>
      </DesktopPrivilegeGate>
    );

    fireEvent.change(await screen.findByLabelText('密码'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '验证并进入' }));

    await waitFor(() => {
      expect(mockLoginDesktopSession).toHaveBeenCalledWith(undefined, 'secret');
    });
    expect(await screen.findByText('管理内容')).toBeInTheDocument();
  });

  it('rejects a verified non-admin desktop account', async () => {
    mockLoginDesktopSession.mockResolvedValue({
      username: 'kid',
      role: 'user',
    });

    render(
      <DesktopPrivilegeGate>
        <div>管理内容</div>
      </DesktopPrivilegeGate>
    );

    fireEvent.change(await screen.findByLabelText('密码'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '验证并进入' }));

    expect(
      await screen.findByText('当前账号没有管理员权限')
    ).toBeInTheDocument();
    expect(screen.queryByText('管理内容')).not.toBeInTheDocument();
  });
});
