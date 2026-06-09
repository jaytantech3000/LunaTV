'use client';

import {
  AlertCircle,
  CheckCircle2,
  Copy,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { BROWSER_AUTH_UPDATED_EVENT } from '@/lib/auth';
import { requestDesktopRuntimeRefresh } from '@/lib/desktop/runtime-config';
import {
  DesktopAuthStatus,
  DesktopLocalServiceStatus,
  getDesktopAuthStatus,
  getLocalServiceStatus,
  isDesktopTauriRuntimeAvailable,
  readDesktopAppConfig,
  startLocalService,
  stopLocalService,
  writeDesktopAppConfig,
} from '@/lib/desktop/tauri-client';

interface DesktopSettingsSectionProps {
  isOpen: boolean;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
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
            aria-label={`复制${label}`}
            title={`复制${label}`}
          >
            <Copy className='h-4 w-4' />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function DesktopSettingsSection({
  isOpen,
}: DesktopSettingsSectionProps) {
  const [ipcAvailable, setIpcAvailable] = useState(false);
  const [serviceStatus, setServiceStatus] =
    useState<DesktopLocalServiceStatus | null>(null);
  const [authStatus, setAuthStatus] = useState<DesktopAuthStatus | null>(null);
  const [configText, setConfigText] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const refreshDesktopState = useCallback(async () => {
    const available = isDesktopTauriRuntimeAvailable();
    setIpcAvailable(available);

    if (!available) {
      setServiceStatus(null);
      setAuthStatus(null);
      return;
    }

    setIsRefreshing(true);
    setErrorMessage('');

    try {
      const [nextStatus, nextConfig, nextAuthStatus] = await Promise.all([
        getLocalServiceStatus(),
        readDesktopAppConfig(),
        getDesktopAuthStatus(),
      ]);

      setServiceStatus(nextStatus);
      setConfigText(JSON.stringify(nextConfig, null, 2));
      setAuthStatus(nextAuthStatus);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
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

  const handleCopy = useCallback(async (value: string) => {
    const didCopy = await copyText(value);
    setInfoMessage(didCopy ? '路径已复制到剪贴板' : '复制失败');
  }, []);

  const handleRestartService = useCallback(async () => {
    if (!ipcAvailable) {
      setErrorMessage(
        '当前运行在浏览器桌面前端模式，无法通过 Tauri IPC 控制本地服务。'
      );
      return;
    }

    setIsRestarting(true);
    setErrorMessage('');

    try {
      if (serviceStatus?.running) {
        await stopLocalService();
      }

      const [nextStatus, nextAuthStatus] = await Promise.all([
        startLocalService(),
        getDesktopAuthStatus(),
      ]);
      setServiceStatus(nextStatus);
      setAuthStatus(nextAuthStatus);
      requestDesktopRuntimeRefresh();
      setInfoMessage('本地服务已重启');
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsRestarting(false);
    }
  }, [ipcAvailable, serviceStatus?.running]);

  const handleSaveConfig = useCallback(async () => {
    if (!ipcAvailable) {
      setErrorMessage(
        '当前运行在浏览器桌面前端模式，无法通过 Tauri IPC 写入桌面配置。'
      );
      return;
    }

    setIsSaving(true);
    setErrorMessage('');

    try {
      const parsedConfig = JSON.parse(configText) as Record<string, unknown>;
      await writeDesktopAppConfig(parsedConfig);
      const [nextStatus, nextAuthStatus] = await Promise.all([
        startLocalService(),
        getDesktopAuthStatus(),
      ]);
      setServiceStatus(nextStatus);
      setAuthStatus(nextAuthStatus);
      requestDesktopRuntimeRefresh();
      window.dispatchEvent(new Event(BROWSER_AUTH_UPDATED_EVENT));
      setInfoMessage('配置已保存，并已重新加载本地服务');
    } catch (error) {
      if (error instanceof SyntaxError) {
        setErrorMessage('配置 JSON 格式无效，请先修正后再保存');
      } else {
        setErrorMessage(getErrorMessage(error));
      }
    } finally {
      setIsSaving(false);
    }
  }, [configText, ipcAvailable]);

  return (
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
              disabled={isRefreshing || isRestarting || isSaving}
              className='inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
              />
              刷新状态
            </button>

            <button
              type='button'
              onClick={() => void handleRestartService()}
              disabled={isRefreshing || isRestarting || isSaving}
              className='inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
            >
              <RotateCcw
                className={`h-3.5 w-3.5 ${isRestarting ? 'animate-spin' : ''}`}
              />
              重启服务
            </button>
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
                控制。若需要和网页版共用帐号及用户数据，请配置
                `profile_sync.api_base_url` 指向 Web
                后端；未配置时保持纯本地模式。
              </p>
            </div>
            <div className='grid gap-2 sm:grid-cols-2'>
              <div className='rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'>
                管理账号：{authStatus?.username || 'owner'}
              </div>
              <div className='rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'>
                访问密码：
                {authStatus?.passwordRequired ? '已启用' : '未启用'}
              </div>
            </div>
          </div>

          <div className='space-y-2'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                桌面配置文件
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
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
                disabled={isRefreshing || isRestarting || isSaving}
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
  );
}
