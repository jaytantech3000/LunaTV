'use client';

import {
  AlertCircle,
  Download,
  HardDriveDownload,
  RefreshCw,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { acquireScrollLock } from '@/lib/scroll-lock';

type DesktopAssetKey =
  | 'mac-arm64'
  | 'mac-x64'
  | 'win-x64-setup'
  | 'win-x64-portable';

type LocalServicePlatformKey =
  | 'mac-arm64'
  | 'mac-x64'
  | 'linux-x64'
  | 'linux-arm64'
  | 'win-x64';

type LocalServiceInstallerPlatformKey = 'mac-arm64' | 'mac-x64';
type LocalServiceMaintenanceAction = 'stop' | 'uninstall';

interface DesktopReleaseAsset {
  downloadPath: string;
  key: DesktopAssetKey;
  label: string;
  name: string;
  size: number;
}

interface DesktopReleasePayload {
  assets: DesktopReleaseAsset[];
  missingAssetKeys: DesktopAssetKey[];
  publishedAt: string | null;
  releaseId: number;
  version: string;
}

interface LocalServiceReleasePayload {
  configuredPlatforms: LocalServicePlatformKey[];
  displayName: string | null;
  installerPlatforms: LocalServiceInstallerPlatformKey[];
  publishedAt: string | null;
  version: string;
}

interface DownloadClientPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type LocalServiceStatus = 'available' | 'unknown' | 'unavailable';
type RecommendedTargets = {
  desktop?: DesktopAssetKey;
  localService?: LocalServicePlatformKey;
};

interface NavigatorUserAgentDataValues {
  architecture?: string;
  bitness?: string;
  platform?: string;
}

interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: {
    getHighEntropyValues?: (
      hints: Array<'architecture' | 'bitness' | 'platform'>
    ) => Promise<NavigatorUserAgentDataValues>;
    platform?: string;
  };
}

const DESKTOP_ASSET_META: Array<{
  extensionLabel: string;
  key: DesktopAssetKey;
  label: string;
}> = [
  {
    extensionLabel: '.dmg',
    key: 'mac-arm64',
    label: 'macOS Apple Silicon',
  },
  {
    extensionLabel: '.dmg',
    key: 'mac-x64',
    label: 'macOS Intel',
  },
  {
    extensionLabel: '.exe',
    key: 'win-x64-setup',
    label: 'Windows 安装包',
  },
  {
    extensionLabel: '.zip',
    key: 'win-x64-portable',
    label: 'Windows 便携版',
  },
];

const LOCAL_SERVICE_META: Array<{
  key: LocalServicePlatformKey;
  label: string;
}> = [
  { key: 'mac-arm64', label: 'macOS Apple Silicon' },
  { key: 'mac-x64', label: 'macOS Intel' },
  { key: 'linux-x64', label: 'Linux x64' },
  { key: 'linux-arm64', label: 'Linux ARM64' },
  { key: 'win-x64', label: 'Windows x64' },
];

function createUnknownLocalServiceStatuses(): Record<
  LocalServicePlatformKey,
  LocalServiceStatus
> {
  return {
    'linux-arm64': 'unknown',
    'linux-x64': 'unknown',
    'mac-arm64': 'unknown',
    'mac-x64': 'unknown',
    'win-x64': 'unknown',
  };
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return '--';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${
    value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)
  } ${units[unitIndex]}`;
}

function formatPublishedAt(value: string | null): string {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString('zh-CN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function isArmArchitecture(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase() || '';
  return normalized.includes('arm') || normalized.includes('aarch');
}

function resolveRecommendedTargetsForPlatform(
  platform: string,
  prefersArmArchitecture: boolean
): RecommendedTargets {
  const normalizedPlatform = platform.toLowerCase();

  if (normalizedPlatform.includes('mac')) {
    return prefersArmArchitecture
      ? {
          desktop: 'mac-arm64',
          localService: 'mac-arm64',
        }
      : {
          desktop: 'mac-x64',
          localService: 'mac-x64',
        };
  }

  if (normalizedPlatform.includes('windows')) {
    return {
      desktop: 'win-x64-setup',
      localService: 'win-x64',
    };
  }

  if (normalizedPlatform.includes('linux')) {
    return prefersArmArchitecture
      ? { localService: 'linux-arm64' }
      : { localService: 'linux-x64' };
  }

  return {};
}

function detectRecommendedTargetsFromUserAgent(
  userAgent: string
): RecommendedTargets {
  const normalizedUserAgent = userAgent.toLowerCase();

  if (normalizedUserAgent.includes('mac os x')) {
    return isArmArchitecture(normalizedUserAgent)
      ? {
          desktop: 'mac-arm64',
          localService: 'mac-arm64',
        }
      : {
          desktop: 'mac-x64',
          localService: 'mac-x64',
        };
  }

  if (normalizedUserAgent.includes('windows')) {
    return {
      desktop: 'win-x64-setup',
      localService: 'win-x64',
    };
  }

  if (normalizedUserAgent.includes('linux')) {
    return isArmArchitecture(normalizedUserAgent)
      ? { localService: 'linux-arm64' }
      : { localService: 'linux-x64' };
  }

  return {};
}

function detectRecommendedTargetsSync(): RecommendedTargets {
  if (typeof navigator === 'undefined') {
    return {};
  }

  return detectRecommendedTargetsFromUserAgent(navigator.userAgent);
}

async function detectRecommendedTargets(): Promise<RecommendedTargets> {
  if (typeof navigator === 'undefined') {
    return {};
  }

  const navigatorWithUserAgentData = navigator as NavigatorWithUserAgentData;
  const userAgentData = navigatorWithUserAgentData.userAgentData;

  if (userAgentData?.getHighEntropyValues) {
    try {
      const userAgentDataValues = await userAgentData.getHighEntropyValues([
        'architecture',
        'bitness',
        'platform',
      ]);
      const platform =
        userAgentDataValues.platform || userAgentData.platform || '';
      const recommendedTargets = resolveRecommendedTargetsForPlatform(
        platform,
        isArmArchitecture(userAgentDataValues.architecture)
      );

      if (recommendedTargets.desktop || recommendedTargets.localService) {
        return recommendedTargets;
      }
    } catch {
      // Fall back to the legacy user-agent heuristic below.
    }
  }

  return detectRecommendedTargetsSync();
}

function isLocalServiceInstallerPlatform(
  value: LocalServicePlatformKey
): value is LocalServiceInstallerPlatformKey {
  return value === 'mac-arm64' || value === 'mac-x64';
}

function getLocalServiceDownloadConfig(
  platform: LocalServicePlatformKey,
  installerPlatforms: Set<LocalServiceInstallerPlatformKey>
): {
  ariaLabelSuffix: string;
  description: string;
  href: string;
  label: string;
} {
  if (
    isLocalServiceInstallerPlatform(platform) &&
    installerPlatforms.has(platform)
  ) {
    return {
      ariaLabelSuffix: '安装包下载',
      description: '下载 macOS 安装包 (.pkg)，双击即可安装并自动启动',
      href: `/api/client-download?kind=local-service-installer&platform=${platform}`,
      label: '下载安装包',
    };
  }

  if (platform === 'win-x64') {
    return {
      ariaLabelSuffix: '脚本下载',
      description: '下载 PowerShell 脚本 (.ps1)',
      href: `/api/local-service-script?platform=${platform}`,
      label: '下载脚本',
    };
  }

  return {
    ariaLabelSuffix: '脚本下载',
    description: '下载 shell 脚本 (.sh)',
    href: `/api/local-service-script?platform=${platform}`,
    label: '下载脚本',
  };
}

function buildLocalServiceScriptHref(
  platform: LocalServicePlatformKey,
  action: LocalServiceMaintenanceAction
): string {
  return `/api/local-service-script?platform=${platform}&action=${action}`;
}

function getLocalServiceMaintenanceActions(
  platform: LocalServicePlatformKey
): Array<{
  action: LocalServiceMaintenanceAction;
  ariaLabelSuffix: string;
  href: string;
  label: string;
}> {
  return [
    {
      action: 'stop',
      ariaLabelSuffix: '停止脚本下载',
      href: buildLocalServiceScriptHref(platform, 'stop'),
      label: '下载停止脚本',
    },
    {
      action: 'uninstall',
      ariaLabelSuffix: '卸载脚本下载',
      href: buildLocalServiceScriptHref(platform, 'uninstall'),
      label: '下载卸载脚本',
    },
  ];
}

export default function DownloadClientPanel({
  isOpen,
  onClose,
}: DownloadClientPanelProps) {
  const [desktopError, setDesktopError] = useState<string | null>(null);
  const [desktopLoading, setDesktopLoading] = useState(false);
  const [desktopRelease, setDesktopRelease] =
    useState<DesktopReleasePayload | null>(null);
  const [localServiceError, setLocalServiceError] = useState<string | null>(
    null
  );
  const [localServiceLoading, setLocalServiceLoading] = useState(false);
  const [localServiceRelease, setLocalServiceRelease] =
    useState<LocalServiceReleasePayload | null>(null);
  const [localServiceStatuses, setLocalServiceStatuses] = useState<
    Record<LocalServicePlatformKey, LocalServiceStatus>
  >(createUnknownLocalServiceStatuses);
  const [mounted, setMounted] = useState(false);
  const [recommendedTargets, setRecommendedTargets] =
    useState<RecommendedTargets>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void detectRecommendedTargets().then((nextTargets) => {
      if (!cancelled) {
        setRecommendedTargets(nextTargets);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      return acquireScrollLock({
        lockHtml: true,
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    let cancelled = false;

    setDesktopLoading(true);
    setDesktopError(null);
    setLocalServiceLoading(true);
    setLocalServiceError(null);
    setLocalServiceRelease(null);
    setLocalServiceStatuses(createUnknownLocalServiceStatuses());

    const loadDesktopRelease = async () => {
      try {
        const response = await fetch('/api/desktop-release', {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(payload?.error || '桌面版信息加载失败');
        }

        if (cancelled) {
          return;
        }

        setDesktopRelease(payload as DesktopReleasePayload);
        setDesktopError(null);
      } catch (error) {
        if (cancelled || controller.signal.aborted) {
          return;
        }

        setDesktopRelease(null);
        setDesktopError(
          error instanceof Error ? error.message : '桌面版信息加载失败'
        );
      } finally {
        if (!cancelled) {
          setDesktopLoading(false);
        }
      }
    };

    const loadLocalServiceRelease = async () => {
      const response = await fetch('/api/local-service-release', {
        cache: 'no-store',
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || '本地服务信息加载失败');
      }

      if (cancelled || controller.signal.aborted) {
        return;
      }

      const releasePayload = payload as LocalServiceReleasePayload;
      const availablePlatforms = new Set(releasePayload.configuredPlatforms);
      const nextStatuses = createUnknownLocalServiceStatuses();

      LOCAL_SERVICE_META.forEach(({ key }) => {
        nextStatuses[key] = availablePlatforms.has(key)
          ? 'available'
          : 'unavailable';
      });

      setLocalServiceRelease(releasePayload);
      setLocalServiceStatuses(nextStatuses);
      setLocalServiceError(null);
    };

    void loadDesktopRelease();
    void loadLocalServiceRelease()
      .catch((error) => {
        if (cancelled || controller.signal.aborted) {
          return;
        }

        setLocalServiceRelease(null);
        setLocalServiceError(
          error instanceof Error
            ? error.message
            : '本地服务信息加载失败，仍可尝试直接下载脚本。'
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLocalServiceLoading(false);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [isOpen, reloadKey]);

  if (!mounted || !isOpen) {
    return null;
  }

  const recommendedLocalServicePlatform = recommendedTargets.localService;
  const localServiceInstallerPlatforms = new Set(
    localServiceRelease?.installerPlatforms ?? []
  );
  const desktopAssetMap = new Map(
    desktopRelease?.assets.map((asset) => [asset.key, asset]) || []
  );

  const handleDownload = (href: string) => {
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const panelContent = (
    <>
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={onClose}
        onTouchMove={(event) => {
          event.preventDefault();
        }}
        onWheel={(event) => {
          event.preventDefault();
        }}
        style={{ touchAction: 'none' }}
      />

      <div
        aria-modal='true'
        className='fixed top-1/2 left-1/2 z-[1001] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-900'
        role='dialog'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='flex items-center justify-between border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6'>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'>
              <HardDriveDownload className='h-5 w-5' />
            </div>
            <div>
              <h3 className='text-lg font-bold text-gray-900 dark:text-gray-100 sm:text-xl'>
                客户端下载
              </h3>
              <p className='text-xs text-gray-500 dark:text-gray-400 sm:text-sm'>
                桌面版安装包与本地服务脚本均通过本站接口分发
              </p>
            </div>
          </div>
          <button
            aria-label='关闭'
            className='flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800'
            onClick={onClose}
            type='button'
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        <div className='max-h-[80vh] space-y-5 overflow-y-auto p-4 sm:p-6'>
          <section className='rounded-xl border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-700 dark:bg-gray-800/40'>
            <div className='mb-4 flex items-start justify-between gap-3'>
              <div>
                <div className='flex items-center gap-2'>
                  <Download className='h-4 w-4 text-blue-500' />
                  <h4 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                    桌面版
                  </h4>
                  <span className='rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'>
                    推荐
                  </span>
                </div>
                <p className='mt-1 text-sm text-gray-600 dark:text-gray-300'>
                  最新桌面端 prerelease 安装包
                </p>
              </div>
              <button
                className='inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-white dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                onClick={() => setReloadKey((value) => value + 1)}
                type='button'
              >
                <RefreshCw className='h-4 w-4' />
                刷新
              </button>
            </div>

            {desktopLoading && (
              <div className='rounded-lg border border-dashed border-gray-300 bg-white/80 px-4 py-6 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300'>
                <div className='flex items-center gap-2'>
                  <RefreshCw className='h-4 w-4 animate-spin' />
                  正在加载桌面版信息...
                </div>
              </div>
            )}

            {!desktopLoading && desktopError && (
              <div className='rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300'>
                <div className='flex items-start gap-2'>
                  <AlertCircle className='mt-0.5 h-4 w-4 flex-shrink-0' />
                  <div className='space-y-3'>
                    <p>{desktopError}</p>
                    <button
                      className='inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-700'
                      onClick={() => setReloadKey((value) => value + 1)}
                      type='button'
                    >
                      <RefreshCw className='h-4 w-4' />
                      重试
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!desktopLoading && desktopRelease && (
              <div className='space-y-4'>
                <div className='grid gap-3 rounded-lg bg-white/90 p-4 dark:bg-gray-900/40 sm:grid-cols-2'>
                  <div>
                    <div className='text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400'>
                      版本
                    </div>
                    <div className='mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100'>
                      {desktopRelease.version}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400'>
                      发布时间
                    </div>
                    <div className='mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100'>
                      {formatPublishedAt(desktopRelease.publishedAt)}
                    </div>
                  </div>
                </div>

                <div className='space-y-3'>
                  {DESKTOP_ASSET_META.map((meta) => {
                    const asset = desktopAssetMap.get(meta.key);
                    const isRecommended =
                      recommendedTargets.desktop === meta.key;

                    return (
                      <div
                        className={`flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${
                          isRecommended
                            ? 'border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/15'
                            : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/30'
                        }`}
                        key={meta.key}
                      >
                        <div>
                          <div className='flex flex-wrap items-center gap-2'>
                            <span className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                              {meta.label}
                            </span>
                            {isRecommended && (
                              <span className='rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'>
                                当前设备
                              </span>
                            )}
                            {!asset && (
                              <span className='rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300'>
                                暂未提供
                              </span>
                            )}
                          </div>
                          <div className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                            {asset
                              ? `${asset.name} · ${formatFileSize(asset.size)}`
                              : '该平台安装包当前不可用'}
                          </div>
                        </div>
                        <button
                          aria-label={`${meta.label} 下载`}
                          className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                            asset
                              ? 'bg-blue-600 text-white hover:bg-blue-700'
                              : 'cursor-not-allowed bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                          }`}
                          disabled={!asset}
                          onClick={() =>
                            asset && handleDownload(asset.downloadPath)
                          }
                          type='button'
                        >
                          <Download className='h-4 w-4' />
                          下载 {meta.extensionLabel}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className='rounded-xl border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-700 dark:bg-gray-800/40'>
            <div className='mb-4'>
              <div className='flex items-center gap-2'>
                <TerminalSquare className='h-4 w-4 text-emerald-500' />
                <h4 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                  本地服务
                </h4>
              </div>
              <p className='mt-1 text-sm text-gray-600 dark:text-gray-300'>
                安装后视频流量走本机，不经过 Vercel。macOS
                提供双击安装包，Windows / Linux 提供脚本安装。
              </p>
            </div>

            {localServiceLoading && (
              <div className='mb-3 rounded-lg border border-dashed border-gray-300 bg-white/80 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300'>
                <div className='flex items-center gap-2'>
                  <RefreshCw className='h-4 w-4 animate-spin' />
                  正在检测本地服务安装文件可用性...
                </div>
              </div>
            )}

            {localServiceError && (
              <div className='mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200'>
                {localServiceError}
              </div>
            )}

            {!localServiceLoading && localServiceRelease && (
              <div className='mb-4 grid gap-3 rounded-lg bg-white/90 p-4 dark:bg-gray-900/40 sm:grid-cols-2'>
                <div>
                  <div className='text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400'>
                    版本号
                  </div>
                  <div className='mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100'>
                    {localServiceRelease.version}
                  </div>
                  {localServiceRelease.displayName &&
                    localServiceRelease.displayName !==
                      localServiceRelease.version && (
                      <div className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                        {localServiceRelease.displayName}
                      </div>
                    )}
                </div>
                <div>
                  <div className='text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400'>
                    发布时间
                  </div>
                  <div className='mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100'>
                    {formatPublishedAt(localServiceRelease.publishedAt)}
                  </div>
                </div>
              </div>
            )}

            {recommendedLocalServicePlatform && (
              <div className='mb-4 rounded-lg border border-emerald-200/80 bg-white/90 p-4 dark:border-emerald-900/40 dark:bg-gray-900/40'>
                <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                  <div>
                    <div className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                      管理当前设备上的本地服务
                    </div>
                    <div className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                      页面内可直接停用加速回退默认线路；如果还想停止进程或彻底移除安装，可下载下面的管理脚本。macOS
                      卸载会请求管理员授权。
                    </div>
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    {getLocalServiceMaintenanceActions(
                      recommendedLocalServicePlatform
                    ).map((item) => (
                      <button
                        aria-label={`${
                          LOCAL_SERVICE_META.find(
                            (meta) =>
                              meta.key === recommendedLocalServicePlatform
                          )?.label || recommendedLocalServicePlatform
                        } ${item.ariaLabelSuffix}`}
                        className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          item.action === 'uninstall'
                            ? 'border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200 dark:hover:bg-amber-900/30'
                            : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-200 dark:hover:bg-gray-800/60'
                        }`}
                        key={item.action}
                        onClick={() => handleDownload(item.href)}
                        type='button'
                      >
                        <Download className='h-4 w-4' />
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className='space-y-3'>
              {LOCAL_SERVICE_META.map((meta) => {
                const status = localServiceStatuses[meta.key];
                const isUnavailable = status === 'unavailable';
                const isRecommended =
                  recommendedTargets.localService === meta.key;
                const downloadConfig = getLocalServiceDownloadConfig(
                  meta.key,
                  localServiceInstallerPlatforms
                );

                return (
                  <div
                    className={`flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${
                      isRecommended
                        ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-900/15'
                        : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/30'
                    }`}
                    key={meta.key}
                  >
                    <div>
                      <div className='flex flex-wrap items-center gap-2'>
                        <span className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {meta.label}
                        </span>
                        {isRecommended && (
                          <span className='rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'>
                            当前设备
                          </span>
                        )}
                        {isUnavailable && (
                          <span className='rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300'>
                            暂未开放
                          </span>
                        )}
                      </div>
                      <div className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                        {downloadConfig.description}
                      </div>
                    </div>
                    <button
                      aria-label={`${meta.label} ${downloadConfig.ariaLabelSuffix}`}
                      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isUnavailable
                          ? 'cursor-not-allowed bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                          : 'bg-emerald-600 text-white hover:bg-emerald-700'
                      }`}
                      disabled={isUnavailable}
                      onClick={() =>
                        !isUnavailable && handleDownload(downloadConfig.href)
                      }
                      type='button'
                    >
                      <Download className='h-4 w-4' />
                      {downloadConfig.label}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </>
  );

  return createPortal(panelContent, document.body);
}
