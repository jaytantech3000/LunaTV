import { act, render, waitFor } from '@testing-library/react';

import { DESKTOP_RUNTIME_UPDATED_EVENT } from '@/lib/desktop/runtime-config';

const mockLoadDesktopProfileBootstrapState = jest.fn();
const mockGetRuntimeConfig = jest.fn();

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
    expect(mockLoadDesktopProfileBootstrapState).toHaveBeenCalledWith({
      preferCachedPayload: true,
    });
    expect(updatedHandler).toHaveBeenCalledTimes(1);

    window.removeEventListener(DESKTOP_RUNTIME_UPDATED_EVENT, updatedHandler);
  });

  it('keeps unauthenticated desktop visitors on public pages after bootstrap', async () => {
    const updatedHandler = jest.fn();
    window.addEventListener(DESKTOP_RUNTIME_UPDATED_EVENT, updatedHandler);
    mockLoadDesktopProfileBootstrapState.mockResolvedValue(
      createBootstrapState(true)
    );

    render(<DesktopRuntimeSync />);

    await waitFor(() => {
      expect(mockLoadDesktopProfileBootstrapState).toHaveBeenCalledTimes(1);
    });
    expect(updatedHandler).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).not.toBe('/login');

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
    expect(mockLoadDesktopProfileBootstrapState).toHaveBeenNthCalledWith(1, {
      preferCachedPayload: true,
    });
    expect(mockLoadDesktopProfileBootstrapState).toHaveBeenNthCalledWith(2, {
      preferCachedPayload: true,
    });
    expect(updatedHandler).toHaveBeenCalledTimes(1);

    window.removeEventListener(DESKTOP_RUNTIME_UPDATED_EVENT, updatedHandler);
  });

  it('bypasses the cached bootstrap payload on explicit refresh events', async () => {
    mockLoadDesktopProfileBootstrapState.mockResolvedValue(
      createBootstrapState()
    );

    render(<DesktopRuntimeSync />);

    await waitFor(() => {
      expect(mockLoadDesktopProfileBootstrapState).toHaveBeenCalledTimes(1);
    });

    mockLoadDesktopProfileBootstrapState.mockClear();
    window.dispatchEvent(new Event('lunatv:refresh-runtime-config'));

    await waitFor(() => {
      expect(mockLoadDesktopProfileBootstrapState).toHaveBeenCalledTimes(1);
    });
    expect(mockLoadDesktopProfileBootstrapState).toHaveBeenCalledWith();
  });
});
