/* eslint-disable no-console */

'use client';

import {
  AlertCircle,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  checkForAppUpdates,
  downloadLatestVersion,
  installDownloadedUpdate,
  setAutoDownloadEnabled,
} from '@/lib/app-update';
import { type ChangelogEntry, changelog } from '@/lib/changelog';
import { getChangelogFileUrl } from '@/lib/release-urls';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { acquireScrollLock } from '@/lib/scroll-lock';
import { useAppUpdateState } from '@/lib/use-app-update';
import { CURRENT_VERSION } from '@/lib/version';
import { UpdateStatus } from '@/lib/version_check';

interface VersionPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type RemoteChangelogEntry = ChangelogEntry;

function parseRemoteChangelog(content: string): RemoteChangelogEntry[] {
  const lines = content.split('\n');
  const entries: RemoteChangelogEntry[] = [];
  let currentEntry: RemoteChangelogEntry | null = null;
  let currentSection:
    | keyof Pick<RemoteChangelogEntry, 'added' | 'changed' | 'fixed'>
    | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const versionMatch = line.match(/^## \[([\d.]+)\] - (\d{4}-\d{2}-\d{2})$/);

    if (versionMatch) {
      if (currentEntry) {
        entries.push(currentEntry);
      }

      currentEntry = {
        version: versionMatch[1],
        date: versionMatch[2],
        added: [],
        changed: [],
        fixed: [],
      };
      currentSection = null;
      continue;
    }

    if (!currentEntry) {
      continue;
    }

    if (line === '### Added') {
      currentSection = 'added';
      continue;
    }

    if (line === '### Changed') {
      currentSection = 'changed';
      continue;
    }

    if (line === '### Fixed') {
      currentSection = 'fixed';
      continue;
    }

    if (line.startsWith('- ') && currentSection) {
      currentEntry[currentSection].push(line.slice(2));
    }
  }

  if (currentEntry) {
    entries.push(currentEntry);
  }

  return entries;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${
    units[index]
  }`;
}

function ChangeList({
  items,
  title,
  icon,
  dotClassName,
  titleClassName,
}: {
  items: string[];
  title: string;
  icon: ReactNode;
  dotClassName: string;
  titleClassName: string;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <h5
        className={`mb-2 flex items-center gap-1 text-sm font-medium ${titleClassName}`}
      >
        {icon}
        {title}
      </h5>
      <ul className='space-y-1'>
        {items.map((item, index) => (
          <li
            key={`${title}-${index}`}
            className='flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300'
          >
            <span
              className={`mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotClassName}`}
            ></span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderChangelogEntry(
  entry: ChangelogEntry | RemoteChangelogEntry,
  options?: {
    isCurrentVersion?: boolean;
    isLatestRemote?: boolean;
  }
) {
  const isCurrentVersion = options?.isCurrentVersion === true;
  const isLatestRemote = options?.isLatestRemote === true;
  const containerClassName = isCurrentVersion
    ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20'
    : isLatestRemote
    ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'
    : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60';

  return (
    <div
      key={`${entry.version}-${entry.date}`}
      className={`rounded-lg border p-4 ${containerClassName}`}
    >
      <div className='mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex flex-wrap items-center gap-2'>
          <h4 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            v{entry.version}
          </h4>
          {isCurrentVersion ? (
            <span className='rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'>
              当前版本
            </span>
          ) : null}
          {isLatestRemote ? (
            <span className='rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'>
              远程最新
            </span>
          ) : null}
        </div>
        <span className='text-sm text-gray-500 dark:text-gray-400'>
          {entry.date}
        </span>
      </div>

      <div className='space-y-3'>
        <ChangeList
          items={entry.added}
          title='新增功能'
          icon={<Plus className='h-4 w-4' />}
          dotClassName='bg-green-500'
          titleClassName='text-green-700 dark:text-green-400'
        />
        <ChangeList
          items={entry.changed}
          title='功能改进'
          icon={<RefreshCw className='h-4 w-4' />}
          dotClassName='bg-blue-500'
          titleClassName='text-blue-700 dark:text-blue-400'
        />
        <ChangeList
          items={entry.fixed}
          title='问题修复'
          icon={<Bug className='h-4 w-4' />}
          dotClassName='bg-purple-500'
          titleClassName='text-purple-700 dark:text-purple-400'
        />
      </div>
    </div>
  );
}

export function VersionPanel({ isOpen, onClose }: VersionPanelProps) {
  const [mounted, setMounted] = useState(false);
  const [remoteChangelog, setRemoteChangelog] = useState<
    RemoteChangelogEntry[]
  >([]);
  const [showRemoteContent, setShowRemoteContent] = useState(false);
  const updateState = useAppUpdateState();
  const isDesktopTarget = getRuntimeConfig().APP_TARGET === 'desktop';
  const isDesktopUpdaterAvailable =
    updateState.canUseDesktopUpdater &&
    updateState.source === 'desktop-updater';
  const latestKnownVersion =
    updateState.latestVersion || remoteChangelog[0]?.version || CURRENT_VERSION;
  const localVersions = changelog.map((entry) => entry.version);
  const remoteOnlyEntries = remoteChangelog.filter(
    (entry) => !localVersions.includes(entry.version)
  );

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
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

    void checkForAppUpdates({
      force: true,
      allowAutoDownload: true,
    });

    void (async () => {
      try {
        const response = await fetch(getChangelogFileUrl());

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const content = await response.text();
        setRemoteChangelog(parseRemoteChangelog(content));
      } catch (error) {
        console.error('Failed to fetch remote changelog:', error);
      }
    })();
  }, [isOpen]);

  const openReleasePage = () => {
    window.open(updateState.releasePageUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCheckUpdate = () => {
    void checkForAppUpdates({
      force: true,
      allowAutoDownload: true,
    });
  };

  const handleDownloadUpdate = () => {
    void downloadLatestVersion();
  };

  const handleInstallUpdate = () => {
    void installDownloadedUpdate();
  };

  const versionPanelContent = (
    <>
      <div
        className='fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm'
        onClick={onClose}
        onTouchMove={(event) => event.preventDefault()}
        onWheel={(event) => event.preventDefault()}
        style={{ touchAction: 'none' }}
      />

      <div
        className='fixed left-1/2 top-1/2 z-[1001] max-h-[90vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-900'
        onTouchMove={(event) => event.stopPropagation()}
        style={{ touchAction: 'auto' }}
      >
        <div className='flex items-center justify-between border-b border-gray-200 p-3 sm:p-6 dark:border-gray-700'>
          <div className='flex items-center gap-3'>
            <h3 className='text-lg font-bold text-gray-800 dark:text-gray-200 sm:text-xl'>
              版本信息
            </h3>
            <span className='rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300 sm:px-3 sm:text-sm'>
              v{CURRENT_VERSION}
            </span>
            {updateState.updateStatus === UpdateStatus.HAS_UPDATE ? (
              <span className='hidden rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 sm:inline-flex sm:items-center sm:gap-1'>
                <Download className='h-4 w-4' />
                有新版本
              </span>
            ) : null}
          </div>

          <button
            onClick={onClose}
            className='flex h-8 w-8 items-center justify-center rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800'
            aria-label='关闭'
          >
            <X className='h-full w-full' />
          </button>
        </div>

        <div className='max-h-[calc(90vh-120px)] overflow-y-auto p-3 sm:p-6'>
          <div className='space-y-6'>
            <div className='rounded-lg border border-gray-200 bg-gradient-to-r from-gray-50 to-gray-100/70 p-4 dark:border-gray-700 dark:from-gray-800/70 dark:to-gray-900/70'>
              <div className='flex flex-col gap-3'>
                <div className='flex items-start gap-3'>
                  <div className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'>
                    {updateState.phase === 'checking' ? (
                      <Loader2 className='h-5 w-5 animate-spin' />
                    ) : updateState.phase === 'downloading' ? (
                      <Download className='h-5 w-5' />
                    ) : updateState.phase === 'downloaded' ? (
                      <CheckCircle2 className='h-5 w-5 text-green-600 dark:text-green-400' />
                    ) : updateState.updateStatus === UpdateStatus.HAS_UPDATE ? (
                      <AlertCircle className='h-5 w-5 text-amber-600 dark:text-amber-400' />
                    ) : updateState.updateStatus === UpdateStatus.NO_UPDATE ? (
                      <CheckCircle2 className='h-5 w-5 text-green-600 dark:text-green-400' />
                    ) : (
                      <RotateCw className='h-5 w-5' />
                    )}
                  </div>

                  <div className='min-w-0 flex-1'>
                    <h4 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                      {updateState.phase === 'checking'
                        ? '正在检查更新'
                        : updateState.phase === 'downloading'
                        ? '正在下载更新包'
                        : updateState.phase === 'downloaded'
                        ? '更新包已就绪'
                        : updateState.updateStatus === UpdateStatus.HAS_UPDATE
                        ? '发现新版本'
                        : updateState.updateStatus === UpdateStatus.NO_UPDATE
                        ? '当前已是最新版本'
                        : '检查应用更新'}
                    </h4>
                    <p className='mt-1 break-all text-sm text-gray-600 dark:text-gray-300'>
                      v{CURRENT_VERSION}
                      {latestKnownVersion &&
                      latestKnownVersion !== CURRENT_VERSION
                        ? ` → v${latestKnownVersion}`
                        : ''}
                    </p>
                    {updateState.statusMessage ? (
                      <p className='mt-2 text-sm text-gray-500 dark:text-gray-400'>
                        {updateState.statusMessage}
                      </p>
                    ) : null}
                    {updateState.publishedAt ? (
                      <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                        发布日期：{updateState.publishedAt}
                      </p>
                    ) : null}
                  </div>
                </div>

                {updateState.phase === 'downloading' ? (
                  <div className='space-y-2'>
                    <div className='h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800'>
                      <div
                        className='h-full rounded-full bg-emerald-500 transition-[width]'
                        style={{
                          width: `${updateState.progressPercent ?? 0}%`,
                        }}
                      />
                    </div>
                    <div className='flex items-center justify-between text-xs text-gray-500 dark:text-gray-400'>
                      <span>
                        {updateState.progressPercent !== null
                          ? `${updateState.progressPercent}%`
                          : '下载中'}
                      </span>
                      <span>
                        {formatBytes(updateState.downloadedBytes)}
                        {updateState.totalBytes
                          ? ` / ${formatBytes(updateState.totalBytes)}`
                          : ''}
                      </span>
                    </div>
                  </div>
                ) : null}

                {updateState.releaseNotes ? (
                  <div className='rounded-md border border-gray-200 bg-white/80 p-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300'>
                    {updateState.releaseNotes}
                  </div>
                ) : null}

                {updateState.errorMessage ? (
                  <div className='rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200'>
                    {updateState.errorMessage}
                  </div>
                ) : null}

                <div className='flex flex-col gap-2 sm:flex-row'>
                  <button
                    type='button'
                    onClick={handleCheckUpdate}
                    disabled={updateState.isBusy}
                    className='inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 sm:w-auto'
                  >
                    {updateState.isChecking ? (
                      <Loader2 className='h-4 w-4 animate-spin' />
                    ) : (
                      <RotateCw className='h-4 w-4' />
                    )}
                    检查更新
                  </button>

                  {isDesktopUpdaterAvailable &&
                  updateState.phase === 'available' ? (
                    <button
                      type='button'
                      onClick={handleDownloadUpdate}
                      disabled={updateState.isBusy}
                      className='inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto'
                    >
                      <Download className='h-4 w-4' />
                      下载最新版本
                    </button>
                  ) : null}

                  {isDesktopUpdaterAvailable &&
                  updateState.phase === 'downloading' ? (
                    <button
                      type='button'
                      disabled
                      className='inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white opacity-70 sm:w-auto'
                    >
                      <Loader2 className='h-4 w-4 animate-spin' />
                      下载中
                    </button>
                  ) : null}

                  {isDesktopUpdaterAvailable &&
                  updateState.phase === 'downloaded' ? (
                    <button
                      type='button'
                      onClick={handleInstallUpdate}
                      disabled={updateState.isBusy}
                      className='inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto'
                    >
                      {updateState.isInstalling ? (
                        <Loader2 className='h-4 w-4 animate-spin' />
                      ) : (
                        <Download className='h-4 w-4' />
                      )}
                      安装并重启
                    </button>
                  ) : null}

                  <button
                    type='button'
                    onClick={openReleasePage}
                    className='inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-gray-800 sm:w-auto'
                  >
                    <Download className='h-4 w-4' />
                    打开发布页
                  </button>
                </div>
              </div>
            </div>

            {isDesktopTarget ? (
              <div
                className={`flex items-center justify-between rounded-lg border p-4 ${
                  isDesktopUpdaterAvailable
                    ? 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/60'
                    : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/40'
                }`}
              >
                <div className='pr-4'>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    自动下载更新包
                  </h4>
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    {isDesktopUpdaterAvailable
                      ? '启动后发现新版本时自动下载，安装仍需你手动确认。'
                      : '当前桌面构建尚未配置应用内更新源。'}
                  </p>
                </div>
                <label
                  className={`flex items-center ${
                    isDesktopUpdaterAvailable
                      ? 'cursor-pointer'
                      : 'cursor-not-allowed opacity-60'
                  }`}
                >
                  <div className='relative'>
                    <input
                      type='checkbox'
                      className='peer sr-only'
                      checked={updateState.autoDownloadEnabled}
                      disabled={!isDesktopUpdaterAvailable}
                      onChange={(event) =>
                        setAutoDownloadEnabled(event.target.checked)
                      }
                    />
                    <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-emerald-500 dark:bg-gray-600'></div>
                    <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5'></div>
                  </div>
                </label>
              </div>
            ) : null}

            {updateState.updateStatus === UpdateStatus.HAS_UPDATE &&
            remoteOnlyEntries.length > 0 ? (
              <div className='space-y-4'>
                <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                  <h4 className='flex items-center gap-2 text-lg font-semibold text-gray-800 dark:text-gray-200'>
                    <Download className='h-5 w-5 text-amber-500' />
                    远程更新内容
                  </h4>
                  <button
                    type='button'
                    onClick={() => setShowRemoteContent((value) => !value)}
                    className='inline-flex items-center justify-center gap-2 rounded-lg bg-amber-100 px-3 py-1.5 text-sm text-amber-800 transition-colors hover:bg-amber-200 dark:bg-amber-800/30 dark:text-amber-200 dark:hover:bg-amber-800/50'
                  >
                    {showRemoteContent ? (
                      <>
                        <ChevronUp className='h-4 w-4' />
                        收起
                      </>
                    ) : (
                      <>
                        <ChevronDown className='h-4 w-4' />
                        查看更新内容
                      </>
                    )}
                  </button>
                </div>

                {showRemoteContent ? (
                  <div className='space-y-4'>
                    {remoteOnlyEntries.map((entry) =>
                      renderChangelogEntry(entry, {
                        isLatestRemote: entry.version === latestKnownVersion,
                      })
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className='border-b border-gray-200 pb-4 dark:border-gray-700'>
              <h4 className='pb-4 text-lg font-semibold text-gray-800 dark:text-gray-200'>
                变更日志
              </h4>
              <div className='space-y-4'>
                {changelog.map((entry) =>
                  renderChangelogEntry(entry, {
                    isCurrentVersion: entry.version === CURRENT_VERSION,
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  if (!mounted || !isOpen) {
    return null;
  }

  return createPortal(versionPanelContent, document.body);
}
