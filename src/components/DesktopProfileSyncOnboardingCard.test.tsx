import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { setAuthInfoInBrowser } from '@/lib/auth';
import {
  executeDesktopProfileSyncOnboarding,
  previewDesktopProfileSyncOnboarding,
  syncDesktopProfileNow,
} from '@/lib/desktop/profile-sync';
import { requestDesktopRuntimeRefresh } from '@/lib/desktop/runtime-config';
import { armDesktopDownloadOwnershipHandoff } from '@/lib/download/session';

import DesktopProfileSyncOnboardingCard from './DesktopProfileSyncOnboardingCard';

jest.mock('@/lib/desktop/profile-sync', () => ({
  executeDesktopProfileSyncOnboarding: jest.fn(),
  previewDesktopProfileSyncOnboarding: jest.fn(),
  syncDesktopProfileNow: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  setAuthInfoInBrowser: jest.fn(),
}));

jest.mock('@/lib/desktop/runtime-config', () => ({
  requestDesktopRuntimeRefresh: jest.fn(),
}));

jest.mock('@/lib/download/session', () => ({
  armDesktopDownloadOwnershipHandoff: jest.fn(),
}));

describe('DesktopProfileSyncOnboardingCard', () => {
  const mockPreviewDesktopProfileSyncOnboarding = jest.mocked(
    previewDesktopProfileSyncOnboarding
  );
  const mockExecuteDesktopProfileSyncOnboarding = jest.mocked(
    executeDesktopProfileSyncOnboarding
  );
  const mockSyncDesktopProfileNow = jest.mocked(syncDesktopProfileNow);
  const mockArmDesktopDownloadOwnershipHandoff = jest.mocked(
    armDesktopDownloadOwnershipHandoff
  );
  const mockSetAuthInfoInBrowser = jest.mocked(setAuthInfoInBrowser);
  const mockRequestDesktopRuntimeRefresh = jest.mocked(
    requestDesktopRuntimeRefresh
  );
  const mockClipboardWriteText = jest.fn<Promise<void>, [string]>();

  beforeEach(() => {
    jest.clearAllMocks();
    mockClipboardWriteText.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mockClipboardWriteText,
      },
    });
  });

  it('opens the onboarding dialog and renders the preview guidance', async () => {
    mockPreviewDesktopProfileSyncOnboarding.mockResolvedValue({
      remoteBaseUrl: 'https://luna.hkcu.qzz.io',
      currentRemoteUsername: 'remote-owner',
      currentRemoteRole: 'owner',
      plan: {
        currentLocalUsername: 'local-owner',
        currentRemoteUsername: 'remote-owner',
        items: [
          {
            localUsername: 'local-owner',
            remoteUsername: 'remote-owner',
            requiresAccountCreation: false,
            summary: {
              username: 'local-owner',
              playRecordCount: 3,
              favoriteCount: 1,
              followCount: 2,
              searchHistoryCount: 4,
              skipConfigCount: 1,
            },
          },
          {
            localUsername: 'beta',
            remoteUsername: 'beta',
            requiresAccountCreation: true,
            summary: {
              username: 'beta',
              playRecordCount: 1,
              favoriteCount: 0,
              followCount: 0,
              searchHistoryCount: 0,
              skipConfigCount: 0,
            },
          },
        ],
      },
      downloadPreview: {
        hasDownloads: true,
        currentOwnerUsername: 'local-owner',
        targetUsername: 'remote-owner',
        taskCount: 2,
        libraryCount: 1,
      },
      warnings: [
        '仅当前仍保留的这套离线下载可以迁移，之前已清理的旧归属无法恢复。',
        '如果继续执行时需要自动创建 Web 帐号，会生成初始密码 123456。完成后请立即登录修改。',
      ],
    });

    render(
      <DesktopProfileSyncOnboardingCard
        currentLocalUsername='local-owner'
        profileSyncEnabled={false}
        selectedSyncDomains={['playrecords', 'favorites']}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '开启同步' }));

    expect(screen.getByLabelText('Web 服务地址')).toHaveValue(
      'https://luna.hkcu.qzz.io'
    );

    fireEvent.change(screen.getByLabelText('Web 用户名'), {
      target: { value: 'remote-owner' },
    });
    fireEvent.change(screen.getByLabelText('Web 密码'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成迁移预览' }));

    await waitFor(() => {
      expect(mockPreviewDesktopProfileSyncOnboarding).toHaveBeenCalledWith({
        remoteBaseUrl: 'https://luna.hkcu.qzz.io',
        username: 'remote-owner',
        password: 'secret',
        currentLocalUsername: 'local-owner',
      });
    });

    expect(
      await screen.findByText('local-owner -> remote-owner')
    ).toBeInTheDocument();
    expect(screen.getByText('beta -> beta')).toBeInTheDocument();
    expect(screen.getByText('将自动创建')).toBeInTheDocument();
    expect(
      screen.getByText('离线下载将重绑到 remote-owner（2 个任务 / 1 个条目）')
    ).toBeInTheDocument();
    expect(screen.getByText('开始前请确认')).toBeInTheDocument();
  });

  it('lets a desktop guest submit Web credentials without a browser local username', async () => {
    mockPreviewDesktopProfileSyncOnboarding.mockResolvedValue({
      remoteBaseUrl: 'https://luna.hkcu.qzz.io',
      currentRemoteUsername: 'remote-owner',
      currentRemoteRole: 'owner',
      plan: {
        currentLocalUsername: 'admin',
        currentRemoteUsername: 'remote-owner',
        items: [],
      },
      downloadPreview: {
        hasDownloads: false,
        currentOwnerUsername: null,
        targetUsername: null,
        taskCount: 0,
        libraryCount: 0,
      },
      warnings: [],
    });

    render(
      <DesktopProfileSyncOnboardingCard
        profileSyncEnabled={false}
        selectedSyncDomains={['favorites']}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '开启同步' }));
    fireEvent.change(screen.getByLabelText('Web 用户名'), {
      target: { value: 'remote-owner' },
    });
    fireEvent.change(screen.getByLabelText('Web 密码'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成迁移预览' }));

    await waitFor(() => {
      expect(mockPreviewDesktopProfileSyncOnboarding).toHaveBeenCalledWith({
        remoteBaseUrl: 'https://luna.hkcu.qzz.io',
        username: 'remote-owner',
        password: 'secret',
        currentLocalUsername: 'admin',
      });
    });
  });

  it('executes onboarding with the selected sync domains and surfaces the success dialog', async () => {
    mockPreviewDesktopProfileSyncOnboarding.mockResolvedValue({
      remoteBaseUrl: 'https://luna.hkcu.qzz.io',
      currentRemoteUsername: 'remote-owner',
      currentRemoteRole: 'owner',
      plan: {
        currentLocalUsername: 'local-owner',
        currentRemoteUsername: 'remote-owner',
        items: [
          {
            localUsername: 'local-owner',
            remoteUsername: 'remote-owner',
            requiresAccountCreation: false,
            summary: {
              username: 'local-owner',
              playRecordCount: 3,
              favoriteCount: 1,
              followCount: 2,
              searchHistoryCount: 4,
              skipConfigCount: 1,
            },
          },
        ],
      },
      downloadPreview: {
        hasDownloads: true,
        currentOwnerUsername: 'local-owner',
        targetUsername: 'remote-owner',
        taskCount: 2,
        libraryCount: 1,
      },
      warnings: [],
    });
    mockExecuteDesktopProfileSyncOnboarding.mockResolvedValue({
      remoteBaseUrl: 'https://luna.hkcu.qzz.io',
      currentRemoteUsername: 'remote-owner',
      currentRemoteRole: 'owner',
      createdAccounts: [
        {
          username: 'beta',
          initialPassword: '123456',
        },
      ],
      migratedAccounts: [
        {
          localUsername: 'local-owner',
          remoteUsername: 'remote-owner',
          localSummary: {
            username: 'local-owner',
            playRecordCount: 3,
            favoriteCount: 1,
            followCount: 2,
            searchHistoryCount: 4,
            skipConfigCount: 1,
          },
          mergedSummary: {
            playRecordCount: 0,
            favoriteCount: 1,
            followCount: 0,
            searchHistoryCount: 0,
            skipConfigCount: 0,
          },
        },
      ],
      downloadRebind: {
        didRebind: true,
        previousOwnerUsername: 'local-owner',
        nextOwnerUsername: 'remote-owner',
        taskCount: 2,
        libraryCount: 1,
        resourceIndexCount: 2,
      },
      warnings: [
        '仅当前仍保留的这套离线下载可以迁移，之前已清理的旧归属无法恢复。',
        '如果本次自动创建了 Web 帐号，请登录后立即修改初始密码。',
      ],
    });

    const { rerender } = render(
      <DesktopProfileSyncOnboardingCard
        currentLocalUsername='local-owner'
        profileSyncEnabled={false}
        selectedSyncDomains={['favorites']}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '开启同步' }));
    fireEvent.change(screen.getByLabelText('Web 用户名'), {
      target: { value: 'remote-owner' },
    });
    fireEvent.change(screen.getByLabelText('Web 密码'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成迁移预览' }));

    await screen.findByText('local-owner -> remote-owner');

    fireEvent.click(screen.getByRole('button', { name: '开始开启同步' }));
    expect(
      screen.getByRole('heading', { name: '选择同步优先级' })
    ).toBeInTheDocument();
    expect(mockExecuteDesktopProfileSyncOnboarding).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('本地为主'));
    fireEvent.click(screen.getByRole('button', { name: '确认并开启同步' }));

    await waitFor(() => {
      expect(mockExecuteDesktopProfileSyncOnboarding).toHaveBeenCalledWith({
        remoteBaseUrl: 'https://luna.hkcu.qzz.io',
        username: 'remote-owner',
        password: 'secret',
        currentLocalUsername: 'local-owner',
        strategy: 'local-first',
        syncDomains: ['favorites'],
      });
    });

    expect(mockArmDesktopDownloadOwnershipHandoff).toHaveBeenCalledWith({
      previousOwnerUsername: 'local-owner',
      nextOwnerUsername: 'remote-owner',
    });
    expect(mockSetAuthInfoInBrowser).toHaveBeenCalledWith({
      username: 'remote-owner',
      role: 'owner',
      password: 'secret',
      sessionMode: 'desktop-profile-sync',
    });
    expect(mockRequestDesktopRuntimeRefresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('已切换到 Web 帐号')).toBeInTheDocument();
    expect(screen.getByText('本次自动创建的帐号')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.getByText('初始密码：123456')).toBeInTheDocument();
    expect(
      screen.getByText('同步已开启，正在同步到当前页面。')
    ).toBeInTheDocument();

    jest.useFakeTimers();
    try {
      await act(async () => {
        rerender(
          <DesktopProfileSyncOnboardingCard
            currentLocalUsername='local-owner'
            profileSyncEnabled={true}
            selectedSyncDomains={['favorites']}
          />
        );
        await Promise.resolve();
      });

      expect(screen.getByText('桌面状态已刷新完成。')).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(1500);
      });

      expect(
        screen.queryByText('桌面状态已刷新完成。')
      ).not.toBeInTheDocument();
    } finally {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    }
  });

  it('asks for strategy before sync-now when enabled', async () => {
    mockSyncDesktopProfileNow.mockResolvedValue({
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
      lastSyncError: null,
    });

    render(
      <DesktopProfileSyncOnboardingCard
        currentLocalUsername='local-owner'
        profileSyncEnabled
        selectedSyncDomains={['playrecords']}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '同步' }));
    expect(
      screen.getByRole('heading', { name: '选择同步优先级' })
    ).toBeInTheDocument();
    expect(mockSyncDesktopProfileNow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('云端为主'));
    fireEvent.click(screen.getByRole('button', { name: '确认并同步' }));

    await waitFor(() => {
      expect(mockSyncDesktopProfileNow).toHaveBeenCalledWith({
        syncDomains: ['playrecords'],
        strategy: 'web-first',
      });
    });

    expect(mockRequestDesktopRuntimeRefresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('同步成功')).toBeInTheDocument();
  });

  it('opens the existing onboarding form for an unauthenticated remote sync session instead of sending sync-now', () => {
    render(
      <DesktopProfileSyncOnboardingCard
        currentLocalUsername='local-owner'
        profileSyncEnabled
        requiresRemoteLogin
        selectedSyncDomains={['playrecords']}
      />
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '登录并同步' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('登录 Web 帐号并同步');
    expect(screen.getByLabelText('Web 用户名')).toBeInTheDocument();
    expect(screen.getByLabelText('Web 密码')).toBeInTheDocument();
    expect(mockSyncDesktopProfileNow).not.toHaveBeenCalled();
  });

  it('defers opening Web credentials until the local administrator authorization callback succeeds', () => {
    const requestAuthorization = jest.fn();
    render(
      <DesktopProfileSyncOnboardingCard
        currentLocalUsername='guest'
        profileSyncEnabled={false}
        onRequestAuthorization={requestAuthorization}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '开启同步' }));

    expect(requestAuthorization).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockPreviewDesktopProfileSyncOnboarding).not.toHaveBeenCalled();
  });

  it('renders a compact warning strip when sync is enabled but still needs attention', () => {
    render(
      <DesktopProfileSyncOnboardingCard
        currentLocalUsername='local-owner'
        profileSyncEnabled
      />
    );

    expect(screen.getByText('已开启帐号同步')).toBeInTheDocument();
    expect(screen.getByText('当前使用 Web 帐号')).toBeInTheDocument();
  });

  it('copies the titled error message from the modal error panel', async () => {
    mockClipboardWriteText.mockResolvedValue(undefined);
    mockPreviewDesktopProfileSyncOnboarding.mockRejectedValue(
      new Error('Web 端同步接口返回 500')
    );

    render(
      <DesktopProfileSyncOnboardingCard
        currentLocalUsername='local-owner'
        profileSyncEnabled={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '开启同步' }));
    fireEvent.change(screen.getByLabelText('Web 用户名'), {
      target: { value: 'remote-owner' },
    });
    fireEvent.change(screen.getByLabelText('Web 密码'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成迁移预览' }));

    expect(
      await screen.findByText('Web 端同步接口返回 500')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '复制错误信息' }));

    await waitFor(() => {
      expect(mockClipboardWriteText).toHaveBeenCalledWith(
        '错误信息\nWeb 端同步接口返回 500'
      );
    });

    expect(
      await screen.findByRole('button', { name: '已复制错误信息' })
    ).toBeInTheDocument();
  });
});
