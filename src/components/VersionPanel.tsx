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
  History,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Square,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  type AppUpdateState,
  cancelActiveUpdateDownload,
  checkForAppUpdates,
  downloadLatestVersion,
  getAutoDownloadDescription,
  installDesktopReleaseVersion,
  installDownloadedUpdate,
  isDesktopUpdaterAvailable,
  pauseActiveUpdateDownload,
  setAutoDownloadEnabled,
} from '@/lib/app-update';
import {
  type ChangelogEntry,
  type ChangelogLocale,
  changelog,
  getLocalizedChangelogItems,
} from '@/lib/changelog';
import {
  persistChangelogLocalePreference as persistStoredChangelogLocalePreference,
  readChangelogLocalePreference as readStoredChangelogLocalePreference,
} from '@/lib/changelog-locale';
import { DESKTOP_UPSTREAM_VERSION } from '@/lib/desktop-release';
import { openExternalUrl } from '@/lib/open-external-url';
import {
  getChangelogFileUrl,
  getDesktopDownloadSiteUrl,
} from '@/lib/release-urls';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { acquireScrollLock } from '@/lib/scroll-lock';
import { useAppUpdateState } from '@/lib/use-app-update';
import { CURRENT_VERSION } from '@/lib/version';
import { UpdateStatus } from '@/lib/version_check';

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
import CapsuleSwitch from '@/components/CapsuleSwitch';
import { DesktopReleaseHistoryDialog } from '@/components/DesktopReleaseHistoryDialog';

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

type PendingDownloadAction = 'cancel';

type ReleaseNotesBlock =
  | {
      type: 'heading';
      level: number;
      content: string;
    }
  | {
      type: 'list';
      items: string[];
    }
  | {
      type: 'paragraph';
      lines: string[];
    };

const INLINE_MARKDOWN_PATTERN =
  /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|(https?:\/\/[^\s<]+)/g;
const FULL_CHANGELOG_LINE_PATTERN = /^\**\s*full changelog\s*\**\s*:?\s*/i;
const DESKTOP_DOWNLOAD_SITE_URL = getDesktopDownloadSiteUrl();

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
  return readStoredChangelogLocalePreference();
}

function persistChangelogLocalePreference(locale: ChangelogLocale) {
  persistStoredChangelogLocalePreference(locale);
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

function getUpdateVersionLabel(version: string | null) {
  return version ? `v${version}` : '目标版本';
}

function getDownloadActionButtonLabel(
  updateState: Pick<
    AppUpdateState,
    'phase' | 'downloadTargetKind' | 'latestVersion'
  >
) {
  const versionLabel = getUpdateVersionLabel(updateState.latestVersion);

  if (updateState.phase === 'paused') {
    return updateState.downloadTargetKind === 'release'
      ? `继续下载 ${versionLabel}`
      : '继续下载最新版本';
  }

  return updateState.downloadTargetKind === 'release'
    ? `下载 ${versionLabel}`
    : '下载最新版本';
}

function getDownloadProgressLabel(
  updateState: Pick<
    AppUpdateState,
    'phase' | 'latestVersion' | 'progressPercent'
  >
) {
  if (updateState.progressPercent !== null) {
    return `已下载 ${updateState.progressPercent}%`;
  }

  if (updateState.phase === 'paused') {
    return `已暂停 ${getUpdateVersionLabel(updateState.latestVersion)}`;
  }

  return `正在下载 ${getUpdateVersionLabel(updateState.latestVersion)}`;
}

function StopIcon({ className }: { className?: string }) {
  return <Square className={className} fill='currentColor' />;
}

function PauseSolidIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 16 16'
      aria-hidden='true'
      className={className}
      fill='currentColor'
    >
      <rect x='3' y='2.5' width='3.25' height='11' rx='1.25' />
      <rect x='9.75' y='2.5' width='3.25' height='11' rx='1.25' />
    </svg>
  );
}

function PlaySolidIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 16 16'
      aria-hidden='true'
      className={className}
      fill='currentColor'
    >
      <path d='M4.5 2.9A1 1 0 0 1 6 2.05l7.2 5.02a1.13 1.13 0 0 1 0 1.86L6 13.95A1 1 0 0 1 4.5 13.1z' />
    </svg>
  );
}

function shouldHoldInterruptedDownloadState(
  updateState: Pick<AppUpdateState, 'phase'>
) {
  return updateState.phase === 'paused';
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

  if (updateState.phase === 'paused') {
    return <Pause className='h-5 w-5 text-amber-600 dark:text-amber-300' />;
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
  updateState: Pick<
    AppUpdateState,
    'phase' | 'updateStatus' | 'errorMessage' | 'latestVersion'
  >
) {
  const versionLabel = getUpdateVersionLabel(updateState.latestVersion);

  if (updateState.phase === 'downloading' && updateState.latestVersion) {
    return `正在下载 ${versionLabel}`;
  }

  if (updateState.phase === 'paused') {
    return `${versionLabel} 下载已暂停`;
  }

  if (updateState.phase === 'installing' && updateState.latestVersion) {
    return `正在安装 ${versionLabel}`;
  }

  if (updateState.phase === 'downloaded' && !updateState.errorMessage) {
    return `${versionLabel} 已下载完成`;
  }

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

function stripTrailingUrlPunctuation(value: string) {
  const match = value.match(/[),.;!?]+$/);
  if (!match) {
    return {
      href: value,
      trailing: '',
    };
  }

  return {
    href: value.slice(0, -match[0].length),
    trailing: match[0],
  };
}

function renderReleaseNotesInline(text: string, keyPrefix: string) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  INLINE_MARKDOWN_PATTERN.lastIndex = 0;

  while ((match = INLINE_MARKDOWN_PATTERN.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(
        <span key={`${keyPrefix}-text-${lastIndex}`}>
          {text.slice(lastIndex, match.index)}
        </span>
      );
    }

    if (match[1] && match[2]) {
      const href = match[2];
      nodes.push(
        <a
          key={`${keyPrefix}-markdown-link-${match.index}`}
          href={href}
          target='_blank'
          rel='noopener noreferrer'
          onClick={(event) => {
            event.preventDefault();
            void openExternalUrl(href);
          }}
          className='break-all text-emerald-700 underline decoration-emerald-400/70 underline-offset-4 transition-colors hover:text-emerald-800 dark:text-emerald-300 dark:decoration-emerald-500/60 dark:hover:text-emerald-200'
        >
          {match[1]}
        </a>
      );
    } else if (match[3]) {
      nodes.push(
        <strong
          key={`${keyPrefix}-strong-${match.index}`}
          className='font-semibold text-gray-900 dark:text-gray-100'
        >
          {match[3]}
        </strong>
      );
    } else if (match[4]) {
      const { href, trailing } = stripTrailingUrlPunctuation(match[4]);
      nodes.push(
        <a
          key={`${keyPrefix}-link-${match.index}`}
          href={href}
          target='_blank'
          rel='noopener noreferrer'
          onClick={(event) => {
            event.preventDefault();
            void openExternalUrl(href);
          }}
          className='break-all text-emerald-700 underline decoration-emerald-400/70 underline-offset-4 transition-colors hover:text-emerald-800 dark:text-emerald-300 dark:decoration-emerald-500/60 dark:hover:text-emerald-200'
        >
          {href}
        </a>
      );

      if (trailing) {
        nodes.push(
          <span key={`${keyPrefix}-trail-${match.index}`}>{trailing}</span>
        );
      }
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(
      <span key={`${keyPrefix}-text-${lastIndex}`}>
        {text.slice(lastIndex)}
      </span>
    );
  }

  return nodes.length > 0 ? nodes : [text];
}

function shouldHideReleaseNotesLine(line: string) {
  const normalizedLine = line
    .replace(/^[*-]\s+/, '')
    .replace(/\*\*/g, '')
    .trim();

  return (
    FULL_CHANGELOG_LINE_PATTERN.test(normalizedLine) ||
    /^https?:\/\/[^\s]+\/compare\//i.test(normalizedLine)
  );
}

function parseReleaseNotes(
  releaseNotes: string,
  options?: {
    hideChangelogLinks?: boolean;
  }
): ReleaseNotesBlock[] {
  const normalized = releaseNotes.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const blocks: ReleaseNotesBlock[] = [];
  const paragraphLines: string[] = [];
  const listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    blocks.push({
      type: 'paragraph',
      lines: [...paragraphLines],
    });
    paragraphLines.length = 0;
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }

    blocks.push({
      type: 'list',
      items: [...listItems],
    });
    listItems.length = 0;
  };

  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (options?.hideChangelogLinks && shouldHideReleaseNotesLine(line)) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        content: headingMatch[2].trim(),
      });
      continue;
    }

    const listMatch = line.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      listItems.push(listMatch[1].trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}

function ReleaseNotesContent({
  releaseNotes,
  hideChangelogLinks = false,
}: {
  releaseNotes: string;
  hideChangelogLinks?: boolean;
}) {
  const blocks = parseReleaseNotes(releaseNotes, {
    hideChangelogLinks,
  });
  if (blocks.length === 0) {
    return null;
  }

  return (
    <AppSurfaceCard className='rounded-xl px-4 py-4 text-sm text-gray-600 dark:text-gray-300'>
      <div className='space-y-3'>
        {blocks.map((block, index) => {
          if (block.type === 'heading') {
            const headingClassName =
              block.level <= 2
                ? 'text-base font-semibold text-gray-900 dark:text-gray-100'
                : 'text-sm font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400';

            return (
              <h5
                key={`release-notes-heading-${index}`}
                className={headingClassName}
              >
                {renderReleaseNotesInline(
                  block.content,
                  `release-notes-heading-${index}`
                )}
              </h5>
            );
          }

          if (block.type === 'list') {
            return (
              <ul
                key={`release-notes-list-${index}`}
                className='space-y-2 text-sm leading-6 text-gray-700 dark:text-gray-300'
              >
                {block.items.map((item, itemIndex) => (
                  <li
                    key={`release-notes-list-${index}-${itemIndex}`}
                    className='flex items-start gap-2'
                  >
                    <span className='mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500' />
                    <span className='min-w-0 break-words'>
                      {renderReleaseNotesInline(
                        item,
                        `release-notes-list-${index}-${itemIndex}`
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            );
          }

          return (
            <p
              key={`release-notes-paragraph-${index}`}
              className='text-sm leading-6 text-gray-700 dark:text-gray-300'
            >
              {block.lines.map((line, lineIndex) => (
                <span key={`release-notes-paragraph-${index}-${lineIndex}`}>
                  {renderReleaseNotesInline(
                    line,
                    `release-notes-paragraph-${index}-${lineIndex}`
                  )}
                  {lineIndex < block.lines.length - 1 ? <br /> : null}
                </span>
              ))}
            </p>
          );
        })}
      </div>
    </AppSurfaceCard>
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
  const [isReleaseHistoryOpen, setIsReleaseHistoryOpen] = useState(false);
  const [pendingDownloadAction, setPendingDownloadAction] =
    useState<PendingDownloadAction | null>(null);
  const [isApplyingDownloadAction, setIsApplyingDownloadAction] =
    useState(false);
  const [downloadActionError, setDownloadActionError] = useState<string | null>(
    null
  );
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
  const activeDownloadVersionLabel = getUpdateVersionLabel(
    updateState.latestVersion
  );
  const shouldShowDownloadActionButton =
    desktopUpdaterAvailable &&
    updateState.canDownload &&
    updateState.phase === 'available';
  const downloadActionButtonLabel = getDownloadActionButtonLabel(updateState);
  const shouldKeepInterruptedDownloadTarget =
    shouldHoldInterruptedDownloadState(updateState);
  const shouldShowDownloadProgress =
    updateState.phase === 'downloading' || updateState.phase === 'paused';
  const isPausedDownloadProgress = updateState.phase === 'paused';
  const pendingDownloadActionMeta = pendingDownloadAction
    ? {
        title: '确认停止下载',
        description: '停止后会立即结束下载，并返回更新初始状态。',
        confirmText: '确认停止',
        badgeText: '停止',
        tone: 'rose' as const,
      }
    : null;
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
      setIsReleaseHistoryOpen(false);
      setPendingDownloadAction(null);
      setIsApplyingDownloadAction(false);
      setDownloadActionError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (updateState.phase !== 'downloading') {
      setPendingDownloadAction(null);
      setIsApplyingDownloadAction(false);
      setDownloadActionError(null);
    }
  }, [updateState.phase]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (
      shouldKeepInterruptedDownloadTarget ||
      updatePhaseRef.current === 'downloading' ||
      updatePhaseRef.current === 'downloaded' ||
      updatePhaseRef.current === 'installing' ||
      updatePhaseRef.current === 'paused'
    ) {
      return;
    }

    void checkForAppUpdates({
      force: true,
      allowAutoDownload: true,
    });
  }, [isOpen, shouldKeepInterruptedDownloadTarget]);

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
    void openExternalUrl(updateState.releasePageUrl);
  };

  const openDownloadSite = () => {
    void openExternalUrl(DESKTOP_DOWNLOAD_SITE_URL);
  };

  const handleCheckUpdate = () => {
    void checkForAppUpdates({
      force: true,
      allowAutoDownload: true,
    });
  };

  const handleDownloadUpdate = () => {
    if (
      updateState.downloadTargetKind === 'release' &&
      updateState.latestVersion &&
      updateState.targetManifestUrl
    ) {
      void installDesktopReleaseVersion({
        manifestUrl: updateState.targetManifestUrl,
        version: updateState.latestVersion,
        publishedAt: updateState.publishedAt,
        releaseNotes: updateState.releaseNotes,
      });
      return;
    }

    void downloadLatestVersion();
  };

  const handleInstallUpdate = () => {
    void installDownloadedUpdate();
  };

  const closeDownloadActionDialog = () => {
    if (isApplyingDownloadAction) {
      return;
    }

    setPendingDownloadAction(null);
    setDownloadActionError(null);
  };

  const handlePauseDownload = async () => {
    if (isApplyingDownloadAction) {
      return;
    }

    setIsApplyingDownloadAction(true);
    setDownloadActionError(null);

    try {
      await pauseActiveUpdateDownload();
    } catch (error) {
      setDownloadActionError(
        error instanceof Error ? error.message : '下载控制操作失败'
      );
    } finally {
      setIsApplyingDownloadAction(false);
    }
  };

  const handlePrimaryDownloadControl = () => {
    if (isPausedDownloadProgress) {
      handleDownloadUpdate();
      return;
    }

    void handlePauseDownload();
  };

  const handleOpenCancelDownloadDialog = () => {
    setDownloadActionError(null);
    setPendingDownloadAction('cancel');
  };

  const handleConfirmDownloadAction = async () => {
    if (!pendingDownloadAction || isApplyingDownloadAction) {
      return;
    }

    setIsApplyingDownloadAction(true);
    setDownloadActionError(null);

    try {
      await cancelActiveUpdateDownload();
      setPendingDownloadAction(null);
    } catch (error) {
      setDownloadActionError(
        error instanceof Error ? error.message : '下载控制操作失败'
      );
    } finally {
      setIsApplyingDownloadAction(false);
    }
  };

  const openReleaseHistory = () => {
    setIsReleaseHistoryOpen(true);
  };

  const closeReleaseHistory = () => {
    setIsReleaseHistoryOpen(false);
  };

  const handleChangelogLocaleChange = (value: string) => {
    const nextLocale = value === 'en' ? 'en' : 'zh-CN';
    setChangelogLocale(nextLocale);
    persistChangelogLocalePreference(nextLocale);
  };

  const versionPanelContent = (
    <>
      <AppDialogBackdrop
        className='z-[1000] bg-black/50 backdrop-blur-sm'
        onClick={onClose}
        onTouchMove={(event) => event.preventDefault()}
        onWheel={(event) => event.preventDefault()}
        style={{ touchAction: 'none' }}
      />

      <AppDialogPanel
        className='fixed left-1/2 top-1/2 z-[1001] max-h-[90vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[26px]'
        onTouchMove={(event) => event.stopPropagation()}
        style={{ touchAction: 'auto' }}
      >
        <AppDialogHeader className='p-3 sm:p-6'>
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

          <div className='flex items-center gap-2'>
            {isDesktopTarget ? (
              <AppIconButton
                onClick={openReleaseHistory}
                aria-label='版本列表'
                title='版本列表'
              >
                <History className='h-4 w-4' />
              </AppIconButton>
            ) : null}

            <AppIconButton onClick={onClose} aria-label='关闭'>
              <X className='h-full w-full' />
            </AppIconButton>
          </div>
        </AppDialogHeader>

        <div className='max-h-[calc(90vh-120px)] overflow-y-auto p-3 sm:p-6'>
          <div className='space-y-6'>
            <AppSurfaceCard className='rounded-2xl bg-gradient-to-r from-gray-50 to-gray-100/70 p-4 dark:from-gray-800/70 dark:to-gray-900/70'>
              <div className='flex flex-col gap-3'>
                <div className='flex items-start gap-3'>
                  <div className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'>
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

                {shouldShowDownloadProgress ? (
                  <div className='flex items-start gap-3'>
                    <div className='min-w-0 flex-1 space-y-2'>
                      <div className='h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800'>
                        <div
                          className='h-full rounded-full bg-emerald-500 transition-[width]'
                          style={{
                            width: `${updateState.progressPercent ?? 0}%`,
                          }}
                        />
                      </div>
                      <div className='flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400'>
                        <span>{getDownloadProgressLabel(updateState)}</span>
                        <span className='whitespace-nowrap'>
                          {formatBytes(updateState.downloadedBytes)}
                          {updateState.totalBytes
                            ? ` / ${formatBytes(updateState.totalBytes)}`
                            : ''}
                        </span>
                      </div>
                    </div>
                    <div className='flex items-center gap-2'>
                      <AppIconButton
                        onClick={handlePrimaryDownloadControl}
                        disabled={isApplyingDownloadAction}
                        variant='muted'
                        className={
                          isPausedDownloadProgress
                            ? 'text-emerald-600 hover:bg-emerald-50/80 hover:text-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-200'
                            : 'text-amber-600 hover:bg-amber-50/80 hover:text-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/20 dark:hover:text-amber-200'
                        }
                        aria-label={
                          isPausedDownloadProgress ? '继续下载' : '暂停下载'
                        }
                        title={
                          isPausedDownloadProgress ? '继续下载' : '暂停下载'
                        }
                      >
                        {!isPausedDownloadProgress &&
                        isApplyingDownloadAction ? (
                          <Loader2 className='h-4 w-4 animate-spin' />
                        ) : isPausedDownloadProgress ? (
                          <PlaySolidIcon className='h-4 w-4' />
                        ) : (
                          <PauseSolidIcon className='h-4 w-4' />
                        )}
                      </AppIconButton>
                      <AppIconButton
                        onClick={handleOpenCancelDownloadDialog}
                        disabled={isApplyingDownloadAction}
                        variant='muted'
                        className='text-rose-600 hover:bg-rose-50/80 hover:text-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/20 dark:hover:text-rose-200'
                        aria-label='停止下载'
                        title='停止下载'
                      >
                        <StopIcon className='h-4 w-4' />
                      </AppIconButton>
                    </div>
                  </div>
                ) : null}

                {updateState.releaseNotes ? (
                  <ReleaseNotesContent
                    releaseNotes={updateState.releaseNotes}
                    hideChangelogLinks={shouldShowDownloadProgress}
                  />
                ) : null}

                {downloadActionError ? (
                  <div className='rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200'>
                    {downloadActionError}
                  </div>
                ) : null}

                {updateState.errorMessage ? (
                  <div className='rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200'>
                    {updateState.errorMessage}
                  </div>
                ) : null}

                <div className='flex flex-col gap-2 sm:flex-row sm:flex-wrap'>
                  <AppButton
                    onClick={handleCheckUpdate}
                    disabled={updateState.isBusy}
                    variant='muted'
                    className='w-full sm:w-auto'
                  >
                    {updateState.isChecking ? (
                      <Loader2 className='h-4 w-4 animate-spin' />
                    ) : (
                      <RotateCw className='h-4 w-4' />
                    )}
                    检查更新
                  </AppButton>

                  {desktopUpdaterAvailable && shouldShowDownloadActionButton ? (
                    <AppButton
                      onClick={handleDownloadUpdate}
                      disabled={updateState.isBusy}
                      variant='accent'
                      className='w-full sm:w-auto'
                    >
                      {updateState.phase === 'paused' ? (
                        <Play className='h-4 w-4' />
                      ) : (
                        <Download className='h-4 w-4' />
                      )}
                      {downloadActionButtonLabel}
                    </AppButton>
                  ) : null}

                  {desktopUpdaterAvailable &&
                  updateState.phase === 'downloaded' ? (
                    <AppButton
                      onClick={handleInstallUpdate}
                      disabled={updateState.isBusy}
                      variant='accent'
                      className='w-full sm:w-auto'
                    >
                      {updateState.isInstalling ? (
                        <Loader2 className='h-4 w-4 animate-spin' />
                      ) : (
                        <CheckCircle2 className='h-4 w-4' />
                      )}
                      安装更新
                    </AppButton>
                  ) : null}

                  {isDesktopTarget ? (
                    <AppButton
                      onClick={openDownloadSite}
                      className='w-full sm:w-auto'
                    >
                      <ExternalLink className='h-4 w-4' />
                      下载平台
                    </AppButton>
                  ) : null}

                  <AppButton
                    onClick={openReleasePage}
                    className='w-full sm:w-auto'
                  >
                    <ExternalLink className='h-4 w-4' />
                    打开发布页
                  </AppButton>
                </div>
              </div>
            </AppSurfaceCard>

            {isDesktopTarget ? (
              <AppSurfaceCard
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
              </AppSurfaceCard>
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
      </AppDialogPanel>

      {pendingDownloadAction && pendingDownloadActionMeta ? (
        <>
          <AppDialogBackdrop
            className='z-[1002]'
            onClick={closeDownloadActionDialog}
          />
          <div className='fixed left-1/2 top-1/2 z-[1003] w-full max-w-md -translate-x-1/2 -translate-y-1/2 px-4'>
            <AppDialogPanel
              role='dialog'
              aria-modal='true'
              aria-label='确认下载操作'
            >
              <AppDialogHeader>
                <div className='flex items-start gap-3'>
                  <AppIconBadge
                    className='mt-0.5 flex-shrink-0'
                    tone={pendingDownloadActionMeta.tone}
                  >
                    <StopIcon className='h-5 w-5' />
                  </AppIconBadge>
                  <AppDialogTitleBlock
                    title={
                      <div className='flex flex-wrap items-center gap-2'>
                        <span>{pendingDownloadActionMeta.title}</span>
                        <span className='rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800 dark:bg-rose-900/30 dark:text-rose-200'>
                          {pendingDownloadActionMeta.badgeText}
                        </span>
                      </div>
                    }
                    subtitle={pendingDownloadActionMeta.description}
                  />
                </div>
                <AppIconButton
                  onClick={closeDownloadActionDialog}
                  disabled={isApplyingDownloadAction}
                  aria-label='关闭下载确认'
                >
                  <X className='h-5 w-5' />
                </AppIconButton>
              </AppDialogHeader>

              <div className='space-y-3 px-5 py-5 sm:px-6'>
                <div className='flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/60'>
                  <span className='text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400'>
                    下载目标
                  </span>
                  <span className='rounded-full bg-rose-100 px-2.5 py-1 text-sm font-semibold text-rose-800 dark:bg-rose-900/30 dark:text-rose-100'>
                    {activeDownloadVersionLabel}
                  </span>
                </div>

                <AppSurfaceCard className='border-rose-200 bg-rose-50/70 px-4 py-3 dark:border-rose-900/40 dark:bg-rose-950/20'>
                  <p className='text-sm leading-6 text-rose-900 dark:text-rose-50'>
                    当前下载进度会被清空。如果之后还要安装{' '}
                    {activeDownloadVersionLabel}
                    ，需要从头重新下载。
                  </p>
                </AppSurfaceCard>

                {downloadActionError ? (
                  <div className='rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200'>
                    {downloadActionError}
                  </div>
                ) : null}

                <div className='flex flex-col-reverse gap-3 sm:flex-row sm:justify-end'>
                  <AppButton
                    onClick={closeDownloadActionDialog}
                    disabled={isApplyingDownloadAction}
                  >
                    取消
                  </AppButton>
                  <AppButton
                    onClick={() => void handleConfirmDownloadAction()}
                    disabled={isApplyingDownloadAction}
                    variant='primary'
                    className='bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-500 dark:text-white dark:hover:bg-rose-400'
                  >
                    {isApplyingDownloadAction ? (
                      <Loader2 className='h-4 w-4 animate-spin' />
                    ) : (
                      <StopIcon className='h-4 w-4' />
                    )}
                    {pendingDownloadActionMeta.confirmText}
                  </AppButton>
                </div>
              </div>
            </AppDialogPanel>
          </div>
        </>
      ) : null}

      {isDesktopTarget ? (
        <DesktopReleaseHistoryDialog
          isOpen={isReleaseHistoryOpen}
          onClose={closeReleaseHistory}
          currentVersion={CURRENT_VERSION}
          updateState={updateState}
          changelogLocale={changelogLocale}
          onChangelogLocaleChange={handleChangelogLocaleChange}
        />
      ) : null}
    </>
  );

  if (!mounted || !isOpen) {
    return null;
  }

  return createPortal(versionPanelContent, document.body);
}
