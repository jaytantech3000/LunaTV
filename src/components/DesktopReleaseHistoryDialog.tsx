'use client';

import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Heart,
  History,
  Loader2,
  RotateCcw,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  type AppUpdateState,
  installDesktopReleaseVersion,
} from '@/lib/app-update';
import { type ChangelogLocale, changelog } from '@/lib/changelog';
import {
  CHANGELOG_LOCALE_OPTIONS,
  normalizeChangelogLocale,
} from '@/lib/changelog-locale';
import {
  fetchDesktopReleaseHistory,
  isDesktopTauriRuntimeAvailable,
} from '@/lib/desktop/tauri-client';
import {
  type DesktopReleaseHistoryItem,
  fetchDesktopReleaseHistoryFromGithub,
} from '@/lib/desktop-release-history';
import {
  type DesktopReleaseChangeSummary,
  buildDesktopReleaseChangeSummaryFromChangelogEntry,
  buildDesktopReleaseChangeSummaryFromNotes,
  fetchDesktopReleaseChangeSummaryFromCompareUrl,
  findDesktopReleaseChangelogEntry,
  getDesktopReleaseBaseVersion,
  hasDesktopReleaseChangeItems,
} from '@/lib/desktop-release-notes';
import { openExternalUrl } from '@/lib/open-external-url';
import {
  getDesktopReleaseHistoryProxyUrl,
  getReleaseRepository,
} from '@/lib/release-urls';
import { isDesktopAppTarget } from '@/lib/runtime-config';
import { acquireScrollLock } from '@/lib/scroll-lock';
import { compareSemver } from '@/lib/semver';

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

interface DesktopReleaseHistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentVersion: string;
  updateState: AppUpdateState;
  changelogLocale?: ChangelogLocale;
  onChangelogLocaleChange?: (locale: ChangelogLocale) => void;
}

interface DesktopReleaseHistoryResponse {
  releases?: DesktopReleaseHistoryItem[];
  error?: string;
}

const FAVORITE_RELEASES_STORAGE_KEY =
  'lunatv:desktop-release-history:favorites';
const releaseChangeSummaryCache = new Map<
  string,
  DesktopReleaseChangeSummary | null
>();

function getReleaseChangeSummaryCacheKey(
  release: Pick<DesktopReleaseHistoryItem, 'tagName' | 'notes'>
) {
  return `${release.tagName}:${release.notes?.trim() || ''}`;
}

const RELEASE_HISTORY_COPY: Record<
  ChangelogLocale,
  {
    dialogLabel: string;
    dialogTitle: string;
    dialogSubtitle: string;
    closeDialogLabel: string;
    loadingList: string;
    stableSectionTitle: string;
    stableSectionDescription: string;
    stableEmptyText: string;
    prereleaseSectionTitle: string;
    prereleaseSectionDescription: string;
    prereleaseEmptyText: string;
    currentBadge: string;
    releaseBadge: string;
    prereleaseBadge: string;
    unknownPublishedAt: string;
    favoriteLabel: (version: string, active: boolean) => string;
    openReleasePageLabel: (version: string) => string;
    currentVersionActionLabel: string;
    confirmDialogLabel: string;
    confirmCloseLabel: string;
    currentVersionLabel: string;
    targetVersionLabel: string;
    installFlowHint: string;
    cancelLabel: string;
    changeSummaryTitle: string;
    compareLabel: string;
    addedLabel: string;
    changedLabel: string;
    fixedLabel: string;
    otherLabel: string;
    moreItemsLabel: (count: number) => string;
    loadingSummary: string;
    compareOnlyHint: string;
  }
> = {
  'zh-CN': {
    dialogLabel: '版本列表',
    dialogTitle: '版本列表',
    dialogSubtitle: '选择指定版本后，将按桌面更新链路静默安装并自动重启。',
    closeDialogLabel: '关闭版本列表',
    loadingList: '正在加载版本列表...',
    stableSectionTitle: '正式版',
    stableSectionDescription: '稳定版本列表。',
    stableEmptyText: '暂时没有可用的稳定版本。',
    prereleaseSectionTitle: '预发布',
    prereleaseSectionDescription: '预发布版本列表。',
    prereleaseEmptyText: '暂时没有可用的预发布版本。',
    currentBadge: '当前',
    releaseBadge: '正式版',
    prereleaseBadge: '预发布',
    unknownPublishedAt: '发布时间未知',
    favoriteLabel: (version, active) =>
      `${active ? '取消收藏' : '收藏'} v${version}`,
    openReleasePageLabel: (version) => `打开 v${version} 发布页`,
    currentVersionActionLabel: '当前版本',
    confirmDialogLabel: '确认版本切换',
    confirmCloseLabel: '关闭版本确认',
    currentVersionLabel: '当前版本',
    targetVersionLabel: '目标版本',
    installFlowHint: '安装完成后会自动重启，整个流程会复用当前的桌面更新逻辑。',
    cancelLabel: '取消',
    changeSummaryTitle: '本次变更',
    compareLabel: '完整对比',
    addedLabel: '新增功能',
    changedLabel: '优化调整',
    fixedLabel: '问题修复',
    otherLabel: '其他调整',
    moreItemsLabel: (count) => `还有 ${count} 项变更...`,
    loadingSummary: '正在读取本次提交变更...',
    compareOnlyHint:
      '当前 release 只记录了 compare 链接，可通过“完整对比”查看本次提交详情。',
  },
  en: {
    dialogLabel: 'Version history',
    dialogTitle: 'Version history',
    dialogSubtitle:
      'Select a target version to install it quietly through the desktop updater flow and restart automatically.',
    closeDialogLabel: 'Close version history',
    loadingList: 'Loading version history...',
    stableSectionTitle: 'Release',
    stableSectionDescription: 'Stable releases.',
    stableEmptyText: 'No stable releases are available right now.',
    prereleaseSectionTitle: 'Prerelease',
    prereleaseSectionDescription: 'Prerelease builds.',
    prereleaseEmptyText: 'No prerelease builds are available right now.',
    currentBadge: 'Current',
    releaseBadge: 'Release',
    prereleaseBadge: 'Prerelease',
    unknownPublishedAt: 'Published date unavailable',
    favoriteLabel: (version, active) =>
      `${active ? 'Unfavorite' : 'Favorite'} v${version}`,
    openReleasePageLabel: (version) => `Open v${version} release page`,
    currentVersionActionLabel: 'Current version',
    confirmDialogLabel: 'Confirm version switch',
    confirmCloseLabel: 'Close version confirmation',
    currentVersionLabel: 'Current version',
    targetVersionLabel: 'Target version',
    installFlowHint:
      'The app will restart automatically after installation and reuse the current desktop update flow.',
    cancelLabel: 'Cancel',
    changeSummaryTitle: 'Changes',
    compareLabel: 'Full compare',
    addedLabel: 'Added',
    changedLabel: 'Changed',
    fixedLabel: 'Fixed',
    otherLabel: 'Other',
    moreItemsLabel: (count) => `${count} more changes...`,
    loadingSummary: 'Loading commit summary...',
    compareOnlyHint:
      'This release only includes a compare link. Use “Full compare” to inspect the commit details.',
  },
};

function readFavoriteReleaseTags(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(FAVORITE_RELEASES_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function persistFavoriteReleaseTags(tags: string[]) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      FAVORITE_RELEASES_STORAGE_KEY,
      JSON.stringify(tags)
    );
  } catch (_) {
    // Ignore local persistence failures and keep the in-memory state.
  }
}

function comparePublishedAt(left: string | null, right: string | null) {
  const leftTimestamp = left ? Date.parse(left) : Number.NEGATIVE_INFINITY;
  const rightTimestamp = right ? Date.parse(right) : Number.NEGATIVE_INFINITY;

  return rightTimestamp - leftTimestamp;
}

function sortReleaseSection(
  releases: DesktopReleaseHistoryItem[],
  favoriteTagSet: Set<string>,
  currentVersion: string
) {
  return [...releases].sort((left, right) => {
    const leftIsCurrent = left.version === currentVersion;
    const rightIsCurrent = right.version === currentVersion;
    if (leftIsCurrent !== rightIsCurrent) {
      return leftIsCurrent ? -1 : 1;
    }

    const leftIsFavorited = favoriteTagSet.has(left.tagName);
    const rightIsFavorited = favoriteTagSet.has(right.tagName);
    if (leftIsFavorited !== rightIsFavorited) {
      return leftIsFavorited ? -1 : 1;
    }

    const versionOrder = compareSemver(right.version, left.version);
    if (versionOrder !== 0) {
      return versionOrder;
    }

    return comparePublishedAt(left.publishedAt, right.publishedAt);
  });
}

function getReleaseActionMeta(
  version: string,
  currentVersion: string,
  locale: ChangelogLocale
) {
  const isRollback = compareSemver(version, currentVersion) < 0;
  const copy =
    locale === 'en'
      ? {
          rollbackTo: 'Rollback to',
          switchTo: 'Switch to',
          rollbackDialogTitle: 'Confirm rollback',
          switchDialogTitle: 'Confirm version switch',
          rollbackDialogMessage: `MoonTV will roll back to v${version}, install it quietly, and restart automatically.`,
          switchDialogMessage: `MoonTV will switch to v${version}, install it quietly, and restart automatically.`,
          rollbackConfirmText: 'Confirm rollback',
          switchConfirmText: 'Install now',
          rollbackBadgeText: 'Rollback',
          switchBadgeText: 'Switch',
        }
      : {
          rollbackTo: '回退到',
          switchTo: '切换到',
          rollbackDialogTitle: '确认回退版本',
          switchDialogTitle: '确认切换版本',
          rollbackDialogMessage: `将回退到 v${version}，应用会静默安装并自动重启。`,
          switchDialogMessage: `将切换到 v${version}，应用会静默安装并自动重启。`,
          rollbackConfirmText: '确认回退',
          switchConfirmText: '立即切换',
          rollbackBadgeText: '回退',
          switchBadgeText: '切换',
        };

  return {
    isRollback,
    actionTitle: `${isRollback ? copy.rollbackTo : copy.switchTo} v${version}`,
    dialogTitle: isRollback ? copy.rollbackDialogTitle : copy.switchDialogTitle,
    dialogMessage: isRollback
      ? copy.rollbackDialogMessage
      : copy.switchDialogMessage,
    confirmText: isRollback ? copy.rollbackConfirmText : copy.switchConfirmText,
    badgeText: isRollback ? copy.rollbackBadgeText : copy.switchBadgeText,
  };
}

function formatPublishedAt(value: string | null, locale: ChangelogLocale) {
  if (!value) {
    return RELEASE_HISTORY_COPY[locale].unknownPublishedAt;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Date(timestamp).toLocaleString(locale === 'en' ? 'en' : 'zh-CN');
}

function isJsonResponse(response: Response) {
  const contentType = response.headers.get('content-type');
  return Boolean(contentType?.toLowerCase().includes('application/json'));
}

async function fetchDesktopReleaseHistoryFromProxy(
  url: string,
  signal: AbortSignal
) {
  const response = await fetch(url, {
    signal,
    cache: 'no-store',
  });

  if (!isJsonResponse(response)) {
    throw new Error('Unexpected desktop release proxy response.');
  }

  const payload =
    (await response.json()) as DesktopReleaseHistoryResponse | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? `HTTP ${response.status}`);
  }

  const releases = payload?.releases;
  return Array.isArray(releases) ? releases : [];
}

async function fetchDesktopReleaseHistoryFromDesktopShell() {
  return fetchDesktopReleaseHistory(getReleaseRepository());
}

async function loadDesktopReleaseHistory(signal: AbortSignal) {
  const desktopReleaseProxyUrl = getDesktopReleaseHistoryProxyUrl();

  if (isDesktopAppTarget()) {
    if (isDesktopTauriRuntimeAvailable()) {
      try {
        return await fetchDesktopReleaseHistoryFromDesktopShell();
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
      }
    }

    if (desktopReleaseProxyUrl) {
      try {
        return await fetchDesktopReleaseHistoryFromProxy(
          desktopReleaseProxyUrl,
          signal
        );
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
      }
    }

    return fetchDesktopReleaseHistoryFromGithub({ signal });
  }

  try {
    return await fetchDesktopReleaseHistoryFromProxy(
      '/api/desktop/releases',
      signal
    );
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    return fetchDesktopReleaseHistoryFromGithub({ signal });
  }
}

function shouldLoadReleaseCompareSummary(
  summary: DesktopReleaseChangeSummary | null | undefined
) {
  return Boolean(summary?.compareUrl && !hasDesktopReleaseChangeItems(summary));
}

function ReleaseChangeSummaryPanel({
  version,
  summary,
  isLoading,
  locale,
}: {
  version: string;
  summary: DesktopReleaseChangeSummary | null | undefined;
  isLoading: boolean;
  locale: ChangelogLocale;
}) {
  if (!summary && !isLoading) {
    return null;
  }

  const releaseHistoryCopy = RELEASE_HISTORY_COPY[locale];

  const hasSubstantiveChanges = Boolean(
    summary &&
      (summary.added.length > 0 ||
        summary.changed.length > 0 ||
        summary.fixed.length > 0)
  );
  const changeGroups = [
    {
      key: 'added',
      label: releaseHistoryCopy.addedLabel,
      items: summary?.added || [],
      toneClassName:
        'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
      dotClassName: 'bg-emerald-500',
    },
    {
      key: 'changed',
      label: releaseHistoryCopy.changedLabel,
      items: summary?.changed || [],
      toneClassName:
        'bg-sky-500/10 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200',
      dotClassName: 'bg-sky-500',
    },
    {
      key: 'fixed',
      label: releaseHistoryCopy.fixedLabel,
      items: summary?.fixed || [],
      toneClassName:
        'bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200',
      dotClassName: 'bg-amber-500',
    },
    {
      key: 'other',
      label: releaseHistoryCopy.otherLabel,
      items: hasSubstantiveChanges && summary ? [] : summary?.other || [],
      toneClassName:
        'bg-gray-500/10 text-gray-700 dark:bg-gray-500/15 dark:text-gray-200',
      dotClassName: 'bg-gray-500',
    },
  ].filter((group) => group.items.length > 0);

  if (changeGroups.length === 0 && !isLoading && !summary?.compareUrl) {
    return null;
  }

  return (
    <div className='mt-3 rounded-xl border border-gray-200/80 bg-gray-50/80 px-3 py-3 dark:border-gray-700/70 dark:bg-gray-950/40'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='text-[11px] font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400'>
          {releaseHistoryCopy.changeSummaryTitle}
        </div>
        {summary?.compareUrl ? (
          <button
            type='button'
            onClick={() => void openExternalUrl(summary.compareUrl || '')}
            className='text-[11px] font-medium text-emerald-700 transition-colors hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200'
            aria-label={`${releaseHistoryCopy.compareLabel} v${version}`}
          >
            {releaseHistoryCopy.compareLabel}
          </button>
        ) : null}
      </div>

      {changeGroups.length > 0 ? (
        <div className='mt-2.5 space-y-2.5'>
          {changeGroups.map((group) => {
            const visibleItems = group.items.slice(0, 2);
            const hiddenCount = group.items.length - visibleItems.length;

            return (
              <div key={group.key} className='space-y-1.5'>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${group.toneClassName}`}
                >
                  {group.label}
                </span>
                <ul className='space-y-1 text-xs leading-5 text-gray-600 dark:text-gray-300'>
                  {visibleItems.map((item) => (
                    <li
                      key={`${group.key}-${item}`}
                      className='flex items-start gap-2'
                    >
                      <span
                        className={`mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full ${group.dotClassName}`}
                      />
                      <span className='min-w-0 break-words'>{item}</span>
                    </li>
                  ))}
                  {hiddenCount > 0 ? (
                    <li className='text-[11px] text-gray-500 dark:text-gray-400'>
                      {releaseHistoryCopy.moreItemsLabel(hiddenCount)}
                    </li>
                  ) : null}
                </ul>
              </div>
            );
          })}
        </div>
      ) : isLoading ? (
        <div className='mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400'>
          <Loader2 className='h-3.5 w-3.5 animate-spin' />
          {releaseHistoryCopy.loadingSummary}
        </div>
      ) : summary?.compareUrl ? (
        <div className='mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400'>
          {releaseHistoryCopy.compareOnlyHint}
        </div>
      ) : null}
    </div>
  );
}

function VersionSection({
  description,
  releases,
  releaseChangeSummaries,
  loadingReleaseChangeSummaries,
  currentVersion,
  favoriteTagSet,
  updateState,
  locale,
  onSelectRelease,
  onToggleFavorite,
}: {
  description: string;
  releases: DesktopReleaseHistoryItem[];
  releaseChangeSummaries: Record<string, DesktopReleaseChangeSummary | null>;
  loadingReleaseChangeSummaries: Record<string, boolean>;
  currentVersion: string;
  favoriteTagSet: Set<string>;
  updateState: AppUpdateState;
  locale: ChangelogLocale;
  onSelectRelease: (release: DesktopReleaseHistoryItem) => void;
  onToggleFavorite: (release: DesktopReleaseHistoryItem) => void;
}) {
  if (!releases.length) {
    return (
      <div className='rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 p-4 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400'>
        {description}
      </div>
    );
  }

  return (
    <div className='space-y-2.5'>
      {releases.map((release) => {
        const releaseHistoryCopy = RELEASE_HISTORY_COPY[locale];
        const isCurrentVersion = release.version === currentVersion;
        const isFavorited = favoriteTagSet.has(release.tagName);
        const isActiveVersion =
          updateState.isBusy && updateState.latestVersion === release.version;
        const releaseChangeSummary =
          releaseChangeSummaries[release.tagName] || null;
        const isLoadingReleaseChangeSummary = Boolean(
          loadingReleaseChangeSummaries[release.tagName]
        );
        const actionTitle = getReleaseActionMeta(
          release.version,
          currentVersion,
          locale
        ).actionTitle;
        const favoriteTitle = releaseHistoryCopy.favoriteLabel(
          release.version,
          isFavorited
        );

        return (
          <div
            key={release.id}
            data-testid={`desktop-release-card-${release.tagName}`}
            className={`rounded-2xl border px-4 py-3 shadow-sm transition-colors ${
              isCurrentVersion
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                : isFavorited
                ? 'border-rose-200 bg-rose-50/70 dark:border-rose-900/40 dark:bg-rose-950/10'
                : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/70'
            }`}
          >
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0 space-y-1.5'>
                <div className='flex flex-wrap items-center gap-1.5'>
                  <h4 className='text-[15px] font-semibold leading-6 text-gray-900 dark:text-gray-100'>
                    v{release.version}
                  </h4>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ${
                      release.prerelease
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
                        : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200'
                    }`}
                  >
                    {release.prerelease
                      ? releaseHistoryCopy.prereleaseBadge
                      : releaseHistoryCopy.releaseBadge}
                  </span>
                </div>
                <div className='flex flex-wrap items-center gap-x-2 gap-y-0 text-[11px] leading-5 text-gray-500 dark:text-gray-400'>
                  <span className='break-all'>{release.tagName}</span>
                  <span className='whitespace-nowrap'>
                    {formatPublishedAt(release.publishedAt, locale)}
                  </span>
                </div>
              </div>

              <div className='flex items-center gap-1.5'>
                {isCurrentVersion ? (
                  <span className='inline-flex h-7 items-center rounded-full bg-emerald-100 px-2.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'>
                    {releaseHistoryCopy.currentBadge}
                  </span>
                ) : null}

                <button
                  type='button'
                  onClick={() => onToggleFavorite(release)}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                    isFavorited
                      ? 'bg-rose-100 text-rose-600 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50'
                      : 'text-gray-500 hover:bg-gray-100 hover:text-rose-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-rose-300'
                  }`}
                  aria-label={favoriteTitle}
                  aria-pressed={isFavorited}
                  title={favoriteTitle}
                >
                  <Heart
                    className='h-3.5 w-3.5'
                    fill={isFavorited ? 'currentColor' : 'none'}
                  />
                </button>

                {release.htmlUrl ? (
                  <AppIconButton
                    onClick={() => void openExternalUrl(release.htmlUrl || '')}
                    variant='ghost'
                    className='h-8 w-8'
                    aria-label={releaseHistoryCopy.openReleasePageLabel(
                      release.version
                    )}
                    title={releaseHistoryCopy.openReleasePageLabel(
                      release.version
                    )}
                  >
                    <ExternalLink className='h-3.5 w-3.5' />
                  </AppIconButton>
                ) : null}

                <button
                  type='button'
                  disabled={isCurrentVersion || updateState.isBusy}
                  onClick={() => onSelectRelease(release)}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                    isCurrentVersion
                      ? 'cursor-default bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
                      : 'bg-gray-900 text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'
                  }`}
                  aria-label={
                    isCurrentVersion
                      ? releaseHistoryCopy.currentVersionActionLabel
                      : actionTitle
                  }
                  title={
                    isCurrentVersion
                      ? releaseHistoryCopy.currentVersionActionLabel
                      : actionTitle
                  }
                >
                  {isCurrentVersion ? (
                    <CheckCircle2 className='h-3.5 w-3.5' />
                  ) : isActiveVersion ? (
                    <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  ) : (
                    <RotateCcw className='h-3.5 w-3.5' />
                  )}
                </button>
              </div>
            </div>

            <ReleaseChangeSummaryPanel
              version={release.version}
              summary={releaseChangeSummary}
              isLoading={isLoadingReleaseChangeSummary}
              locale={locale}
            />
          </div>
        );
      })}
    </div>
  );
}

export function DesktopReleaseHistoryDialog({
  isOpen,
  onClose,
  currentVersion,
  updateState,
  changelogLocale,
  onChangelogLocaleChange,
}: DesktopReleaseHistoryDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [releases, setReleases] = useState<DesktopReleaseHistoryItem[]>([]);
  const [releaseChangeSummaries, setReleaseChangeSummaries] = useState<
    Record<string, DesktopReleaseChangeSummary | null>
  >({});
  const [loadingReleaseChangeSummaries, setLoadingReleaseChangeSummaries] =
    useState<Record<string, boolean>>({});
  const [favoriteTags, setFavoriteTags] = useState<string[]>([]);
  const [pendingRelease, setPendingRelease] =
    useState<DesktopReleaseHistoryItem | null>(null);

  const effectiveChangelogLocale = normalizeChangelogLocale(changelogLocale);
  const releaseHistoryCopy = RELEASE_HISTORY_COPY[effectiveChangelogLocale];
  const favoriteTagSet = useMemo(() => new Set(favoriteTags), [favoriteTags]);
  const pendingReleaseAction = pendingRelease
    ? getReleaseActionMeta(
        pendingRelease.version,
        currentVersion,
        effectiveChangelogLocale
      )
    : null;

  const groupedReleases = useMemo(() => {
    const stable = sortReleaseSection(
      releases.filter((release) => !release.prerelease),
      favoriteTagSet,
      currentVersion
    );
    const prerelease = sortReleaseSection(
      releases.filter((release) => release.prerelease),
      favoriteTagSet,
      currentVersion
    );

    return {
      stable,
      prerelease,
    };
  }, [currentVersion, favoriteTagSet, releases]);

  useEffect(() => {
    setMounted(true);
    setFavoriteTags(readFavoriteReleaseTags());
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
      setPendingRelease(null);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setErrorMessage(null);

    void (async () => {
      try {
        const nextReleases = await loadDesktopReleaseHistory(controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        setReleases(nextReleases);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setReleases([]);
        setErrorMessage(
          error instanceof Error ? error.message : '获取版本列表失败。'
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!releases.length) {
      setReleaseChangeSummaries({});
      setLoadingReleaseChangeSummaries({});
      return;
    }

    const controller = new AbortController();
    const stableReleaseVersions = new Set(
      releases
        .filter((release) => !release.prerelease)
        .map((release) => release.version)
    );
    const nextReleaseChangeSummaries: Record<
      string,
      DesktopReleaseChangeSummary | null
    > = {};
    const compareSummaryTargets: Array<{
      cacheKey: string;
      tagName: string;
      compareUrl: string;
      fallbackSummary: DesktopReleaseChangeSummary;
    }> = [];

    releases.forEach((release) => {
      const exactChangelogSummary =
        buildDesktopReleaseChangeSummaryFromChangelogEntry(
          findDesktopReleaseChangelogEntry(changelog, {
            releaseVersion: release.version,
          }),
          effectiveChangelogLocale
        );

      if (exactChangelogSummary) {
        nextReleaseChangeSummaries[release.tagName] = exactChangelogSummary;
        return;
      }

      const cacheKey = getReleaseChangeSummaryCacheKey(release);
      const cachedSummary = releaseChangeSummaryCache.get(cacheKey);
      const initialSummary =
        cachedSummary !== undefined
          ? cachedSummary
          : buildDesktopReleaseChangeSummaryFromNotes(release.notes);

      if (cachedSummary === undefined) {
        releaseChangeSummaryCache.set(cacheKey, initialSummary || null);
      }

      if (initialSummary) {
        nextReleaseChangeSummaries[release.tagName] = initialSummary;

        if (shouldLoadReleaseCompareSummary(initialSummary)) {
          compareSummaryTargets.push({
            cacheKey,
            tagName: release.tagName,
            compareUrl: initialSummary.compareUrl || '',
            fallbackSummary: initialSummary,
          });
        }
        return;
      }

      const releaseBaseVersion = getDesktopReleaseBaseVersion(release.version);
      const prereleaseBaseChangelogSummary =
        release.prerelease &&
        Boolean(releaseBaseVersion) &&
        !stableReleaseVersions.has(releaseBaseVersion || '')
          ? buildDesktopReleaseChangeSummaryFromChangelogEntry(
              findDesktopReleaseChangelogEntry(changelog, {
                releaseVersion: release.version,
                allowPrereleaseBaseMatch: true,
              }),
              effectiveChangelogLocale
            )
          : null;

      nextReleaseChangeSummaries[release.tagName] =
        prereleaseBaseChangelogSummary || null;
    });

    setReleaseChangeSummaries(nextReleaseChangeSummaries);
    setLoadingReleaseChangeSummaries(
      compareSummaryTargets.reduce<Record<string, boolean>>(
        (currentState, target) => {
          currentState[target.tagName] = true;
          return currentState;
        },
        {}
      )
    );

    compareSummaryTargets.forEach((target) => {
      void (async () => {
        try {
          const fetchedSummary =
            await fetchDesktopReleaseChangeSummaryFromCompareUrl(
              target.compareUrl,
              {
                signal: controller.signal,
              }
            );
          if (controller.signal.aborted) {
            return;
          }

          const nextSummary = fetchedSummary || target.fallbackSummary;
          releaseChangeSummaryCache.set(target.cacheKey, nextSummary);
          setReleaseChangeSummaries((current) => ({
            ...current,
            [target.tagName]: nextSummary,
          }));
        } catch {
          if (controller.signal.aborted) {
            return;
          }

          setReleaseChangeSummaries((current) => ({
            ...current,
            [target.tagName]: target.fallbackSummary,
          }));
        } finally {
          if (!controller.signal.aborted) {
            setLoadingReleaseChangeSummaries((current) => ({
              ...current,
              [target.tagName]: false,
            }));
          }
        }
      })();
    });

    return () => {
      controller.abort();
    };
  }, [effectiveChangelogLocale, releases]);

  const handleToggleFavorite = (release: DesktopReleaseHistoryItem) => {
    setFavoriteTags((current) => {
      const nextSet = new Set(current);

      if (nextSet.has(release.tagName)) {
        nextSet.delete(release.tagName);
      } else {
        nextSet.add(release.tagName);
      }

      const nextTags = Array.from(nextSet);
      persistFavoriteReleaseTags(nextTags);
      return nextTags;
    });
  };

  const handleClose = () => {
    setPendingRelease(null);
    onClose();
  };

  const handleSelectRelease = (release: DesktopReleaseHistoryItem) => {
    if (updateState.isBusy) {
      return;
    }

    setPendingRelease(release);
  };

  const handleConfirmRelease = () => {
    if (!pendingRelease) {
      return;
    }

    const selectedRelease = pendingRelease;
    setPendingRelease(null);
    onClose();
    void installDesktopReleaseVersion({
      manifestUrl: selectedRelease.manifestUrl,
      version: selectedRelease.version,
      publishedAt: selectedRelease.publishedAt,
      releaseNotes: selectedRelease.notes,
    });
  };

  const handleChangelogLocaleChange = (value: string) => {
    onChangelogLocaleChange?.(normalizeChangelogLocale(value));
  };

  if (!mounted || !isOpen) {
    return null;
  }

  return createPortal(
    <>
      <AppDialogBackdrop
        className='z-[1010] bg-black/45 backdrop-blur-sm'
        onClick={handleClose}
      />

      <AppDialogPanel
        role='dialog'
        aria-modal='true'
        aria-label={releaseHistoryCopy.dialogLabel}
        className='fixed left-1/2 top-1/2 z-[1011] flex max-h-[88vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col'
      >
        <AppDialogHeader className='items-start gap-4'>
          <div className='flex min-w-0 flex-1 items-center gap-3'>
            <AppIconBadge>
              <History className='h-5 w-5' />
            </AppIconBadge>
            <AppDialogTitleBlock
              title={releaseHistoryCopy.dialogTitle}
              subtitle={releaseHistoryCopy.dialogSubtitle}
            />
          </div>

          <div className='flex flex-col items-end gap-3 sm:flex-row sm:items-center'>
            <CapsuleSwitch
              options={[...CHANGELOG_LOCALE_OPTIONS]}
              active={effectiveChangelogLocale}
              onChange={handleChangelogLocaleChange}
              className='shrink-0'
            />
            <AppIconButton
              onClick={handleClose}
              aria-label={releaseHistoryCopy.closeDialogLabel}
            >
              <X className='h-5 w-5' />
            </AppIconButton>
          </div>
        </AppDialogHeader>

        <div className='flex-1 overflow-y-auto px-5 py-5 sm:px-6'>
          <div className='space-y-6'>
            {errorMessage ? (
              <div className='flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100'>
                <AlertCircle className='mt-0.5 h-4 w-4 flex-shrink-0' />
                <span>{errorMessage}</span>
              </div>
            ) : null}

            {isLoading ? (
              <div className='flex min-h-[240px] items-center justify-center rounded-2xl border border-gray-200 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-800/30'>
                <div className='flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400'>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  {releaseHistoryCopy.loadingList}
                </div>
              </div>
            ) : (
              <>
                <section className='space-y-3'>
                  <div>
                    <h4 className='text-sm font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400'>
                      {releaseHistoryCopy.stableSectionTitle}
                    </h4>
                    <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                      {releaseHistoryCopy.stableSectionDescription}
                    </p>
                  </div>
                  <VersionSection
                    description={releaseHistoryCopy.stableEmptyText}
                    releases={groupedReleases.stable}
                    releaseChangeSummaries={releaseChangeSummaries}
                    loadingReleaseChangeSummaries={
                      loadingReleaseChangeSummaries
                    }
                    currentVersion={currentVersion}
                    favoriteTagSet={favoriteTagSet}
                    updateState={updateState}
                    locale={effectiveChangelogLocale}
                    onSelectRelease={handleSelectRelease}
                    onToggleFavorite={handleToggleFavorite}
                  />
                </section>

                <section className='space-y-3'>
                  <div>
                    <h4 className='text-sm font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400'>
                      {releaseHistoryCopy.prereleaseSectionTitle}
                    </h4>
                    <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                      {releaseHistoryCopy.prereleaseSectionDescription}
                    </p>
                  </div>
                  <VersionSection
                    description={releaseHistoryCopy.prereleaseEmptyText}
                    releases={groupedReleases.prerelease}
                    releaseChangeSummaries={releaseChangeSummaries}
                    loadingReleaseChangeSummaries={
                      loadingReleaseChangeSummaries
                    }
                    currentVersion={currentVersion}
                    favoriteTagSet={favoriteTagSet}
                    updateState={updateState}
                    locale={effectiveChangelogLocale}
                    onSelectRelease={handleSelectRelease}
                    onToggleFavorite={handleToggleFavorite}
                  />
                </section>
              </>
            )}
          </div>
        </div>
      </AppDialogPanel>

      {pendingRelease && pendingReleaseAction ? (
        <>
          <AppDialogBackdrop
            className='z-[1012]'
            onClick={() => setPendingRelease(null)}
          />
          <div className='fixed left-1/2 top-1/2 z-[1013] w-full max-w-md -translate-x-1/2 -translate-y-1/2 px-4'>
            <AppDialogPanel
              role='dialog'
              aria-modal='true'
              aria-label={releaseHistoryCopy.confirmDialogLabel}
              data-testid='desktop-release-confirm-dialog'
              className='overflow-hidden'
            >
              <AppDialogHeader>
                <div className='flex items-start gap-3'>
                  <AppIconBadge
                    className='mt-0.5 flex-shrink-0'
                    tone={pendingReleaseAction.isRollback ? 'amber' : 'sky'}
                  >
                    <RotateCcw className='h-5 w-5' />
                  </AppIconBadge>
                  <div className='min-w-0 space-y-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                        {pendingReleaseAction.dialogTitle}
                      </h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          pendingReleaseAction.isRollback
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
                            : 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200'
                        }`}
                      >
                        {pendingReleaseAction.badgeText}
                      </span>
                    </div>
                    <p className='text-sm leading-6 text-gray-500 dark:text-gray-400'>
                      {pendingReleaseAction.dialogMessage}
                    </p>
                  </div>
                </div>
                <AppIconButton
                  onClick={() => setPendingRelease(null)}
                  aria-label={releaseHistoryCopy.confirmCloseLabel}
                >
                  <X className='h-5 w-5' />
                </AppIconButton>
              </AppDialogHeader>

              <div className='space-y-4 px-5 py-5 sm:px-6'>
                <div className='grid gap-3 sm:grid-cols-2'>
                  <AppSurfaceCard className='bg-gray-50/80 px-4 py-3 dark:bg-gray-800/60'>
                    <p className='text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400'>
                      {releaseHistoryCopy.currentVersionLabel}
                    </p>
                    <p className='mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100'>
                      v{currentVersion}
                    </p>
                  </AppSurfaceCard>
                  <AppSurfaceCard className='bg-gray-50/80 px-4 py-3 dark:bg-gray-800/60'>
                    <p className='text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400'>
                      {releaseHistoryCopy.targetVersionLabel}
                    </p>
                    <p className='mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100'>
                      v{pendingRelease.version}
                    </p>
                  </AppSurfaceCard>
                </div>

                <AppSurfaceCard className='px-4 py-3 text-sm text-gray-600 dark:text-gray-300'>
                  {releaseHistoryCopy.installFlowHint}
                </AppSurfaceCard>

                <div className='flex flex-col-reverse gap-3 sm:flex-row sm:justify-end'>
                  <AppButton onClick={() => setPendingRelease(null)}>
                    {releaseHistoryCopy.cancelLabel}
                  </AppButton>
                  <AppButton onClick={handleConfirmRelease} variant='primary'>
                    {pendingReleaseAction.confirmText}
                  </AppButton>
                </div>
              </div>
            </AppDialogPanel>
          </div>
        </>
      ) : null}
    </>,
    document.body
  );
}
