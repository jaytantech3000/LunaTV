'use client';

import {
  AlertCircle,
  Bug,
  CheckCircle2,
  Cloud,
  Copy,
  Download,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { BROWSER_AUTH_UPDATED_EVENT } from '@/lib/auth';
import {
  type DesktopProfileSyncStatus,
  readDesktopProfileSyncStatusState,
} from '@/lib/desktop/profile-sync';
import {
  buildDesktopProfileSyncStatusDetail,
  buildDesktopProfileSyncStatusValue,
} from '@/lib/desktop/profile-sync-status-copy';
import { requestDesktopRuntimeRefresh } from '@/lib/desktop/runtime-config';
import {
  DesktopAuthStatus,
  DesktopDiagnosticsLevel,
  DesktopLocalServiceDiagnosticsReport,
  DesktopLocalServiceStatus,
  getDesktopAuthStatus,
  getLocalServiceStatus,
  isDesktopTauriRuntimeAvailable,
  readDesktopAppConfig,
  runLocalServiceDiagnostics,
  saveLocalServiceDiagnostics,
  startLocalService,
  stopLocalService,
  uploadLocalServiceDiagnostics,
  writeDesktopAppConfig,
} from '@/lib/desktop/tauri-client';

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
import DesktopProfileSyncDiagnosticsGrid from '@/components/DesktopProfileSyncDiagnosticsGrid';

interface DesktopSettingsSectionProps {
  isOpen: boolean;
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message;
  }

  return '桌面本地服务操作失败';
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

function downloadTextFile(filename: string, contents: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  try {
    const blob = new Blob([contents], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
  } catch (_) {
    return false;
  }
}

function formatTimestamp(timestampMs: number): string {
  if (!timestampMs) {
    return '-';
  }

  try {
    return new Date(timestampMs).toLocaleString();
  } catch (_) {
    return String(timestampMs);
  }
}

function buildDiagnosticsFilename(
  report: DesktopLocalServiceDiagnosticsReport
): string {
  const timestamp = new Date(report.capturedAtMs || Date.now())
    .toISOString()
    .replace(/[:.]/g, '-');
  return `lunatv-desktop-diagnostics-${timestamp}.txt`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function extractProfileSyncApiBaseUrl(config: unknown): string | null {
  const configRecord = asRecord(config);
  const profileSyncRecord = asRecord(configRecord?.profile_sync);
  const remoteBaseUrl = profileSyncRecord?.api_base_url;

  if (typeof remoteBaseUrl !== 'string') {
    return null;
  }

  const normalized = remoteBaseUrl.trim();
  return normalized ? normalized : null;
}

function formatDiagnosticsUploadMessage(result: {
  message: string;
  issueUrl?: string | null;
}): string {
  const message = result.message.trim();
  if (result.issueUrl) {
    return message ? `${message} ${result.issueUrl}` : result.issueUrl;
  }

  return message;
}

function levelLabel(level: DesktopDiagnosticsLevel): string {
  switch (level) {
    case 'ok':
      return '正常';
    case 'warning':
      return '注意';
    default:
      return '错误';
  }
}

function levelPillClassName(level: DesktopDiagnosticsLevel): string {
  switch (level) {
    case 'ok':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300';
    case 'warning':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300';
    default:
      return 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300';
  }
}

function DesktopPathRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: (value: string) => void;
}) {
  return (
    <div className='space-y-1'>
      <div className='text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400'>
        {label}
      </div>
      <div className='flex items-start gap-2'>
        <div className='min-w-0 flex-1 break-all rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'>
          {value || '-'}
        </div>
        {value ? (
          <button
            type='button'
            onClick={() => onCopy(value)}
            className='inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100'
            aria-label={`复制 ${label}`}
            title={`复制 ${label}`}
          >
            <Copy className='h-4 w-4' />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DiagnosticsModal({
  isOpen,
  isDiagnosing,
  isExporting,
  report,
  errorMessage,
  actionMessage,
  actionErrorMessage,
  onClose,
  onRetry,
  onExport,
}: {
  isOpen: boolean;
  isDiagnosing: boolean;
  isExporting: boolean;
  report: DesktopLocalServiceDiagnosticsReport | null;
  errorMessage: string;
  actionMessage: string;
  actionErrorMessage: string;
  onClose: () => void;
  onRetry: () => void;
  onExport: () => void;
}) {
  if (!isOpen || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <AppDialogBackdrop className='z-[1100] flex items-center justify-center p-4'>
      <AppDialogPanel className='w-full max-w-3xl overflow-hidden'>
        <AppDialogHeader>
          <div className='flex items-center gap-3'>
            <AppIconBadge tone='amber'>
              <Bug className='h-5 w-5' />
            </AppIconBadge>
            <AppDialogTitleBlock
              title='本地服务错误排查'
              subtitle='自动检查 sidecar、端口、配置、数据目录，并收集试运行日志。'
            />
          </div>
          <AppIconButton
            onClick={onClose}
            disabled={isDiagnosing || isExporting}
            aria-label='关闭排查弹窗'
          >
            <X className='h-4 w-4' />
          </AppIconButton>
        </AppDialogHeader>

        <div className='max-h-[72vh] space-y-4 overflow-y-auto px-5 py-5'>
          {isDiagnosing ? (
            <AppSurfaceCard className='flex min-h-[240px] flex-col items-center justify-center gap-4 rounded-2xl border-dashed bg-gray-50 px-6 py-10 text-center dark:bg-gray-800/40'>
              <RefreshCw className='h-8 w-8 animate-spin text-green-600 dark:text-green-400' />
              <div className='space-y-1'>
                <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                  排查中
                </div>
                <div className='text-xs text-gray-500 dark:text-gray-400'>
                  正在自动检查启动条件并收集本地服务日志，请稍候。
                </div>
              </div>
            </AppSurfaceCard>
          ) : null}

          {!isDiagnosing && errorMessage ? (
            <div className='rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300'>
              {errorMessage}
            </div>
          ) : null}

          {!isDiagnosing && report ? (
            <>
              <AppSurfaceCard className='bg-gray-50 px-4 py-4 dark:bg-gray-800/40'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${levelPillClassName(
                      report.status
                    )}`}
                  >
                    {levelLabel(report.status)}
                  </span>
                  <span className='text-xs text-gray-500 dark:text-gray-400'>
                    生成时间：{formatTimestamp(report.capturedAtMs)}
                  </span>
                </div>
                <div className='mt-3 text-sm font-medium text-gray-900 dark:text-gray-100'>
                  主要原因
                </div>
                <div className='mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300'>
                  {report.summary}
                </div>
              </AppSurfaceCard>

              <div className='space-y-3'>
                <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                  检查明细
                </div>
                {report.findings.map((finding) => (
                  <AppSurfaceCard
                    key={`${finding.level}-${finding.title}`}
                    className='px-4 py-4 dark:bg-gray-900'
                  >
                    <div className='flex flex-wrap items-center gap-2'>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${levelPillClassName(
                          finding.level
                        )}`}
                      >
                        {levelLabel(finding.level)}
                      </span>
                      <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                        {finding.title}
                      </div>
                    </div>
                    <div className='mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-600 dark:text-gray-300'>
                      {finding.detail}
                    </div>
                  </AppSurfaceCard>
                ))}
              </div>

              {report.recommendations.length ? (
                <AppSurfaceCard className='space-y-3 px-4 py-4 dark:bg-gray-900'>
                  <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                    建议操作
                  </div>
                  <div className='space-y-2'>
                    {report.recommendations.map((item) => (
                      <div
                        key={item}
                        className='text-sm leading-6 text-gray-600 dark:text-gray-300'
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </AppSurfaceCard>
              ) : null}
            </>
          ) : null}
        </div>

        <div className='space-y-3 border-t border-gray-200 px-5 py-4 dark:border-gray-700'>
          {actionErrorMessage ? (
            <div className='rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-6 text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300'>
              {actionErrorMessage}
            </div>
          ) : null}

          {!actionErrorMessage && actionMessage ? (
            <div className='rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-6 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300'>
              {actionMessage}
            </div>
          ) : null}

          <div className='flex flex-wrap items-center justify-between gap-3'>
            <AppButton
              onClick={onRetry}
              disabled={isDiagnosing || isExporting}
              size='sm'
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isDiagnosing ? 'animate-spin' : ''}`}
              />
              重新排查
            </AppButton>

            <div className='flex flex-wrap items-center gap-2'>
              <AppButton
                onClick={onExport}
                disabled={isDiagnosing || isExporting || !report}
                size='sm'
              >
                {isExporting ? (
                  <RefreshCw className='h-3.5 w-3.5 animate-spin' />
                ) : (
                  <Download className='h-3.5 w-3.5' />
                )}
                导出排查日志
              </AppButton>
              <AppButton
                onClick={onClose}
                disabled={isDiagnosing || isExporting}
                size='sm'
                variant='accent'
              >
                关闭
              </AppButton>
            </div>
          </div>
        </div>
      </AppDialogPanel>
    </AppDialogBackdrop>,
    document.body
  );
}

export default function DesktopSettingsSection({
  isOpen,
}: DesktopSettingsSectionProps) {
  const [ipcAvailable, setIpcAvailable] = useState(false);
  const [serviceStatus, setServiceStatus] =
    useState<DesktopLocalServiceStatus | null>(null);
  const [authStatus, setAuthStatus] = useState<DesktopAuthStatus | null>(null);
  const [profileSyncStatus, setProfileSyncStatus] =
    useState<DesktopProfileSyncStatus | null>();
  const [profileSyncStatusError, setProfileSyncStatusError] = useState('');
  const [configText, setConfigText] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDiagnosticsModalOpen, setIsDiagnosticsModalOpen] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);
  const [diagnosticsReport, setDiagnosticsReport] =
    useState<DesktopLocalServiceDiagnosticsReport | null>(null);
  const [diagnosticsErrorMessage, setDiagnosticsErrorMessage] = useState('');
  const [diagnosticsActionMessage, setDiagnosticsActionMessage] = useState('');
  const [diagnosticsActionErrorMessage, setDiagnosticsActionErrorMessage] =
    useState('');

  const refreshDesktopState = useCallback(async () => {
    const available = isDesktopTauriRuntimeAvailable();
    setIpcAvailable(available);

    if (!available) {
      setServiceStatus(null);
      setAuthStatus(null);
      setProfileSyncStatus(undefined);
      setProfileSyncStatusError('');
      return;
    }

    setIsRefreshing(true);
    setErrorMessage('');

    try {
      const [
        nextStatusResult,
        nextConfigResult,
        nextAuthStatusResult,
        nextProfileSyncResult,
      ] = await Promise.allSettled([
        getLocalServiceStatus(),
        readDesktopAppConfig(),
        getDesktopAuthStatus(),
        readDesktopProfileSyncStatusState(),
      ]);

      let nextErrorMessage = '';

      if (nextStatusResult.status === 'fulfilled') {
        setServiceStatus(nextStatusResult.value);
      } else {
        setServiceStatus(null);
        nextErrorMessage = getErrorMessage(nextStatusResult.reason);
      }

      if (nextConfigResult.status === 'fulfilled') {
        setConfigText(JSON.stringify(nextConfigResult.value, null, 2));
      } else if (!nextErrorMessage) {
        nextErrorMessage = getErrorMessage(nextConfigResult.reason);
      }

      if (nextAuthStatusResult.status === 'fulfilled') {
        setAuthStatus(nextAuthStatusResult.value);
      } else {
        setAuthStatus(null);
        if (!nextErrorMessage) {
          nextErrorMessage = getErrorMessage(nextAuthStatusResult.reason);
        }
      }

      if (nextProfileSyncResult.status === 'fulfilled') {
        setProfileSyncStatus(nextProfileSyncResult.value.status);
        setProfileSyncStatusError(nextProfileSyncResult.value.error);
      } else {
        const message = getErrorMessage(nextProfileSyncResult.reason);
        setProfileSyncStatus(undefined);
        setProfileSyncStatusError(message);
      }

      if (nextErrorMessage) {
        setErrorMessage(nextErrorMessage);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    void refreshDesktopState();
  }, [isOpen, refreshDesktopState]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') {
      return;
    }

    const handleBrowserAuthUpdated = () => {
      void refreshDesktopState();
    };

    window.addEventListener(
      BROWSER_AUTH_UPDATED_EVENT,
      handleBrowserAuthUpdated
    );

    return () => {
      window.removeEventListener(
        BROWSER_AUTH_UPDATED_EVENT,
        handleBrowserAuthUpdated
      );
    };
  }, [isOpen, refreshDesktopState]);

  const handleCopy = useCallback(async (value: string) => {
    const didCopy = await copyText(value);
    setInfoMessage(didCopy ? '路径已复制到剪贴板。' : '复制失败。');
  }, []);

  const handleRestartService = useCallback(async () => {
    if (!ipcAvailable) {
      setErrorMessage(
        '当前不在桌面壳环境中，无法通过 Tauri IPC 控制本地服务。'
      );
      return;
    }

    setIsRestarting(true);
    setErrorMessage('');

    try {
      if (serviceStatus?.running) {
        await stopLocalService();
      }

      await startLocalService();
      await refreshDesktopState();
      requestDesktopRuntimeRefresh();
      setInfoMessage('本地服务已重启。');
    } catch (error) {
      const message = getErrorMessage(error);
      setErrorMessage(message);
      setProfileSyncStatus(undefined);
      setProfileSyncStatusError(message);
    } finally {
      setIsRestarting(false);
    }
  }, [ipcAvailable, refreshDesktopState, serviceStatus?.running]);

  const handleSaveConfig = useCallback(async () => {
    if (!ipcAvailable) {
      setErrorMessage('当前不在桌面壳环境中，无法写入桌面配置。');
      return;
    }

    setIsSaving(true);
    setErrorMessage('');

    try {
      const parsedConfig = JSON.parse(configText) as Record<string, unknown>;
      await writeDesktopAppConfig(parsedConfig);
      await startLocalService();
      await refreshDesktopState();
      requestDesktopRuntimeRefresh();
      window.dispatchEvent(new Event(BROWSER_AUTH_UPDATED_EVENT));
      setInfoMessage('配置已保存，并已重新加载本地服务。');
    } catch (error) {
      if (error instanceof SyntaxError) {
        setErrorMessage('配置 JSON 格式无效，请先修正后再保存。');
      } else {
        const message = getErrorMessage(error);
        setErrorMessage(message);
        setProfileSyncStatus(undefined);
        setProfileSyncStatusError(message);
      }
    } finally {
      setIsSaving(false);
    }
  }, [configText, ipcAvailable, refreshDesktopState]);

  const resolveDiagnosticsUploadBaseUrl = useCallback(async () => {
    try {
      return extractProfileSyncApiBaseUrl(JSON.parse(configText));
    } catch (_) {
      // Fall back to the persisted desktop config if the editor currently has invalid JSON.
    }

    if (!ipcAvailable) {
      return null;
    }

    try {
      return extractProfileSyncApiBaseUrl(await readDesktopAppConfig());
    } catch (_) {
      return null;
    }
  }, [configText, ipcAvailable]);

  const handleRunDiagnostics = useCallback(async () => {
    if (!ipcAvailable) {
      setErrorMessage('当前不在桌面壳环境中，无法执行本地服务排查。');
      return;
    }

    setIsDiagnosticsModalOpen(true);
    setIsDiagnosing(true);
    setDiagnosticsReport(null);
    setDiagnosticsErrorMessage('');
    setDiagnosticsActionMessage('');
    setDiagnosticsActionErrorMessage('');

    try {
      const report = await runLocalServiceDiagnostics();
      setDiagnosticsReport(report);
      try {
        setServiceStatus(await getLocalServiceStatus());
      } catch (_) {
        // Keep the diagnostics report even if the follow-up status refresh fails.
      }
    } catch (error) {
      setDiagnosticsErrorMessage(getErrorMessage(error));
    } finally {
      setIsDiagnosing(false);
    }
  }, [ipcAvailable]);

  const handleExportDiagnosticsLog = useCallback(async () => {
    if (!diagnosticsReport) {
      return;
    }

    setIsExportingDiagnostics(true);
    setDiagnosticsActionMessage('');
    setDiagnosticsActionErrorMessage('');
    setErrorMessage('');
    setInfoMessage('');

    let localExportState: 'saved' | 'canceled' | 'failed' = 'failed';
    let localExportPath = '';
    let localExportErrorMessage = '';

    if (ipcAvailable) {
      try {
        const saveResult = await saveLocalServiceDiagnostics(
          buildDiagnosticsFilename(diagnosticsReport),
          diagnosticsReport.logText
        );

        if (saveResult.saved) {
          localExportState = 'saved';
          localExportPath = saveResult.path || '';
        } else if (saveResult.canceled) {
          localExportState = 'canceled';
        }
      } catch (error) {
        localExportState = 'failed';
        localExportErrorMessage = getErrorMessage(error);
      }
    } else {
      localExportState = downloadTextFile(
        buildDiagnosticsFilename(diagnosticsReport),
        diagnosticsReport.logText
      )
        ? 'saved'
        : 'failed';
    }

    let uploadSucceeded = false;
    let uploadMessage = '';
    let uploadFailed = false;

    try {
      if (!ipcAvailable) {
        uploadMessage = '当前不在桌面壳环境中，未执行自动上传。';
      } else {
        const remoteBaseUrl = await resolveDiagnosticsUploadBaseUrl();
        if (!remoteBaseUrl) {
          uploadMessage = '未配置 profile_sync.api_base_url，未执行自动上传。';
        } else {
          const uploadResult = await uploadLocalServiceDiagnostics(
            remoteBaseUrl,
            diagnosticsReport
          );
          uploadSucceeded = uploadResult.uploaded;
          uploadMessage = formatDiagnosticsUploadMessage(uploadResult);
        }
      }
    } catch (error) {
      uploadFailed = true;
      uploadMessage = `自动上传失败：${getErrorMessage(error)}`;
    } finally {
      setIsExportingDiagnostics(false);
    }

    const localMessage =
      localExportState === 'saved'
        ? localExportPath
          ? `排查日志已保存到：${localExportPath}`
          : '排查日志已导出。'
        : localExportState === 'canceled'
        ? '已取消保存排查日志。'
        : localExportErrorMessage
        ? `排查日志保存失败：${localExportErrorMessage}`
        : '排查日志本地导出失败。';
    const combinedMessage = [localMessage, uploadMessage]
      .filter((value) => value.trim().length > 0)
      .join(' ');

    if (
      localExportState === 'saved' ||
      uploadSucceeded ||
      (localExportState === 'canceled' && !uploadFailed)
    ) {
      setDiagnosticsActionMessage(combinedMessage);
      setDiagnosticsActionErrorMessage('');
      setInfoMessage(combinedMessage);
      setErrorMessage('');
      return;
    }

    setDiagnosticsActionMessage('');
    setDiagnosticsActionErrorMessage(combinedMessage);
    setInfoMessage('');
    setErrorMessage(combinedMessage);
    return;
    /*

    const _unusedDidExport = downloadTextFile(
      buildDiagnosticsFilename(diagnosticsReport),
      diagnosticsReport.logText
    );
    setInfoMessage(didExport ? '排查日志已导出。' : '排查日志导出失败。');
    */
  }, [diagnosticsReport, ipcAvailable, resolveDiagnosticsUploadBaseUrl]);

  const canShowDiagnostics = Boolean(
    ipcAvailable && serviceStatus && !serviceStatus.running
  );

  return (
    <>
      <section className='space-y-4 border-t border-gray-200 pt-6 dark:border-gray-700'>
        <div className='space-y-1'>
          <div className='flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-100'>
            <Server className='h-4 w-4 text-gray-500 dark:text-gray-400' />
            桌面本地服务
          </div>
          <p className='text-xs text-gray-500 dark:text-gray-400'>
            当前桌面包通过 Tauri IPC 管理本地 Rust 服务和本地配置文件。
          </p>
        </div>

        {ipcAvailable ? (
          <>
            <div className='flex flex-wrap items-center gap-2'>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                  serviceStatus?.running
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                    : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                }`}
              >
                {serviceStatus?.running ? (
                  <CheckCircle2 className='h-3.5 w-3.5' />
                ) : (
                  <AlertCircle className='h-3.5 w-3.5' />
                )}
                {serviceStatus?.running ? '运行中' : '未运行'}
              </span>

              <button
                type='button'
                onClick={() => void refreshDesktopState()}
                disabled={
                  isRefreshing || isRestarting || isSaving || isDiagnosing
                }
                className='inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${
                    isRefreshing ? 'animate-spin' : ''
                  }`}
                />
                刷新状态
              </button>

              <button
                type='button'
                onClick={() => void handleRestartService()}
                disabled={
                  isRefreshing || isRestarting || isSaving || isDiagnosing
                }
                className='inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
              >
                <RotateCcw
                  className={`h-3.5 w-3.5 ${
                    isRestarting ? 'animate-spin' : ''
                  }`}
                />
                重启服务
              </button>

              {canShowDiagnostics ? (
                <button
                  type='button'
                  onClick={() => void handleRunDiagnostics()}
                  disabled={
                    isRefreshing || isRestarting || isSaving || isDiagnosing
                  }
                  className='inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/30'
                >
                  <Bug className='h-3.5 w-3.5' />
                  错误排查
                </button>
              ) : null}
            </div>

            <div className='grid gap-3'>
              <DesktopPathRow
                label='Base URL'
                value={serviceStatus?.baseUrl || ''}
                onCopy={handleCopy}
              />
              <DesktopPathRow
                label='Config Path'
                value={serviceStatus?.configPath || ''}
                onCopy={handleCopy}
              />
              <DesktopPathRow
                label='SQLite Path'
                value={serviceStatus?.sqlitePath || ''}
                onCopy={handleCopy}
              />
              <DesktopPathRow
                label='Data Dir'
                value={serviceStatus?.dataDir || ''}
                onCopy={handleCopy}
              />
            </div>

            <div className='space-y-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-700 dark:bg-gray-800/60'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  访问控制
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  本地单用户认证由配置文件中的 `auth.username` / `auth.password`
                  控制。若需要和网页版共用账号及用户数据，请配置
                  `profile_sync.api_base_url` 指向 Web
                  后端；未配置时保持纯本地模式。
                </p>
                <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
                  首次安装且 `owner`
                  未设置密码时会直接进入应用。若忘记密码，可编辑上方 `Config
                  Path` 对应配置文件，将 `auth.password` 清空后重新打开应用。
                </p>
              </div>
              <div className='rounded-lg border border-gray-200 bg-white px-3 py-3 dark:border-gray-700 dark:bg-gray-900'>
                <div className='flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-200'>
                  <Cloud className='h-3.5 w-3.5 text-gray-500 dark:text-gray-400' />
                  账号同步状态
                </div>
                <div className='mt-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
                  {buildDesktopProfileSyncStatusValue(
                    profileSyncStatus,
                    profileSyncStatusError
                  )}
                </div>
                <p className='mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400'>
                  {buildDesktopProfileSyncStatusDetail(
                    profileSyncStatus,
                    profileSyncStatusError
                  )}
                </p>
                <div className='mt-3'>
                  <DesktopProfileSyncDiagnosticsGrid
                    profileSyncStatus={profileSyncStatus}
                    profileSyncStatusError={profileSyncStatusError}
                  />
                </div>
              </div>
              <div className='grid gap-2 sm:grid-cols-2'>
                <div className='rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'>
                  管理账号：{authStatus?.username || 'owner'}
                </div>
                <div className='rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'>
                  访问密码：{authStatus?.passwordRequired ? '已启用' : '未启用'}
                </div>
              </div>
            </div>

            <div className='space-y-2'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  桌面配置文件
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  这里直接编辑本地 JSON
                  配置。保存后会自动重启本地服务，并刷新桌面运行时配置。
                </p>
              </div>

              <textarea
                value={configText}
                onChange={(event) => setConfigText(event.target.value)}
                spellCheck={false}
                className='min-h-[260px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 shadow-sm transition-colors focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
              />

              <div className='flex justify-end'>
                <button
                  type='button'
                  onClick={() => void handleSaveConfig()}
                  disabled={
                    isRefreshing || isRestarting || isSaving || isDiagnosing
                  }
                  className='inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60'
                >
                  <Save className='h-3.5 w-3.5' />
                  {isSaving ? '保存中...' : '保存并重载服务'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className='rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200'>
            当前运行在浏览器桌面前端模式，Tauri IPC
            不可用。请通过桌面壳运行，才能读取桌面配置文件并控制本地服务。
          </div>
        )}

        {errorMessage ? (
          <div className='rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300'>
            {errorMessage}
          </div>
        ) : null}

        {infoMessage ? (
          <div className='rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300'>
            {infoMessage}
          </div>
        ) : null}
      </section>

      <DiagnosticsModal
        isOpen={isDiagnosticsModalOpen}
        isDiagnosing={isDiagnosing}
        isExporting={isExportingDiagnostics}
        report={diagnosticsReport}
        errorMessage={diagnosticsErrorMessage}
        actionMessage={diagnosticsActionMessage}
        actionErrorMessage={diagnosticsActionErrorMessage}
        onClose={() => {
          if (!isDiagnosing && !isExportingDiagnostics) {
            setIsDiagnosticsModalOpen(false);
          }
        }}
        onRetry={() => void handleRunDiagnostics()}
        onExport={() => void handleExportDiagnosticsLog()}
      />
    </>
  );
}
