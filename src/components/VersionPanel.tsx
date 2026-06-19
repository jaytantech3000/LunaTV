/* eslint-disable no-console */

'use client';

import {
  AlertCircle,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  type AppUpdateState,
  checkForAppUpdates,
  downloadLatestVersion,
  getAutoDownloadDescription,
  installDownloadedUpdate,
  isDesktopUpdaterAvailable,
  setAutoDownloadEnabled,
} from '@/lib/app-update';
import {
  type ChangelogEntry,
  type ChangelogLocale,
  changelog,
  getLocalizedChangelogItems,
} from '@/lib/changelog';
import { DESKTOP_UPSTREAM_VERSION } from '@/lib/desktop-release';
import { getChangelogFileUrl } from '@/lib/release-urls';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { acquireScrollLock } from '@/lib/scroll-lock';
import { useAppUpdateState } from '@/lib/use-app-update';
import { CURRENT_VERSION } from '@/lib/version';
import { UpdateStatus } from '@/lib/version_check';

import CapsuleSwitch from '@/components/CapsuleSwitch';

interface VersionPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface RemoteChangelogEntry {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
}

const CHANGELOG_LOCALE_STORAGE_KEY = 'lunatv:version-panel:changelog-locale';

const CHANGELOG_COPY: Record<
  ChangelogLocale,
  {
    currentBadge: string;
    latestRemoteBadge: string;
    addedTitle: string;
    changedTitle: string;
    fixedTitle: string;
    remoteSectionTitle: string;
    localSectionTitle: string;
    showRemoteButton: string;
    hideRemoteButton: string;
  }
> = {
  'zh-CN': {
    currentBadge: '当前版本',
    latestRemoteBadge: '远程最新',
    addedTitle: '新增功能',
    changedTitle: '功能改进',
    fixedTitle: '问题修复',
    remoteSectionTitle: '远程更新内容',
    localSectionTitle: '变更日志',
    showRemoteButton: '查看更新内容',
    hideRemoteButton: '收起',
  },
  en: {
    currentBadge: 'Current',
    latestRemoteBadge: 'Latest remote',
    addedTitle: 'Added',
    changedTitle: 'Changed',
    fixedTitle: 'Fixed',
    remoteSectionTitle: 'Remote changes',
    localSectionTitle: 'Changelog',
    showRemoteButton: 'Show changes',
    hideRemoteButton: 'Hide',
  },
};

const CHANGELOG_LOCALE_OPTIONS = [
  {
    label: '中文',
    value: 'zh-CN',
  },
  {
    label: 'English',
    value: 'en',
  },
] as const;

function readChangelogLocalePreference(): ChangelogLocale {
  if (typeof window === 'undefined') {
    return 'zh-CN';
  }

  return window.localStorage.getItem(CHANGELOG_LOCALE_STORAGE_KEY) === 'en'
    ? 'en'
    : 'zh-CN';
}

function persistChangelogLocalePreference(locale: ChangelogLocale) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(CHANGELOG_LOCALE_STORAGE_KEY, locale);
}

function resolveChangelogItems(
  items: ChangelogEntry['added'] | RemoteChangelogEntry['added'],
  locale: ChangelogLocale
) {
  return Array.isArray(items)
    ? items
    : getLocalizedChangelogItems(items, locale);
}

function parseRemoteChangelog(content: string): RemoteChangelogEntry[] {
  const lines = content.split('\n');
  const entries: RemoteChangelogEntry[] = [];
  let currentEntry: RemoteChangelogEntry | null = null;
  let currentSection:
    | keyof Pick<RemoteChangelogEntry, 'added' | 'changed' | 'fixed'>
    | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const versionMatch = line.match(
      /^## \[([0-9A-Za-z.-]+)\] - (\d{4}-\d{2}-\d{2})$/
    );

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

function renderUpdateStatusIcon(
  updateState: Pick<AppUpdateState, 'phase' | 'updateStatus' | 'errorMessage'>
) {
  if (updateState.phase === 'checking' || updateState.phase === 'installing') {
    return <Loader2 className='h-5 w-5 animate-spin' />;
  }

  if (updateState.phase === 'downloading') {
    return (
      <Download className='h-5 w-5 text-emerald-600 dark:text-emerald-400' />
    );
  }

  if (updateState.phase === 'error') {
    return (
      <AlertCircle className='h-5 w-5 text-amber-600 dark:text-amber-400' />
    );
  }

  if (updateState.phase === 'downloaded' && updateState.errorMessage) {
    return (
      <AlertCircle className='h-5 w-5 text-amber-600 dark:text-amber-400' />
    );
  }

  if (updateState.phase === 'downloaded') {
    return (
      <CheckCircle2 className='h-5 w-5 text-green-600 dark:text-green-400' />
    );
  }

  if (updateState.updateStatus === UpdateStatus.HAS_UPDATE) {
    return <Download className='h-5 w-5 text-amber-600 dark:text-amber-400' />;
  }

  if (updateState.updateStatus === UpdateStatus.NO_UPDATE) {
    return (
      <CheckCircle2 className='h-5 w-5 text-green-600 dark:text-green-400' />
    );
  }

  return <RotateCw className='h-5 w-5' />;
}

function getUpdateStatusTitle(
  updateState: Pick<AppUpdateState, 'phase' | 'updateStatus' | 'errorMessage'>
) {
  if (updateState.phase === 'checking') {
    return '正在检查最新版本';
  }

  if (updateState.phase === 'downloading') {
    return '正在下载最新版';
  }

  if (updateState.phase === 'installing') {
    return '正在安装更新';
  }

  if (updateState.phase === 'error') {
    return '更新暂不可用';
  }

  if (updateState.phase === 'downloaded' && updateState.errorMessage) {
    return '安装失败，可重试';
  }

  if (updateState.phase === 'downloaded') {
    return '更新包已就绪';
  }

  if (updateState.updateStatus === UpdateStatus.HAS_UPDATE) {
    return '发现新版本';
  }

  if (updateState.updateStatus === UpdateStatus.NO_UPDATE) {
    return '当前已是最新版本';
  }

  return '检查应用更新';
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
  locale: ChangelogLocale,
  options?: {
    isCurrentVersion?: boolean;
    isLatestRemote?: boolean;
  }
) {
  const changelogCopy = CHANGELOG_COPY[locale];
  const isCurrentVersion = options?.isCurrentVersion === true;
  const isLatestRemote = options?.isLatestRemote === true;
  const containerClassName = isCurrentVersion
    ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20'
    : isLatestRemote
    ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'
    : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60';
  const addedItems = resolveChangelogItems(entry.added, locale);
  const changedItems = resolveChangelogItems(entry.changed, locale);
  const fixedItems = resolveChangelogItems(entry.fixed, locale);

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
              {changelogCopy.currentBadge}
            </span>
          ) : null}
          {isLatestRemote ? (
            <span className='rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'>
              {changelogCopy.latestRemoteBadge}
            </span>
          ) : null}
        </div>
        <span className='text-sm text-gray-500 dark:text-gray-400'>
          {entry.date}
        </span>
      </div>

      <div className='space-y-3'>
        <ChangeList
          items={addedItems}
          title={changelogCopy.addedTitle}
          icon={<Plus className='h-4 w-4' />}
          dotClassName='bg-green-500'
          titleClassName='text-green-700 dark:text-green-400'
        />
        <ChangeList
          items={changedItems}
          title={changelogCopy.changedTitle}
          icon={<RefreshCw className='h-4 w-4' />}
          dotClassName='bg-blue-500'
          titleClassName='text-blue-700 dark:text-blue-400'
        />
        <ChangeList
          items={fixedItems}
          title={changelogCopy.fixedTitle}
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
  const [changelogLocale, setChangelogLocale] =
    useState<ChangelogLocale>('zh-CN');
  const [showRemoteContent, setShowRemoteContent] = useState(false);
  const updateState = useAppUpdateState();
  const updatePhaseRef = useRef(updateState.phase);
  const changelogCopy = CHANGELOG_COPY[changelogLocale];
  const isDesktopTarget = getRuntimeConfig().APP_TARGET === 'desktop';
  const desktopUpdaterAvailable = isDesktopUpdaterAvailable(updateState);
  const latestKnownVersion =
    updateState.latestVersion || remoteChangelog[0]?.version || CURRENT_VERSION;
  const localVersions = changelog.map((entry) => entry.version);
  const remoteOnlyEntries = remoteChangelog.filter(
    (entry) => !localVersions.includes(entry.version)
  );
  const autoDownloadDescription = getAutoDownloadDescription(updateState);
  const updateStatusTitle = getUpdateStatusTitle(updateState);
  const shouldShowUpdateStatusMessage =
    Boolean(updateState.statusMessage) &&
    updateState.phase !== 'checking' &&
    updateState.phase !== 'downloading' &&
    updateState.phase !== 'installing';

  useEffect(() => {
    setMounted(true);
    setChangelogLocale(readChangelogLocalePreference());
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    updatePhaseRef.current = updateState.phase;
  }, [updateState.phase]);

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

    if (
      updatePhaseRef.current === 'downloading' ||
      updatePhaseRef.current === 'downloaded' ||
      updatePhaseRef.current === 'installing'
    ) {
      return;
    }

    void checkForAppUpdates({
      force: true,
      allowAutoDownload: true,
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(getChangelogFileUrl(changelogLocale));

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const content = await response.text();
        if (!cancelled) {
          setRemoteChangelog(parseRemoteChangelog(content));
        }
      } catch (error) {
        if (!cancelled) {
          setRemoteChangelog([]);
          console.error('Failed to fetch remote changelog:', error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [changelogLocale, isOpen]);

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

  const handleChangelogLocaleChange = (value: string) => {
    const nextLocale = value === 'en' ? 'en' : 'zh-CN';
    setChangelogLocale(nextLocale);
    persistChangelogLocalePreference(nextLocale);
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
          <div className='flex flex-wrap items-center gap-3'>
            <h3 className='text-lg font-bold text-gray-800 dark:text-gray-200 sm:text-xl'>
              版本信息
            </h3>
            <p className='text-xs text-gray-500 dark:text-gray-400'>
              上游基线 v{DESKTOP_UPSTREAM_VERSION}
            </p>
            <span className='rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300 sm:px-3 sm:text-sm'>
              v{CURRENT_VERSION}
            </span>
            {updateState.updateStatus === UpdateStatus.HAS_UPDATE ? (
              <span className='hidden rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 sm:inline-flex sm:items-center sm:gap-1'>
                <Download className='h-4 w-4' />
                新版本可用
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
                    {renderUpdateStatusIcon(updateState)}
                  </div>

                  <div className='min-w-0 flex-1'>
                    <h4 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                      {updateStatusTitle}
                    </h4>
                    <p className='mt-1 break-all text-sm text-gray-600 dark:text-gray-300'>
                      v{CURRENT_VERSION}
                      {latestKnownVersion &&
                      latestKnownVersion !== CURRENT_VERSION
                        ? ` → v${latestKnownVersion}`
                        : ''}
                    </p>
                    {shouldShowUpdateStatusMessage ? (
                      <p className='mt-2 text-sm text-gray-500 dark:text-gray-400'>
                        {updateState.statusMessage}
                      </p>
                    ) : null}
                    <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                      上游基线：v{DESKTOP_UPSTREAM_VERSION}
                    </p>
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
                          ? `已下载 ${updateState.progressPercent}%`
                          : '正在下载最新版'}
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

                  {desktopUpdaterAvailable &&
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

                  {desktopUpdaterAvailable &&
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
                        <CheckCircle2 className='h-4 w-4' />
                      )}
                      安装更新
                    </button>
                  ) : null}

                  <button
                    type='button'
                    onClick={openReleasePage}
                    className='inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-gray-800 sm:w-auto'
                  >
                    <ExternalLink className='h-4 w-4' />
                    打开发布页
                  </button>
                </div>
              </div>
            </div>

            {isDesktopTarget ? (
              <div
                className={`flex items-center justify-between rounded-lg border p-4 ${
                  desktopUpdaterAvailable
                    ? 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/60'
                    : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/40'
                }`}
              >
                <div className='pr-4'>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    自动下载更新包
                  </h4>
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    {autoDownloadDescription}
                  </p>
                </div>
                <label
                  className={`flex items-center ${
                    desktopUpdaterAvailable
                      ? 'cursor-pointer'
                      : 'cursor-not-allowed opacity-60'
                  }`}
                >
                  <div className='relative'>
                    <input
                      type='checkbox'
                      className='peer sr-only'
                      checked={updateState.autoDownloadEnabled}
                      disabled={!desktopUpdaterAvailable}
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
                    {changelogCopy.remoteSectionTitle}
                  </h4>
                  <button
                    type='button'
                    onClick={() => setShowRemoteContent((value) => !value)}
                    className='inline-flex items-center justify-center gap-2 rounded-lg bg-amber-100 px-3 py-1.5 text-sm text-amber-800 transition-colors hover:bg-amber-200 dark:bg-amber-800/30 dark:text-amber-200 dark:hover:bg-amber-800/50'
                  >
                    {showRemoteContent ? (
                      <>
                        <ChevronUp className='h-4 w-4' />
                        {changelogCopy.hideRemoteButton}
                      </>
                    ) : (
                      <>
                        <ChevronDown className='h-4 w-4' />
                        {changelogCopy.showRemoteButton}
                      </>
                    )}
                  </button>
                </div>

                {showRemoteContent ? (
                  <div className='space-y-4'>
                    {remoteOnlyEntries.map((entry) =>
                      renderChangelogEntry(entry, changelogLocale, {
                        isLatestRemote: entry.version === latestKnownVersion,
                      })
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className='border-b border-gray-200 pb-4 dark:border-gray-700'>
              <div className='flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between'>
                <h4 className='text-lg font-semibold text-gray-800 dark:text-gray-200'>
                  {changelogCopy.localSectionTitle}
                </h4>
                <CapsuleSwitch
                  options={[...CHANGELOG_LOCALE_OPTIONS]}
                  active={changelogLocale}
                  onChange={handleChangelogLocaleChange}
                  className='self-start'
                />
              </div>
              <div className='space-y-4'>
                {changelog.map((entry) =>
                  renderChangelogEntry(entry, changelogLocale, {
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
