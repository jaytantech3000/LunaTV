import { act, render, waitFor } from '@testing-library/react';

import { DESKTOP_RUNTIME_UPDATED_EVENT } from '@/lib/desktop/runtime-config';

const mockGetAuthInfoFromBrowserCookie = jest.fn();
const mockBuildLoginPath = jest.fn((redirectPath?: string) =>
  redirectPath
    ? `/login?redirect=${encodeURIComponent(redirectPath)}`
    : '/login'
);
const mockLoadDesktopProfileBootstrapState = jest.fn();
const mockGetRuntimeConfig = jest.fn();

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromBrowserCookie: () => mockGetAuthInfoFromBrowserCookie(),
}));

jest.mock('@/lib/desktop/auth-session', () => ({
  buildLoginPath: (redirectPath?: string) => mockBuildLoginPath(redirectPath),
}));

jest.mock('@/lib/desktop/profile-bootstrap', () => ({
  loadDesktopProfileBootstrapState: (...args: unknown[]) =>
    mockLoadDesktopProfileBootstrapState(...args),
}));

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: () => mockGetRuntimeConfig(),
}));

import DesktopRuntimeSync from './DesktopRuntimeSync';

function createBootstrapState(profileSyncEnabled = false) {
  return {
    payload: {
      appTarget: 'desktop',
      runtime: {
        siteName: 'LunaTV',
        profileSyncEnabled,
      },
      profileSync: {
        enabled: profileSyncEnabled,
        reachable: true,
        authenticated: false,
        username: null,
        role: null,
        storageType: profileSyncEnabled ? 'redis' : 'localstorage',
        profileMode: profileSyncEnabled
          ? 'shared-multi-user'
          : 'single-user-local',
        error: null,
        errorKind: null,
        syncDomains: [],
      },
      localAuth: {
        username: 'owner',
        passwordRequired: true,
        multiUser: false,
        ownerPasswordConfigured: true,
      },
    },
    localAuth: {
      username: 'owner',
      passwordRequired: true,
      multiUser: false,
      ownerPasswordConfigured: true,
    },
  };
}

describe('DesktopRuntimeSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetRuntimeConfig.mockReturnValue({
      APP_TARGET: 'desktop',
    });
    mockGetAuthInfoFromBrowserCookie.mockReturnValue({
      username: 'owner',
      role: 'owner',
      sessionMode: 'desktop-local',
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('refreshes desktop runtime through the shared bootstrap loader and emits an update event', async () => {
    const updatedHandler = jest.fn();
    window.addEventListener(DESKTOP_RUNTIME_UPDATED_EVENT, updatedHandler);
    mockLoadDesktopProfileBootstrapState.mockResolvedValue(
      createBootstrapState()
    );

    render(<DesktopRuntimeSync />);

    await waitFor(() => {
      expect(mockLoadDesktopProfileBootstrapState).toHaveBeenCalledTimes(1);
    });
    expect(updatedHandler).toHaveBeenCalledTimes(1);

    window.removeEventListener(DESKTOP_RUNTIME_UPDATED_EVENT, updatedHandler);
  });

  it('retries the shared bootstrap loader after a refresh failure', async () => {
    const updatedHandler = jest.fn();
    window.addEventListener(DESKTOP_RUNTIME_UPDATED_EVENT, updatedHandler);
    mockLoadDesktopProfileBootstrapState
      .mockRejectedValueOnce(new Error('bootstrap unavailable'))
      .mockResolvedValueOnce(createBootstrapState());

    render(<DesktopRuntimeSync />);

    await waitFor(() => {
      expect(mockLoadDesktopProfileBootstrapState).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await Promise.resolve();
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockLoadDesktopProfileBootstrapState).toHaveBeenCalledTimes(2);
    });
    expect(updatedHandler).toHaveBeenCalledTimes(1);

    window.removeEventListener(DESKTOP_RUNTIME_UPDATED_EVENT, updatedHandler);
  });
});
