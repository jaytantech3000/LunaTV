import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

  it('shows the production default address and renders the preview plan', async () => {
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
      warnings: [],
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
  });

  it('executes onboarding, arms download handoff, and surfaces the initial password prompt', async () => {
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
      warnings: [],
    });

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
    expect(screen.getByText('已自动创建 1 个 Web 帐号')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.getByText('初始密码：123456')).toBeInTheDocument();
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
