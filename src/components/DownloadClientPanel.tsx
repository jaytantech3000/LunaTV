'use client';

import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
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

type LocalServiceInstallerPlatformKey = LocalServicePlatformKey;
type LocalServiceMaintenanceAction = 'stop' | 'uninstall';
type LocalServiceDownloadAction = {
  ariaLabelSuffix: string;
  href: string;
  label: string;
};
type LocalServiceUninstallGuide = {
  description: string;
  fallbackAction?: LocalServiceDownloadAction;
  steps: string[];
};
type MacArchitecture = 'arm64' | 'x64';
type RecommendedTargets = {
  desktop?: DesktopAssetKey;
  localService?: LocalServicePlatformKey;
};
type LocalServiceReleaseStatus = 'release' | 'direct-url' | 'missing';

interface NavigatorUserAgentDataValues {
  architecture?: string;
  bitness?: string;
  platform?: string;
}

interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: {
    architecture?: string;
    getHighEntropyValues?: (
      hints: Array<'architecture' | 'bitness' | 'platform'>
    ) => Promise<NavigatorUserAgentDataValues>;
    platform?: string;
  };
}

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
  availablePlatforms: LocalServicePlatformKey[];
  configuredPlatforms: LocalServicePlatformKey[];
  displayName: string | null;
  installerPlatforms: LocalServiceInstallerPlatformKey[];
  publishedAt: string | null;
  releaseStatus: LocalServiceReleaseStatus;
  version: string;
}

interface DownloadClientPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type LocalServiceStatus = 'available' | 'unknown' | 'unavailable';

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

function createMacRecommendedTargets(
  architecture: MacArchitecture
): RecommendedTargets {
  return architecture === 'arm64'
    ? {
        desktop: 'mac-arm64',
        localService: 'mac-arm64',
      }
    : {
        desktop: 'mac-x64',
        localService: 'mac-x64',
      };
}

function parseArchitectureToken(
  value: string | null | undefined
): MacArchitecture | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (
    normalized.includes('arm64') ||
    normalized.includes('aarch64') ||
    normalized === 'arm'
  ) {
    return 'arm64';
  }

  if (
    normalized.includes('x86') ||
    normalized.includes('x64') ||
    normalized.includes('amd64') ||
    normalized.includes('intel')
  ) {
    return 'x64';
  }

  return null;
}

function parseMacArchitectureFromUserAgent(
  userAgent: string
): MacArchitecture | null {
  const normalized = userAgent.toLowerCase();

  if (
    normalized.includes('arm64') ||
    normalized.includes('aarch64') ||
    normalized.includes(' arm')
  ) {
    return 'arm64';
  }

  if (normalized.includes('x86_64') || normalized.includes('amd64')) {
    return 'x64';
  }

  return null;
}

function getNavigatorUAData():
  | NavigatorWithUserAgentData['userAgentData']
  | null {
  if (typeof navigator === 'undefined') {
    return null;
  }

  return (navigator as NavigatorWithUserAgentData).userAgentData || null;
}

function detectRecommendedTargetsSync(): {
  needsMacRefinement: boolean;
  targets: RecommendedTargets;
} {
  if (typeof navigator === 'undefined') {
    return {
      needsMacRefinement: false,
      targets: {},
    };
  }

  const userAgent = navigator.userAgent.toLowerCase();

  if (userAgent.includes('mac os x')) {
    const macArchitecture =
      parseMacArchitectureFromUserAgent(userAgent) ||
      parseArchitectureToken(getNavigatorUAData()?.architecture);

    return {
      needsMacRefinement: !macArchitecture,
      targets: macArchitecture
        ? createMacRecommendedTargets(macArchitecture)
        : {},
    };
  }

  if (userAgent.includes('windows')) {
    return {
      needsMacRefinement: false,
      targets: {
        desktop: 'win-x64-setup',
        localService: 'win-x64',
      },
    };
  }

  if (userAgent.includes('linux')) {
    return {
      needsMacRefinement: false,
      targets:
        userAgent.includes('arm') || userAgent.includes('aarch64')
          ? { localService: 'linux-arm64' }
          : { localService: 'linux-x64' },
    };
  }

  return {
    needsMacRefinement: false,
    targets: {},
  };
}

async function detectMacArchitectureFromUserAgentData(): Promise<MacArchitecture | null> {
  const userAgentData = getNavigatorUAData();
  if (!userAgentData) {
    return null;
  }

  const platform = userAgentData.platform?.toLowerCase();
  if (platform && !platform.includes('mac')) {
    return null;
  }

  const directArchitecture = parseArchitectureToken(userAgentData.architecture);
  if (directArchitecture) {
    return directArchitecture;
  }

  if (typeof userAgentData.getHighEntropyValues !== 'function') {
    return null;
  }

  try {
    const values = await userAgentData.getHighEntropyValues([
      'architecture',
      'bitness',
      'platform',
    ]);
    const highEntropyPlatform =
      typeof values.platform === 'string'
        ? values.platform.toLowerCase()
        : null;

    if (highEntropyPlatform && !highEntropyPlatform.includes('mac')) {
      return null;
    }

    return parseArchitectureToken(
      typeof values.architecture === 'string' ? values.architecture : null
    );
  } catch {
    return null;
  }
}

function detectMacArchitectureFromWebGl(): MacArchitecture | null {
  if (typeof document === 'undefined') {
    return null;
  }

  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');

    if (!context) {
      return null;
    }

    const rendererInfo = context.getExtension('WEBGL_debug_renderer_info');
    const rawRenderer = rendererInfo
      ? context.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)
      : context.getParameter(context.RENDERER);
    const renderer =
      typeof rawRenderer === 'string' ? rawRenderer.toLowerCase() : '';

    if (
      renderer.includes('apple') ||
      /(?:^|[^a-z0-9])m[1-9](?:[^a-z0-9]|$)/.test(renderer)
    ) {
      return 'arm64';
    }

    if (
      renderer.includes('intel') ||
      renderer.includes('amd') ||
      renderer.includes('radeon') ||
      renderer.includes('nvidia') ||
      renderer.includes('geforce')
    ) {
      return 'x64';
    }
  } catch {
    return null;
  }

  return null;
}

async function detectRecommendedTargets(): Promise<RecommendedTargets> {
  const syncDetection = detectRecommendedTargetsSync();
  if (!syncDetection.needsMacRefinement) {
    return syncDetection.targets;
  }

  const macArchitecture =
    (await detectMacArchitectureFromUserAgentData()) ||
    detectMacArchitectureFromWebGl();

  return createMacRecommendedTargets(macArchitecture || 'x64');
}

function buildLocalServiceScriptDownloadAction(
  platform: LocalServicePlatformKey
): LocalServiceDownloadAction {
  return {
    ariaLabelSuffix: '脚本下载',
    href: `/api/local-service-script?platform=${platform}`,
    label: '下载脚本',
  };
}

function buildLocalServiceMaintenanceDownloadAction(
  params: {
    action: LocalServiceMaintenanceAction;
    ariaLabelSuffix: string;
    label: string;
    platform: LocalServicePlatformKey;
  }
): LocalServiceDownloadAction {
  return {
    ariaLabelSuffix: params.ariaLabelSuffix,
    href: buildLocalServiceScriptHref(params.platform, params.action),
    label: params.label,
  };
}

function getLocalServiceDownloadConfig(
  platform: LocalServicePlatformKey,
  installerPlatforms: Set<LocalServiceInstallerPlatformKey>
): {
  description: string;
  primaryAction: LocalServiceDownloadAction;
  secondaryAction?: LocalServiceDownloadAction;
} {
  if (installerPlatforms.has(platform)) {
    return {
      description:
        platform === 'win-x64'
          ? '提供 Windows 安装包 (.exe)，双击安装后自动启动'
          : platform.startsWith('linux-')
          ? '提供 Debian / Ubuntu 安装包 (.deb)，自动注册 systemd；其他发行版可改用脚本'
          : '提供 macOS 安装包 (.pkg)，双击安装后自动启动',
      primaryAction: {
        ariaLabelSuffix: '安装包下载',
        href: `/api/client-download?kind=local-service-installer&platform=${platform}`,
        label: '下载安装包',
      },
      secondaryAction: platform.startsWith('linux-')
        ? buildLocalServiceScriptDownloadAction(platform)
        : undefined,
    };
  }

  return {
    description:
      platform === 'win-x64'
        ? '提供 PowerShell 脚本 (.ps1)'
        : '提供 shell 脚本 (.sh)',
    primaryAction: buildLocalServiceScriptDownloadAction(platform),
  };
}

function buildLocalServiceScriptHref(
  platform: LocalServicePlatformKey,
  action: LocalServiceMaintenanceAction
): string {
  return `/api/local-service-script?platform=${platform}&action=${action}`;
}

function getLocalServicePlatformLabel(platform: LocalServicePlatformKey): string {
  return (
    LOCAL_SERVICE_META.find((meta) => meta.key === platform)?.label || platform
  );
}

function getLocalServiceStopAction(
  platform: LocalServicePlatformKey
): LocalServiceDownloadAction {
  return buildLocalServiceMaintenanceDownloadAction({
    action: 'stop',
    ariaLabelSuffix: '停止脚本下载',
    label: '下载停止脚本',
    platform,
  });
}

function getLocalServiceUninstallGuide(
  platform: LocalServicePlatformKey,
  installerPlatforms: Set<LocalServiceInstallerPlatformKey>
): LocalServiceUninstallGuide {
  const fallbackAction = buildLocalServiceMaintenanceDownloadAction({
    action: 'uninstall',
    ariaLabelSuffix: '兜底卸载脚本下载',
    label: '下载卸载脚本',
    platform,
  });

  if (!installerPlatforms.has(platform)) {
    return {
      description: '当前平台仍以脚本安装为主，直接运行卸载脚本即可清理服务文件。',
      fallbackAction,
      steps: [
        '下载并运行卸载脚本，会停止本地服务并移除安装目录。',
        '如果之前装过更早期版本，卸载脚本也会顺带清理旧版 ~/.lunatv 遗留文件。',
      ],
    };
  }

  if (platform.startsWith('mac-')) {
    return {
      description: '优先使用安装包自带的卸载器，只有旧版脚本安装才需要兜底脚本。',
      fallbackAction,
      steps: [
        '打开“应用程序 / LunaTV Local Service”，双击 `uninstall-local-service.command`。',
        '卸载器会请求管理员授权，并移除 LaunchDaemon、服务目录和日志目录。',
      ],
    };
  }

  if (platform === 'win-x64') {
    return {
      description: '优先通过系统已安装应用卸载，安装包也会写入本地卸载入口。',
      fallbackAction,
      steps: [
        '打开“设置 > 应用 > 已安装的应用”，卸载 “LunaTV Local Service”。',
        '如果系统列表里暂时没显示，也可运行 `%LOCALAPPDATA%\\LunaTV Local Service\\uninstall-local-service.cmd`。',
      ],
    };
  }

  return {
    description: 'Debian / Ubuntu 优先走系统包管理器卸载，脚本只保留给旧版脚本安装兜底。',
    fallbackAction,
    steps: [
      '可以直接在系统软件中心移除 `lunatv-local-service`。',
      '命令行可执行 `sudo apt remove lunatv-local-service`；没有 apt 时可用 `sudo dpkg -r lunatv-local-service`。',
      '如果当初是脚本安装，再使用下面的兜底卸载脚本。',
    ],
  };
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
    useState<RecommendedTargets>(() => detectRecommendedTargetsSync().targets);
  const [reloadKey, setReloadKey] = useState(0);
  const [showUninstallGuide, setShowUninstallGuide] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void detectRecommendedTargets().then((targets) => {
      if (!cancelled) {
        setRecommendedTargets(targets);
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
      setShowUninstallGuide(false);
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
      const availablePlatforms = new Set(releasePayload.availablePlatforms);
      const installerPlatforms = new Set(releasePayload.installerPlatforms);
      const nextStatuses = createUnknownLocalServiceStatuses();

      LOCAL_SERVICE_META.forEach(({ key }) => {
        nextStatuses[key] =
          availablePlatforms.has(key) || installerPlatforms.has(key)
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
  const localServiceBinaryPlatforms = new Set(
    localServiceRelease?.availablePlatforms ?? []
  );
  const localServiceInstallerPlatforms = new Set(
    localServiceRelease?.installerPlatforms ?? []
  );
  const recommendedLocalServiceLabel = recommendedLocalServicePlatform
    ? getLocalServicePlatformLabel(recommendedLocalServicePlatform)
    : null;
  const localServiceStopAction = recommendedLocalServicePlatform
    ? getLocalServiceStopAction(recommendedLocalServicePlatform)
    : null;
  const localServiceUninstallGuide = recommendedLocalServicePlatform
    ? getLocalServiceUninstallGuide(
        recommendedLocalServicePlatform,
        localServiceInstallerPlatforms
      )
    : null;
  const localServiceUninstallFallbackAction =
    localServiceUninstallGuide?.fallbackAction ?? null;
  const desktopAssetMap = new Map(
    desktopRelease?.assets.map((asset) => [asset.key, asset]) || []
  );

  const handleDownload = (href: string) => {
    window.open(href, '_blank', 'noopener,noreferrer');
  };
  const UninstallGuideToggleIcon = showUninstallGuide ? ChevronUp : ChevronDown;

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
                桌面版安装包与本地服务安装文件均通过本站接口分发
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
                安装后视频流量走本机，不经过 Vercel。macOS / Windows
                优先提供双击安装包，Linux 优先提供 Debian / Ubuntu
                安装包，并保留脚本兜底。
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

            {!localServiceLoading &&
              localServiceRelease?.releaseStatus === 'missing' && (
                <div className='mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200'>
                  当前发布通道暂未找到可下载的本地服务产物，安装入口已禁用。请先发布对应的
                  local-service release，再刷新此面板。
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
              <div className='mb-4 rounded-xl border border-emerald-200/80 bg-white/90 p-4 dark:border-emerald-900/40 dark:bg-gray-900/40'>
                <div className='grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
                  <div className='min-w-0'>
                    <div className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                      管理当前设备上的本地服务
                    </div>
                    <div className='mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400'>
                      页面内可先停用加速回退默认线路；彻底卸载优先走系统自带入口，这里保留停止脚本和当前平台说明。
                    </div>
                  </div>
                  <div className='flex w-full flex-col gap-2 sm:w-[10.75rem] sm:justify-self-end'>
                    {localServiceStopAction && recommendedLocalServiceLabel && (
                      <button
                        aria-label={`${recommendedLocalServiceLabel} ${localServiceStopAction.ariaLabelSuffix}`}
                        className='inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-200 dark:hover:bg-gray-800/60'
                        onClick={() =>
                          handleDownload(localServiceStopAction.href)
                        }
                        type='button'
                      >
                        <Download className='h-4 w-4' />
                        {localServiceStopAction.label}
                      </button>
                    )}
                    {recommendedLocalServiceLabel && (
                      <button
                        aria-expanded={showUninstallGuide}
                        aria-label={`${recommendedLocalServiceLabel} 卸载方式`}
                        className='inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200 dark:hover:bg-amber-900/30'
                        onClick={() =>
                          setShowUninstallGuide((value) => !value)
                        }
                        type='button'
                      >
                        <UninstallGuideToggleIcon className='h-4 w-4' />
                        {showUninstallGuide ? '收起卸载方式' : '查看卸载方式'}
                      </button>
                    )}
                  </div>
                </div>

                {showUninstallGuide &&
                  localServiceUninstallGuide &&
                  recommendedLocalServiceLabel && (
                    <div className='mt-4 rounded-lg border border-amber-200/80 bg-amber-50/80 p-4 dark:border-amber-900/40 dark:bg-amber-900/10'>
                      <div className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                        {recommendedLocalServiceLabel} 卸载方式
                      </div>
                      <div className='mt-1 text-xs text-gray-600 dark:text-gray-300'>
                        {localServiceUninstallGuide.description}
                      </div>
                      <div className='mt-3 space-y-2'>
                        {localServiceUninstallGuide.steps.map((step) => (
                          <div
                            className='rounded-lg bg-white/80 px-3 py-2 text-sm leading-6 text-gray-700 dark:bg-gray-900/30 dark:text-gray-200'
                            key={step}
                          >
                            {step}
                          </div>
                        ))}
                      </div>
                      {localServiceUninstallFallbackAction && (
                        <div className='mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start'>
                          <div className='text-xs leading-5 text-gray-500 dark:text-gray-400'>
                            仅在旧版脚本安装或系统原生卸载入口不可用时，才需要下面这个兜底脚本。
                          </div>
                          <button
                            aria-label={`${recommendedLocalServiceLabel} ${localServiceUninstallFallbackAction.ariaLabelSuffix}`}
                            className='inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 sm:w-[10.75rem] dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-200 dark:hover:bg-gray-800/60'
                            onClick={() =>
                              handleDownload(
                                localServiceUninstallFallbackAction.href
                              )
                            }
                            type='button'
                          >
                            <Download className='h-4 w-4' />
                            {localServiceUninstallFallbackAction.label}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
              </div>
            )}

            <div className='space-y-3'>
              {LOCAL_SERVICE_META.map((meta) => {
                const isPrimaryUnavailable =
                  localServiceStatuses[meta.key] === 'unavailable';
                const isRecommended =
                  recommendedTargets.localService === meta.key;
                const downloadConfig = getLocalServiceDownloadConfig(
                  meta.key,
                  localServiceInstallerPlatforms
                );
                const secondaryAction = downloadConfig.secondaryAction;
                const isSecondaryUnavailable =
                  Boolean(secondaryAction) &&
                  !localServiceBinaryPlatforms.has(meta.key);

                return (
                  <div
                    className={`grid gap-4 rounded-xl border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${
                      isRecommended
                        ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-900/15'
                        : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/30'
                    }`}
                    key={meta.key}
                  >
                    <div className='min-w-0'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <span className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {meta.label}
                        </span>
                        {isRecommended && (
                          <span className='rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'>
                            当前设备
                          </span>
                        )}
                        {isPrimaryUnavailable && (
                          <span className='rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300'>
                            暂未开放
                          </span>
                        )}
                      </div>
                      <div className='mt-2 text-sm leading-5 text-gray-500 dark:text-gray-400'>
                        {downloadConfig.description}
                      </div>
                    </div>
                    <div className='flex w-full flex-col gap-2 sm:w-[10.75rem] sm:justify-self-end'>
                      <button
                        aria-label={`${meta.label} ${downloadConfig.primaryAction.ariaLabelSuffix}`}
                        className={`inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                          isPrimaryUnavailable
                            ? 'cursor-not-allowed bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                            : 'bg-emerald-600 text-white hover:bg-emerald-700'
                        }`}
                        disabled={isPrimaryUnavailable}
                        onClick={() =>
                          !isPrimaryUnavailable &&
                          handleDownload(downloadConfig.primaryAction.href)
                        }
                        type='button'
                      >
                        <Download className='h-4 w-4' />
                        {downloadConfig.primaryAction.label}
                      </button>
                      {secondaryAction && (
                        <button
                          aria-label={`${meta.label} ${secondaryAction.ariaLabelSuffix}`}
                          className={`inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                            isSecondaryUnavailable
                              ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-500 dark:border-gray-800 dark:bg-gray-900/30 dark:text-gray-500'
                              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-200 dark:hover:bg-gray-800/60'
                          }`}
                          disabled={isSecondaryUnavailable}
                          onClick={() =>
                            !isSecondaryUnavailable &&
                            handleDownload(secondaryAction.href)
                          }
                          type='button'
                        >
                          <Download className='h-4 w-4' />
                          {secondaryAction.label}
                        </button>
                      )}
                    </div>
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
