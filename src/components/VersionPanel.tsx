/* eslint-disable no-console */

'use client';

import {
  AlertCircle,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Globe2,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  type ChangelogEntry,
  type ChangelogLocale,
  changelog,
  getLocalizedChangelogItems,
} from '@/lib/changelog';
import { getChangelogFileUrl, getProjectPageUrl } from '@/lib/release-urls';
import { acquireScrollLock } from '@/lib/scroll-lock';
import { CURRENT_VERSION } from '@/lib/version';
import { compareVersions, UpdateStatus } from '@/lib/version_check';

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

type RemoteStatus = 'idle' | 'loading' | 'ready' | 'error';

const CHANGELOG_LOCALE_STORAGE_KEY = 'lunatv:version-panel:changelog-locale';

const CHANGELOG_COPY: Record<
  ChangelogLocale,
  {
    panelTitle: string;
    currentBadge: string;
    latestRemoteBadge: string;
    closeButtonLabel: string;
    addedTitle: string;
    changedTitle: string;
    fixedTitle: string;
    remoteSectionTitle: string;
    localSectionTitle: string;
    showRemoteButton: string;
    hideRemoteButton: string;
    updateAvailableTitle: string;
    updateAvailableDescription: (currentVersion: string, latestVersion: string) => string;
    upToDateTitle: string;
    upToDateDescription: (currentVersion: string) => string;
    loadingTitle: string;
    loadingDescription: string;
    errorTitle: string;
    errorDescription: string;
    remoteEmptyDescription: string;
    openRepositoryButton: string;
  }
> = {
  'zh-CN': {
    panelTitle: '版本信息',
    currentBadge: '当前版本',
    latestRemoteBadge: '远程最新',
    closeButtonLabel: '关闭',
    addedTitle: '新增功能',
    changedTitle: '功能改进',
    fixedTitle: '问题修复',
    remoteSectionTitle: '远程更新内容',
    localSectionTitle: '变更日志',
    showRemoteButton: '查看更新内容',
    hideRemoteButton: '收起',
    updateAvailableTitle: '发现新版本',
    updateAvailableDescription: (currentVersion, latestVersion) =>
      `v${currentVersion} → v${latestVersion}`,
    upToDateTitle: '当前为最新版本',
    upToDateDescription: (currentVersion) => `已是最新版本 v${currentVersion}`,
    loadingTitle: '正在检查远程版本',
    loadingDescription: '请稍候，正在拉取最新版本和变更日志。',
    errorTitle: '暂时无法获取远程版本信息',
    errorDescription: '你仍然可以打开仓库查看最新发布和变更记录。',
    remoteEmptyDescription: '当前没有额外的远程更新记录可展示。',
    openRepositoryButton: '前往仓库',
  },
  en: {
    panelTitle: 'Version Info',
    currentBadge: 'Current',
    latestRemoteBadge: 'Latest remote',
    closeButtonLabel: 'Close',
    addedTitle: 'Added',
    changedTitle: 'Changed',
    fixedTitle: 'Fixed',
    remoteSectionTitle: 'Remote changes',
    localSectionTitle: 'Changelog',
    showRemoteButton: 'Show changes',
    hideRemoteButton: 'Hide',
    updateAvailableTitle: 'Update available',
    updateAvailableDescription: (currentVersion, latestVersion) =>
      `v${currentVersion} → v${latestVersion}`,
    upToDateTitle: 'You are up to date',
    upToDateDescription: (currentVersion) => `Current version: v${currentVersion}`,
    loadingTitle: 'Checking remote version',
    loadingDescription: 'Fetching the latest version and changelog...',
    errorTitle: 'Unable to load remote version info',
    errorDescription:
      'You can still open the repository to view the latest releases and changes.',
    remoteEmptyDescription: 'No additional remote changelog entries are available right now.',
    openRepositoryButton: 'Open Repository',
  },
};

const CHANGELOG_LOCALE_OPTIONS = [
  { label: '中文', value: 'zh-CN' },
  { label: 'English', value: 'en' },
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
): string[] {
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
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChangelogCard({
  entry,
  locale,
  copy,
  currentVersion,
  latestRemoteVersion,
}: {
  entry: ChangelogEntry | RemoteChangelogEntry;
  locale: ChangelogLocale;
  copy: (typeof CHANGELOG_COPY)['zh-CN'];
  currentVersion: string;
  latestRemoteVersion: string;
}) {
  const addedItems = resolveChangelogItems(entry.added, locale);
  const changedItems = resolveChangelogItems(entry.changed, locale);
  const fixedItems = resolveChangelogItems(entry.fixed, locale);

  const isCurrentVersion = entry.version === currentVersion;
  const isLatestRemoteVersion = entry.version === latestRemoteVersion;

  return (
    <div
      className={`rounded-lg border p-4 ${
        isCurrentVersion
          ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20'
          : isLatestRemoteVersion
          ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20'
          : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60'
      }`}
    >
      <div className='mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-center'>
        <div className='flex flex-wrap items-center gap-2'>
          <h4 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            v{entry.version}
          </h4>
          {isCurrentVersion ? (
            <span className='rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'>
              {copy.currentBadge}
            </span>
          ) : null}
          {isLatestRemoteVersion ? (
            <span className='rounded-full bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'>
              {copy.latestRemoteBadge}
            </span>
          ) : null}
        </div>
        <div className='text-sm text-gray-500 dark:text-gray-400'>{entry.date}</div>
      </div>

      <div className='space-y-3'>
        <ChangeList
          items={addedItems}
          title={copy.addedTitle}
          icon={<Plus className='h-4 w-4' />}
          dotClassName='bg-green-500'
          titleClassName='text-green-700 dark:text-green-400'
        />
        <ChangeList
          items={changedItems}
          title={copy.changedTitle}
          icon={<RefreshCw className='h-4 w-4' />}
          dotClassName='bg-blue-500'
          titleClassName='text-blue-700 dark:text-blue-400'
        />
        <ChangeList
          items={fixedItems}
          title={copy.fixedTitle}
          icon={<Bug className='h-4 w-4' />}
          dotClassName='bg-purple-500'
          titleClassName='text-purple-700 dark:text-purple-400'
        />
      </div>
    </div>
  );
}

export const VersionPanel: React.FC<VersionPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const [mounted, setMounted] = useState(false);
  const [changelogLocale, setChangelogLocale] =
    useState<ChangelogLocale>('zh-CN');
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>('idle');
  const [remoteChangelog, setRemoteChangelog] = useState<RemoteChangelogEntry[]>(
    []
  );
  const [showRemoteContent, setShowRemoteContent] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [latestVersion, setLatestVersion] = useState('');
  const [projectPageUrl, setProjectPageUrl] = useState('');

  const copy = CHANGELOG_COPY[changelogLocale];
  const localVersions = new Set(changelog.map((entry) => entry.version));
  const remoteEntries = remoteChangelog.filter(
    (entry) => !localVersions.has(entry.version)
  );

  useEffect(() => {
    setMounted(true);
    setChangelogLocale(readChangelogLocalePreference());
    setProjectPageUrl(getProjectPageUrl());

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

    let cancelled = false;

    const fetchRemoteChangelog = async () => {
      setRemoteStatus('loading');

      try {
        const response = await fetch(getChangelogFileUrl(changelogLocale), {
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const content = await response.text();
        const parsed = parseRemoteChangelog(content);
        const latestRemoteVersion = parsed[0]?.version || '';

        if (cancelled) {
          return;
        }

        setRemoteChangelog(parsed);
        setLatestVersion(latestRemoteVersion);
        setHasUpdate(
          latestRemoteVersion
            ? compareVersions(latestRemoteVersion) === UpdateStatus.HAS_UPDATE
            : false
        );
        setRemoteStatus('ready');
      } catch (error) {
        console.error('获取远程变更日志失败:', error);
        if (cancelled) {
          return;
        }

        setRemoteChangelog([]);
        setLatestVersion('');
        setHasUpdate(false);
        setRemoteStatus('error');
      }
    };

    void fetchRemoteChangelog();

    return () => {
      cancelled = true;
    };
  }, [changelogLocale, isOpen]);

  const handleLocaleChange = (locale: ChangelogLocale) => {
    setChangelogLocale(locale);
    persistChangelogLocalePreference(locale);
  };

  if (!mounted || !isOpen) {
    return null;
  }

  const statusCard = (() => {
    if (remoteStatus === 'loading' || remoteStatus === 'idle') {
      return (
        <div className='rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-sky-50 p-4 dark:border-blue-800 dark:from-blue-900/20 dark:to-sky-900/20'>
          <div className='flex flex-col gap-3'>
            <div className='flex items-center gap-3'>
              <div className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-800/40'>
                <Loader2 className='h-5 w-5 animate-spin text-blue-600 dark:text-blue-300' />
              </div>
              <div className='min-w-0 flex-1'>
                <h4 className='text-sm font-semibold text-blue-800 dark:text-blue-200 sm:text-base'>
                  {copy.loadingTitle}
                </h4>
                <p className='text-xs text-blue-700 dark:text-blue-300 sm:text-sm'>
                  {copy.loadingDescription}
                </p>
              </div>
            </div>
            <a
              href={projectPageUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs text-white shadow-sm transition-colors hover:bg-blue-700 sm:text-sm'
            >
              <Globe2 className='h-4 w-4' />
              {copy.openRepositoryButton}
            </a>
          </div>
        </div>
      );
    }

    if (remoteStatus === 'error') {
      return (
        <div className='rounded-lg border border-red-200 bg-gradient-to-r from-red-50 to-rose-50 p-4 dark:border-red-800 dark:from-red-900/20 dark:to-rose-900/20'>
          <div className='flex flex-col gap-3'>
            <div className='flex items-center gap-3'>
              <div className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-800/40'>
                <AlertCircle className='h-5 w-5 text-red-600 dark:text-red-300' />
              </div>
              <div className='min-w-0 flex-1'>
                <h4 className='text-sm font-semibold text-red-800 dark:text-red-200 sm:text-base'>
                  {copy.errorTitle}
                </h4>
                <p className='text-xs text-red-700 dark:text-red-300 sm:text-sm'>
                  {copy.errorDescription}
                </p>
              </div>
            </div>
            <a
              href={projectPageUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-xs text-white shadow-sm transition-colors hover:bg-red-700 sm:text-sm'
            >
              <Globe2 className='h-4 w-4' />
              {copy.openRepositoryButton}
            </a>
          </div>
        </div>
      );
    }

    if (hasUpdate && latestVersion) {
      return (
        <div className='rounded-lg border border-yellow-200 bg-gradient-to-r from-yellow-50 to-amber-50 p-4 dark:border-yellow-800 dark:from-yellow-900/20 dark:to-amber-900/20'>
          <div className='flex flex-col gap-3'>
            <div className='flex items-center gap-3'>
              <div className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-800/40'>
                <Download className='h-5 w-5 text-yellow-600 dark:text-yellow-400' />
              </div>
              <div className='min-w-0 flex-1'>
                <h4 className='text-sm font-semibold text-yellow-800 dark:text-yellow-200 sm:text-base'>
                  {copy.updateAvailableTitle}
                </h4>
                <p className='break-all text-xs text-yellow-700 dark:text-yellow-300 sm:text-sm'>
                  {copy.updateAvailableDescription(CURRENT_VERSION, latestVersion)}
                </p>
              </div>
            </div>
            <a
              href={projectPageUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex w-full items-center justify-center gap-2 rounded-lg bg-yellow-600 px-3 py-2 text-xs text-white shadow-sm transition-colors hover:bg-yellow-700 sm:text-sm'
            >
              <Download className='h-4 w-4' />
              {copy.openRepositoryButton}
            </a>
          </div>
        </div>
      );
    }

    return (
      <div className='rounded-lg border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-4 dark:border-green-800 dark:from-green-900/20 dark:to-emerald-900/20'>
        <div className='flex flex-col gap-3'>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-800/40'>
              <CheckCircle2 className='h-5 w-5 text-green-600 dark:text-green-400' />
            </div>
            <div className='min-w-0 flex-1'>
              <h4 className='text-sm font-semibold text-green-800 dark:text-green-200 sm:text-base'>
                {copy.upToDateTitle}
              </h4>
              <p className='break-all text-xs text-green-700 dark:text-green-300 sm:text-sm'>
                {copy.upToDateDescription(CURRENT_VERSION)}
              </p>
            </div>
          </div>
          <a
            href={projectPageUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-xs text-white shadow-sm transition-colors hover:bg-green-700 sm:text-sm'
          >
            <CheckCircle2 className='h-4 w-4' />
            {copy.openRepositoryButton}
          </a>
        </div>
      </div>
    );
  })();

  const versionPanelContent = (
    <>
      <div
        className='fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm'
        onClick={onClose}
        onTouchMove={(event) => {
          event.preventDefault();
        }}
        onWheel={(event) => {
          event.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      <div
        className='fixed left-1/2 top-1/2 z-[1001] max-h-[90vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-900'
        onTouchMove={(event) => {
          event.stopPropagation();
        }}
        style={{
          touchAction: 'auto',
        }}
      >
        <div className='border-b border-gray-200 p-3 dark:border-gray-700 sm:p-6'>
          <div className='flex items-start justify-between gap-3'>
            <div className='space-y-3'>
              <div className='flex flex-wrap items-center gap-2 sm:gap-3'>
                <h3 className='text-lg font-bold text-gray-800 dark:text-gray-200 sm:text-xl'>
                  {copy.panelTitle}
                </h3>
                <span className='rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300 sm:px-3 sm:text-sm'>
                  v{CURRENT_VERSION}
                </span>
                {hasUpdate && latestVersion ? (
                  <span className='flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 sm:px-3 sm:text-sm'>
                    <Download className='h-3 w-3 sm:h-4 sm:w-4' />
                    <span className='hidden sm:inline'>{copy.updateAvailableTitle}</span>
                    <span className='sm:hidden'>Update</span>
                  </span>
                ) : null}
              </div>

              <div className='inline-flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800'>
                {CHANGELOG_LOCALE_OPTIONS.map((option) => {
                  const selected = option.value === changelogLocale;

                  return (
                    <button
                      key={option.value}
                      type='button'
                      onClick={() => handleLocaleChange(option.value)}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        selected
                          ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                          : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={onClose}
              className='flex h-6 w-6 items-center justify-center rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 sm:h-8 sm:w-8'
              aria-label={copy.closeButtonLabel}
            >
              <X className='h-full w-full' />
            </button>
          </div>
        </div>

        <div className='max-h-[calc(95vh-140px)] overflow-y-auto p-3 sm:max-h-[calc(90vh-120px)] sm:p-6'>
          <div className='space-y-3 sm:space-y-6'>
            {statusCard}

            {remoteStatus === 'ready' ? (
              <div className='space-y-4'>
                <div className='flex flex-col justify-between gap-3 sm:flex-row sm:items-center'>
                  <h4 className='flex items-center gap-2 text-lg font-semibold text-gray-800 dark:text-gray-200'>
                    <Download className='h-5 w-5 text-yellow-500' />
                    {copy.remoteSectionTitle}
                  </h4>
                  <button
                    type='button'
                    onClick={() => setShowRemoteContent((previous) => !previous)}
                    className='inline-flex w-full items-center justify-center gap-2 rounded-lg bg-yellow-100 px-3 py-1.5 text-sm text-yellow-800 transition-colors hover:bg-yellow-200 dark:bg-yellow-800/30 dark:text-yellow-200 dark:hover:bg-yellow-800/50 sm:w-auto'
                    disabled={remoteEntries.length === 0}
                  >
                    {showRemoteContent ? (
                      <>
                        <ChevronUp className='h-4 w-4' />
                        {copy.hideRemoteButton}
                      </>
                    ) : (
                      <>
                        <ChevronDown className='h-4 w-4' />
                        {copy.showRemoteButton}
                      </>
                    )}
                  </button>
                </div>

                {showRemoteContent ? (
                  remoteEntries.length > 0 ? (
                    <div className='space-y-4'>
                      {remoteEntries.map((entry) => (
                        <ChangelogCard
                          key={`${entry.version}-${entry.date}`}
                          entry={entry}
                          locale={changelogLocale}
                          copy={copy}
                          currentVersion={CURRENT_VERSION}
                          latestRemoteVersion={latestVersion}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className='rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
                      {copy.remoteEmptyDescription}
                    </div>
                  )
                ) : null}
              </div>
            ) : null}

            <div className='border-b border-gray-200 pb-4 dark:border-gray-700'>
              <h4 className='pb-3 text-lg font-semibold text-gray-800 dark:text-gray-200 sm:pb-4'>
                {copy.localSectionTitle}
              </h4>

              <div className='space-y-4'>
                {changelog.map((entry) => (
                  <ChangelogCard
                    key={`${entry.version}-${entry.date}`}
                    entry={entry}
                    locale={changelogLocale}
                    copy={copy}
                    currentVersion={CURRENT_VERSION}
                    latestRemoteVersion=''
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(versionPanelContent, document.body);
};
