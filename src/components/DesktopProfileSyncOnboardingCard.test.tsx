import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import {
  executeDesktopProfileSyncOnboarding,
  previewDesktopProfileSyncOnboarding,
} from '@/lib/desktop/profile-sync';
import { requestDesktopRuntimeRefresh } from '@/lib/desktop/runtime-config';
import { armDesktopDownloadOwnershipHandoff } from '@/lib/download/session';

import DesktopProfileSyncOnboardingCard from './DesktopProfileSyncOnboardingCard';

jest.mock('@/lib/desktop/profile-sync', () => ({
  executeDesktopProfileSyncOnboarding: jest.fn(),
  previewDesktopProfileSyncOnboarding: jest.fn(),
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
  const mockArmDesktopDownloadOwnershipHandoff = jest.mocked(
    armDesktopDownloadOwnershipHandoff
  );
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

  it('shows the production default address and renders the preview guidance', async () => {
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
      />
    );

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
    expect(
      screen.getByText(
        '仅当前仍保留的这套离线下载可以迁移，之前已清理的旧归属无法恢复。'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '如果继续执行时需要自动创建 Web 帐号，会生成初始密码 123456。完成后请立即登录修改。'
      )
    ).toBeInTheDocument();
  });

  it('executes onboarding, arms download handoff, and surfaces the migration result summary', async () => {
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
            playRecordCount: 3,
            favoriteCount: 1,
            followCount: 2,
            searchHistoryCount: 4,
            skipConfigCount: 1,
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
      />
    );

    fireEvent.change(screen.getByLabelText('Web 用户名'), {
      target: { value: 'remote-owner' },
    });
    fireEvent.change(screen.getByLabelText('Web 密码'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成迁移预览' }));

    await screen.findByText('local-owner -> remote-owner');

    fireEvent.click(screen.getByRole('button', { name: '开始开启同步' }));

    await waitFor(() => {
      expect(mockExecuteDesktopProfileSyncOnboarding).toHaveBeenCalledWith({
        remoteBaseUrl: 'https://luna.hkcu.qzz.io',
        username: 'remote-owner',
        password: 'secret',
        currentLocalUsername: 'local-owner',
        strategy: 'web-first',
      });
    });

    expect(mockArmDesktopDownloadOwnershipHandoff).toHaveBeenCalledWith({
      previousOwnerUsername: 'local-owner',
      nextOwnerUsername: 'remote-owner',
    });
    expect(mockRequestDesktopRuntimeRefresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('已切换到 Web 帐号')).toBeInTheDocument();
    expect(
      screen.getByText(
        '桌面端已开始使用 Web 帐号 remote-owner，离线下载归属也已按本次结果更新。'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('当前使用的 Web 帐号')).toBeInTheDocument();
    expect(screen.getByText('本次自动创建的帐号')).toBeInTheDocument();
    expect(
      screen.getByText('已自动创建 1 个 Web 帐号，请尽快修改初始密码。')
    ).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.getByText('初始密码：123456')).toBeInTheDocument();
    expect(screen.getByText('接下来建议')).toBeInTheDocument();
    expect(
      screen.getByText(
        '仅当前仍保留的这套离线下载可以迁移，之前已清理的旧归属无法恢复。'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '如果本次自动创建了 Web 帐号，请登录后立即修改初始密码。'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('同步已开启，正在同步到当前页面。')
    ).toBeInTheDocument();
    expect(screen.getByText('1/3 已提交同步结果')).toBeInTheDocument();
    expect(screen.getByText('2/3 正在刷新桌面运行时状态')).toBeInTheDocument();
    expect(screen.getByText('3/3 等待当前页面更新')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '67'
    );

    jest.useFakeTimers();
    try {
      await act(async () => {
        rerender(
          <DesktopProfileSyncOnboardingCard
            currentLocalUsername='local-owner'
            profileSyncEnabled={true}
          />
        );
        await Promise.resolve();
      });

      expect(screen.getByText('桌面状态已刷新完成。')).toBeInTheDocument();
      expect(screen.getByText('2/3 已刷新桌面运行时状态')).toBeInTheDocument();
      expect(screen.getByText('3/3 当前页面已更新')).toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '100'
      );

      act(() => {
        jest.advanceTimersByTime(1499);
      });
      expect(screen.getByText('桌面状态已刷新完成。')).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(
        screen.queryByText('桌面状态已刷新完成。')
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText('同步刷新进度')).not.toBeInTheDocument();
    } finally {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    }
  });

  it('copies the titled error message from the error panel', async () => {
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
