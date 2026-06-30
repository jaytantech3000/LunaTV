'use client';

import { Cloud, RefreshCw, ShieldCheck, UserPlus, X } from 'lucide-react';
import { useState } from 'react';

import {
  type DesktopProfileSyncConflictStrategy,
  type DesktopProfileSyncOnboardingExecuteResponse,
  type DesktopProfileSyncOnboardingPreviewResponse,
  executeDesktopProfileSyncOnboarding,
  previewDesktopProfileSyncOnboarding,
} from '@/lib/desktop/profile-sync';
import { requestDesktopRuntimeRefresh } from '@/lib/desktop/runtime-config';
import { armDesktopDownloadOwnershipHandoff } from '@/lib/download/session';

import {
  AppButton,
  AppDialogBackdrop,
  AppDialogHeader,
  AppDialogPanel,
  AppDialogTitleBlock,
  AppIconBadge,
  AppIconButton,
  AppSurfaceCard,
} from '@/components/AppChrome';

const DEFAULT_DESKTOP_PROFILE_SYNC_API_BASE_URL = 'https://luna.hkcu.qzz.io';

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return '帐号同步开通失败';
}

function formatSummaryLine(summary: {
  playRecordCount: number;
  favoriteCount: number;
  followCount: number;
  searchHistoryCount: number;
  skipConfigCount: number;
}): string {
  return [
    `播放 ${summary.playRecordCount}`,
    `收藏 ${summary.favoriteCount}`,
    `追更 ${summary.followCount}`,
    `搜索 ${summary.searchHistoryCount}`,
    `跳过 ${summary.skipConfigCount}`,
  ].join(' / ');
}

function DownloadPreview({
  preview,
}: {
  preview: DesktopProfileSyncOnboardingPreviewResponse['downloadPreview'];
}) {
  if (!preview.hasDownloads || !preview.targetUsername) {
    return (
      <div className='rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'>
        当前未检测到需要重绑的离线下载。
      </div>
    );
  }

  return (
    <div className='rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-200'>
      {`离线下载将重绑到 ${preview.targetUsername}（${preview.taskCount} 个任务 / ${preview.libraryCount} 个条目）`}
    </div>
  );
}

function SuccessDialog({
  result,
  onClose,
}: {
  result: DesktopProfileSyncOnboardingExecuteResponse | null;
  onClose: () => void;
}) {
  if (!result || typeof document === 'undefined') {
    return null;
  }

  return (
    <AppDialogBackdrop className='z-[1200] flex items-center justify-center p-4'>
      <AppDialogPanel
        role='dialog'
        aria-modal='true'
        className='w-full max-w-2xl overflow-hidden'
      >
        <AppDialogHeader>
          <div className='flex items-center gap-3'>
            <AppIconBadge tone='emerald'>
              <ShieldCheck className='h-5 w-5' />
            </AppIconBadge>
            <AppDialogTitleBlock
              title='帐号同步已开启'
              subtitle='桌面正在切换到 Web 帐号模式，离线下载归属也已按当前结果处理。'
            />
          </div>
          <AppIconButton onClick={onClose} aria-label='关闭同步完成弹窗'>
            <X className='h-4 w-4' />
          </AppIconButton>
        </AppDialogHeader>

        <div className='space-y-4 px-5 py-5 sm:px-6'>
          <AppSurfaceCard className='bg-gray-50 px-4 py-4 dark:bg-gray-800/40'>
            <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
              当前 Web 帐号
            </div>
            <div className='mt-1 text-sm text-gray-600 dark:text-gray-300'>
              {result.currentRemoteUsername}
            </div>
          </AppSurfaceCard>

          <AppSurfaceCard className='space-y-2 px-4 py-4 dark:bg-gray-900'>
            <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
              自动创建帐号
            </div>
            {result.createdAccounts.length ? (
              <>
                <div className='text-sm text-gray-600 dark:text-gray-300'>
                  {`已自动创建 ${result.createdAccounts.length} 个 Web 帐号`}
                </div>
                {result.createdAccounts.map((account) => (
                  <div
                    key={account.username}
                    className='rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200'
                  >
                    <div>{account.username}</div>
                    <div className='mt-1 font-medium'>
                      初始密码：{account.initialPassword}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className='text-sm text-gray-600 dark:text-gray-300'>
                本次没有新增 Web 帐号。
              </div>
            )}
          </AppSurfaceCard>

          {result.warnings.length ? (
            <AppSurfaceCard className='space-y-2 px-4 py-4 dark:bg-gray-900'>
              <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                提示
              </div>
              {result.warnings.map((warning) => (
                <div
                  key={warning}
                  className='text-sm leading-6 text-gray-600 dark:text-gray-300'
                >
                  {warning}
                </div>
              ))}
            </AppSurfaceCard>
          ) : null}

          <div className='flex justify-end'>
            <AppButton onClick={onClose} variant='accent'>
              知道了
            </AppButton>
          </div>
        </div>
      </AppDialogPanel>
    </AppDialogBackdrop>
  );
}

export default function DesktopProfileSyncOnboardingCard({
  currentLocalUsername,
  profileSyncEnabled,
}: {
  currentLocalUsername?: string | null;
  profileSyncEnabled: boolean;
}) {
  const [remoteBaseUrl, setRemoteBaseUrl] = useState(
    DEFAULT_DESKTOP_PROFILE_SYNC_API_BASE_URL
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [strategy, setStrategy] =
    useState<DesktopProfileSyncConflictStrategy>('web-first');
  const [preview, setPreview] =
    useState<DesktopProfileSyncOnboardingPreviewResponse | null>(null);
  const [result, setResult] =
    useState<DesktopProfileSyncOnboardingExecuteResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const normalizedCurrentLocalUsername = currentLocalUsername?.trim() || '';
  const canSubmit =
    Boolean(normalizedCurrentLocalUsername) &&
    Boolean(username.trim()) &&
    Boolean(password.trim());

  const handlePreview = async () => {
    if (!canSubmit) {
      setErrorMessage('请先补全当前本地帐号、Web 用户名和密码。');
      return;
    }

    setIsPreviewing(true);
    setErrorMessage('');
    setInfoMessage('');
    setResult(null);

    try {
      const nextPreview = await previewDesktopProfileSyncOnboarding({
        remoteBaseUrl,
        username: username.trim(),
        password,
        currentLocalUsername: normalizedCurrentLocalUsername,
      });
      setPreview(nextPreview);
      setRemoteBaseUrl(nextPreview.remoteBaseUrl);
    } catch (error) {
      setPreview(null);
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleExecute = async () => {
    if (!canSubmit) {
      setErrorMessage('请先补全当前本地帐号、Web 用户名和密码。');
      return;
    }

    setIsExecuting(true);
    setErrorMessage('');
    setInfoMessage('');

    try {
      const nextResult = await executeDesktopProfileSyncOnboarding({
        remoteBaseUrl,
        username: username.trim(),
        password,
        currentLocalUsername: normalizedCurrentLocalUsername,
        strategy,
      });
      setResult(nextResult);
      armDesktopDownloadOwnershipHandoff({
        previousOwnerUsername:
          nextResult.downloadRebind.previousOwnerUsername ?? undefined,
        nextOwnerUsername:
          nextResult.downloadRebind.nextOwnerUsername ?? undefined,
      });
      requestDesktopRuntimeRefresh();
      setInfoMessage('同步已开启，正在刷新桌面运行时状态。');
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <>
      <AppSurfaceCard className='overflow-hidden'>
        <div className='border-b border-gray-200 bg-gradient-to-r from-emerald-500/10 via-sky-500/10 to-white px-5 py-5 dark:border-gray-800 dark:from-emerald-500/15 dark:via-sky-500/10 dark:to-gray-950 sm:px-6'>
          <div className='flex items-start gap-3'>
            <AppIconBadge tone='emerald'>
              <Cloud className='h-5 w-5' />
            </AppIconBadge>
            <AppDialogTitleBlock
              title='开启帐号同步'
              subtitle='在 desktop-admin 内完成 Web 登录、资料迁移预览和正式开通，不再需要手改 profile_sync.api_base_url。'
            />
          </div>
        </div>

        <div className='space-y-5 px-5 py-5 sm:px-6'>
          {profileSyncEnabled ? (
            <div className='rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-200'>
              当前桌面已经开启帐号同步。如需检查连接状态或重新登录，请继续使用下方诊断信息和右上角用户菜单。
            </div>
          ) : (
            <>
              <div className='grid gap-4 lg:grid-cols-2'>
                <label className='space-y-2 text-sm text-gray-700 dark:text-gray-200'>
                  <span className='font-medium'>Web 服务地址</span>
                  <input
                    aria-label='Web 服务地址'
                    value={remoteBaseUrl}
                    onChange={(event) => setRemoteBaseUrl(event.target.value)}
                    className='w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'
                  />
                </label>

                <label className='space-y-2 text-sm text-gray-700 dark:text-gray-200'>
                  <span className='font-medium'>当前本地帐号</span>
                  <input
                    value={normalizedCurrentLocalUsername || '未检测到'}
                    readOnly
                    className='w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                  />
                </label>

                <label className='space-y-2 text-sm text-gray-700 dark:text-gray-200'>
                  <span className='font-medium'>Web 用户名</span>
                  <input
                    aria-label='Web 用户名'
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className='w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'
                  />
                </label>

                <label className='space-y-2 text-sm text-gray-700 dark:text-gray-200'>
                  <span className='font-medium'>Web 密码</span>
                  <input
                    aria-label='Web 密码'
                    type='password'
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className='w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'
                  />
                </label>
              </div>

              <div className='space-y-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 dark:border-gray-700 dark:bg-gray-900/50'>
                <div className='flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
                  <ShieldCheck className='h-4 w-4 text-emerald-600 dark:text-emerald-400' />
                  冲突策略
                </div>
                <label className='flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'>
                  <input
                    type='radio'
                    name='desktop-profile-sync-strategy'
                    checked={strategy === 'web-first'}
                    onChange={() => setStrategy('web-first')}
                  />
                  <span>
                    A：Web 优先
                    <span className='block text-xs text-gray-500 dark:text-gray-400'>
                      远端已有资料优先保留，本地同键冲突项只补缺。
                    </span>
                  </span>
                </label>
                <label className='flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'>
                  <input
                    type='radio'
                    name='desktop-profile-sync-strategy'
                    checked={strategy === 'local-first'}
                    onChange={() => setStrategy('local-first')}
                  />
                  <span>
                    B：本地优先
                    <span className='block text-xs text-gray-500 dark:text-gray-400'>
                      本地资料覆盖同键远端项，适合把桌面现状完整迁过去。
                    </span>
                  </span>
                </label>
              </div>

              <div className='flex flex-wrap gap-3'>
                <AppButton
                  onClick={handlePreview}
                  disabled={isPreviewing || isExecuting}
                >
                  {isPreviewing ? (
                    <RefreshCw className='h-4 w-4 animate-spin' />
                  ) : (
                    <Cloud className='h-4 w-4' />
                  )}
                  生成迁移预览
                </AppButton>
                <AppButton
                  onClick={handleExecute}
                  disabled={isPreviewing || isExecuting || !preview}
                  variant='accent'
                >
                  {isExecuting ? (
                    <RefreshCw className='h-4 w-4 animate-spin' />
                  ) : (
                    <ShieldCheck className='h-4 w-4' />
                  )}
                  开始开启同步
                </AppButton>
              </div>

              {preview ? (
                <div className='space-y-4'>
                  <AppSurfaceCard className='space-y-3 px-4 py-4 dark:bg-gray-900'>
                    <div className='flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
                      <UserPlus className='h-4 w-4 text-sky-600 dark:text-sky-400' />
                      迁移预览
                    </div>
                    <div className='space-y-3'>
                      {preview.plan.items.map((item) => (
                        <div
                          key={`${item.localUsername}:${item.remoteUsername}`}
                          className='rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-700 dark:bg-gray-800/60'
                        >
                          <div className='flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
                            <span>{`${item.localUsername} -> ${item.remoteUsername}`}</span>
                            {item.requiresAccountCreation ? (
                              <span className='rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'>
                                将自动创建
                              </span>
                            ) : null}
                          </div>
                          <div className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
                            {formatSummaryLine(item.summary)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </AppSurfaceCard>

                  <DownloadPreview preview={preview.downloadPreview} />

                  {preview.warnings.length ? (
                    <AppSurfaceCard className='space-y-2 px-4 py-4 dark:bg-gray-900'>
                      <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                        执行前提示
                      </div>
                      {preview.warnings.map((warning) => (
                        <div
                          key={warning}
                          className='text-sm leading-6 text-gray-600 dark:text-gray-300'
                        >
                          {warning}
                        </div>
                      ))}
                    </AppSurfaceCard>
                  ) : null}
                </div>
              ) : null}
            </>
          )}

          {errorMessage ? (
            <div className='rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300'>
              {errorMessage}
            </div>
          ) : null}

          {!errorMessage && infoMessage ? (
            <div className='rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300'>
              {infoMessage}
            </div>
          ) : null}
        </div>
      </AppSurfaceCard>

      <SuccessDialog result={result} onClose={() => setResult(null)} />
    </>
  );
}
