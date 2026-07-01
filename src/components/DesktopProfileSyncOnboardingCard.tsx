'use client';

import {
  Check,
  Cloud,
  Copy,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';

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
const ERROR_COPY_RESET_DELAY_MS = 2000;
const RUNTIME_REFRESH_COMPLETED_RESET_DELAY_MS = 1500;

type RuntimeRefreshProgressPhase = 'refreshing' | 'completed';

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return '帐号同步开通失败';
}

async function copyText(value: string): Promise<boolean> {
  if (!value || typeof navigator === 'undefined' || !navigator.clipboard) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (_) {
    return false;
  }
}

function buildCopyableErrorMessage(errorMessage: string): string {
  return `错误信息\n${errorMessage}`;
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

function RuntimeRefreshProgressCard({
  phase,
}: {
  phase: RuntimeRefreshProgressPhase;
}) {
  const isCompleted = phase === 'completed';
  const progressValue = isCompleted ? 100 : 67;
  const title = isCompleted
    ? '桌面状态已刷新完成。'
    : '同步已开启，正在同步到当前页面。';
  const detail = isCompleted
    ? '当前页面和右上角用户菜单都已切换到最新同步状态。'
    : '桌面正在刷新运行时状态，通常只需几秒。';
  const steps = [
    {
      label: '1/3 已提交同步结果',
      tone: 'complete' as const,
    },
    {
      label: isCompleted
        ? '2/3 已刷新桌面运行时状态'
        : '2/3 正在刷新桌面运行时状态',
      tone: isCompleted ? ('complete' as const) : ('active' as const),
    },
    {
      label: isCompleted ? '3/3 当前页面已更新' : '3/3 等待当前页面更新',
      tone: isCompleted ? ('complete' as const) : ('pending' as const),
    },
  ];

  return (
    <div className='rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm dark:border-emerald-900/60 dark:bg-emerald-900/20'>
      <div className='flex items-start gap-3'>
        <div className='mt-0.5 text-emerald-600 dark:text-emerald-300'>
          {isCompleted ? (
            <Check className='h-4 w-4' />
          ) : (
            <RefreshCw className='h-4 w-4 animate-spin' />
          )}
        </div>
        <div className='min-w-0 flex-1'>
          <div className='font-medium text-emerald-900 dark:text-emerald-100'>
            {title}
          </div>
          <div className='mt-1 text-emerald-700/90 dark:text-emerald-200/90'>
            {detail}
          </div>
          <div
            className='mt-3 h-2 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-950/60'
            role='progressbar'
            aria-label='同步刷新进度'
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressValue}
          >
            <div
              className='h-full rounded-full bg-emerald-500 transition-all duration-300 dark:bg-emerald-400'
              style={{ width: `${progressValue}%` }}
            />
          </div>
          <div className='mt-3 space-y-2'>
            {steps.map((step) => (
              <div
                key={step.label}
                className={
                  step.tone === 'complete'
                    ? 'text-emerald-800 dark:text-emerald-100'
                    : step.tone === 'active'
                    ? 'font-medium text-emerald-900 dark:text-emerald-50'
                    : 'text-emerald-700/70 dark:text-emerald-200/70'
                }
              >
                {step.label}
              </div>
            ))}
          </div>
        </div>
      </div>
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
              title='已切换到 Web 帐号'
              subtitle={`桌面端已开始使用 Web 帐号 ${result.currentRemoteUsername}，离线下载归属也已按本次结果更新。`}
            />
          </div>
          <AppIconButton onClick={onClose} aria-label='关闭同步完成弹窗'>
            <X className='h-4 w-4' />
          </AppIconButton>
        </AppDialogHeader>

        <div className='space-y-4 px-5 py-5 sm:px-6'>
          <AppSurfaceCard className='bg-gray-50 px-4 py-4 dark:bg-gray-800/40'>
            <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
              当前使用的 Web 帐号
            </div>
            <div className='mt-1 text-sm text-gray-600 dark:text-gray-300'>
              {result.currentRemoteUsername}
            </div>
          </AppSurfaceCard>

          <AppSurfaceCard className='space-y-2 px-4 py-4 dark:bg-gray-900'>
            <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
              本次自动创建的帐号
            </div>
            {result.createdAccounts.length ? (
              <>
                <div className='text-sm text-gray-600 dark:text-gray-300'>
                  {`已自动创建 ${result.createdAccounts.length} 个 Web 帐号，请尽快修改初始密码。`}
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
                本次未创建新的 Web 帐号。
              </div>
            )}
          </AppSurfaceCard>

          {result.warnings.length ? (
            <AppSurfaceCard className='space-y-2 px-4 py-4 dark:bg-gray-900'>
              <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                接下来建议
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
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [runtimeRefreshPhase, setRuntimeRefreshPhase] =
    useState<RuntimeRefreshProgressPhase | null>(null);
  const [errorCopyState, setErrorCopyState] = useState<
    'idle' | 'success' | 'error'
  >('idle');

  const normalizedCurrentLocalUsername = currentLocalUsername?.trim() || '';
  const canSubmit =
    Boolean(normalizedCurrentLocalUsername) &&
    Boolean(username.trim()) &&
    Boolean(password.trim());

  useEffect(() => {
    setErrorCopyState('idle');
  }, [errorMessage]);

  useEffect(() => {
    if (errorCopyState === 'idle') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setErrorCopyState('idle');
    }, ERROR_COPY_RESET_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [errorCopyState]);

  useEffect(() => {
    if (runtimeRefreshPhase !== 'refreshing' || !profileSyncEnabled) {
      return;
    }

    setRuntimeRefreshPhase('completed');
  }, [profileSyncEnabled, runtimeRefreshPhase]);

  useEffect(() => {
    if (runtimeRefreshPhase !== 'completed') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setRuntimeRefreshPhase(null);
    }, RUNTIME_REFRESH_COMPLETED_RESET_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [runtimeRefreshPhase]);

  const handlePreview = async () => {
    if (!canSubmit) {
      setErrorMessage('请先补全当前本地帐号、Web 用户名和密码。');
      return;
    }

    setIsPreviewing(true);
    setErrorMessage('');
    setRuntimeRefreshPhase(null);
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
    setRuntimeRefreshPhase(null);

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
      setRuntimeRefreshPhase('refreshing');
      requestDesktopRuntimeRefresh();
    } catch (error) {
      setRuntimeRefreshPhase(null);
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsExecuting(false);
    }
  };

  const handleCopyErrorMessage = async () => {
    const didCopy = await copyText(buildCopyableErrorMessage(errorMessage));
    setErrorCopyState(didCopy ? 'success' : 'error');
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
                        开始前请确认
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
            <div className='rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300'>
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0'>
                  <div className='text-sm font-medium'>错误信息</div>
                  <div className='mt-1 text-sm leading-6'>{errorMessage}</div>
                </div>
                <div
                  className='flex shrink-0 items-center gap-2'
                  aria-live='polite'
                >
                  {errorCopyState === 'success' ? (
                    <span className='text-xs font-medium'>已复制</span>
                  ) : null}
                  {errorCopyState === 'error' ? (
                    <span className='text-xs font-medium'>复制失败</span>
                  ) : null}
                  <AppIconButton
                    aria-label={
                      errorCopyState === 'success'
                        ? '已复制错误信息'
                        : '复制错误信息'
                    }
                    title={
                      errorCopyState === 'success'
                        ? '已复制错误信息'
                        : '复制错误信息'
                    }
                    onClick={handleCopyErrorMessage}
                    className='h-8 w-8 border border-red-200 bg-white/80 text-red-600 hover:bg-white hover:text-red-700 dark:border-red-800/80 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/70 dark:hover:text-red-100'
                  >
                    {errorCopyState === 'success' ? (
                      <Check className='h-4 w-4' />
                    ) : (
                      <Copy className='h-4 w-4' />
                    )}
                  </AppIconButton>
                </div>
              </div>
            </div>
          ) : null}

          {!errorMessage && runtimeRefreshPhase ? (
            <RuntimeRefreshProgressCard phase={runtimeRefreshPhase} />
          ) : null}
        </div>
      </AppSurfaceCard>

      <SuccessDialog result={result} onClose={() => setResult(null)} />
    </>
  );
}
