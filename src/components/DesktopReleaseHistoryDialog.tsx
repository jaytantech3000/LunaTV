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
import {
  fetchDesktopReleaseHistory,
  isDesktopTauriRuntimeAvailable,
} from '@/lib/desktop/tauri-client';
import {
  type DesktopReleaseHistoryItem,
  fetchDesktopReleaseHistoryFromGithub,
} from '@/lib/desktop-release-history';
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

interface DesktopReleaseHistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentVersion: string;
  updateState: AppUpdateState;
}

interface DesktopReleaseHistoryResponse {
  releases?: DesktopReleaseHistoryItem[];
  error?: string;
}

const FAVORITE_RELEASES_STORAGE_KEY =
  'lunatv:desktop-release-history:favorites';

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

function getReleaseActionMeta(version: string, currentVersion: string) {
  const isRollback = compareSemver(version, currentVersion) < 0;

  return {
    isRollback,
    actionTitle: `${
      isRollback ? '\u56de\u9000\u5230' : '\u5207\u6362\u5230'
    } v${version}`,
    dialogTitle: isRollback
      ? '\u786e\u8ba4\u56de\u9000\u7248\u672c'
      : '\u786e\u8ba4\u5207\u6362\u7248\u672c',
    dialogMessage: isRollback
      ? `\u5c06\u56de\u9000\u5230 v${version}\uff0c\u5e94\u7528\u4f1a\u9759\u9ed8\u5b89\u88c5\u5e76\u81ea\u52a8\u91cd\u542f\u3002`
      : `\u5c06\u5207\u6362\u5230 v${version}\uff0c\u5e94\u7528\u4f1a\u9759\u9ed8\u5b89\u88c5\u5e76\u81ea\u52a8\u91cd\u542f\u3002`,
    confirmText: isRollback
      ? '\u786e\u8ba4\u56de\u9000'
      : '\u7acb\u5373\u5207\u6362',
    badgeText: isRollback ? '\u56de\u9000' : '\u5207\u6362',
  };
}

function formatPublishedAt(value: string | null) {
  if (!value) {
    return '发布时间未知';
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Date(timestamp).toLocaleString('zh-CN');
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

function VersionSection({
  description,
  releases,
  currentVersion,
  favoriteTagSet,
  updateState,
  onSelectRelease,
  onToggleFavorite,
}: {
  description: string;
  releases: DesktopReleaseHistoryItem[];
  currentVersion: string;
  favoriteTagSet: Set<string>;
  updateState: AppUpdateState;
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
        const isCurrentVersion = release.version === currentVersion;
        const isFavorited = favoriteTagSet.has(release.tagName);
        const isActiveVersion =
          updateState.isBusy && updateState.latestVersion === release.version;
        const actionTitle = getReleaseActionMeta(
          release.version,
          currentVersion
        ).actionTitle;
        const favoriteTitle = isFavorited
          ? `取消收藏 v${release.version}`
          : `收藏 v${release.version}`;

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
                    {release.prerelease ? 'Prerelease' : 'Release'}
                  </span>
                </div>
                <div className='flex flex-wrap items-center gap-x-2 gap-y-0 text-[11px] leading-5 text-gray-500 dark:text-gray-400'>
                  <span className='break-all'>{release.tagName}</span>
                  <span className='whitespace-nowrap'>
                    {formatPublishedAt(release.publishedAt)}
                  </span>
                </div>
              </div>

              <div className='flex items-center gap-1.5'>
                {isCurrentVersion ? (
                  <span className='inline-flex h-7 items-center rounded-full bg-emerald-100 px-2.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'>
                    当前
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
                    aria-label={`打开 v${release.version} 发布页`}
                    title='打开发布页'
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
                  aria-label={isCurrentVersion ? '当前版本' : actionTitle}
                  title={isCurrentVersion ? '当前版本' : actionTitle}
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
}: DesktopReleaseHistoryDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [releases, setReleases] = useState<DesktopReleaseHistoryItem[]>([]);
  const [favoriteTags, setFavoriteTags] = useState<string[]>([]);
  const [pendingRelease, setPendingRelease] =
    useState<DesktopReleaseHistoryItem | null>(null);

  const favoriteTagSet = useMemo(() => new Set(favoriteTags), [favoriteTags]);
  const pendingReleaseAction = pendingRelease
    ? getReleaseActionMeta(pendingRelease.version, currentVersion)
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
        aria-label='\u7248\u672c\u5217\u8868'
        className='fixed left-1/2 top-1/2 z-[1011] flex max-h-[88vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col'
      >
        <AppDialogHeader>
          <div className='flex items-center gap-3'>
            <AppIconBadge>
              <History className='h-5 w-5' />
            </AppIconBadge>
            <AppDialogTitleBlock
              title='版本列表'
              subtitle='选择指定版本后，将按桌面更新链路静默安装并自动重启。'
            />
          </div>

          <AppIconButton onClick={handleClose} aria-label='关闭版本列表'>
            <X className='h-5 w-5' />
          </AppIconButton>
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
                  正在加载版本列表...
                </div>
              </div>
            ) : (
              <>
                <section className='space-y-3'>
                  <div>
                    <h4 className='text-sm font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400'>
                      Release
                    </h4>
                    <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                      稳定版本列表。
                    </p>
                  </div>
                  <VersionSection
                    description='暂时没有可用的稳定版本。'
                    releases={groupedReleases.stable}
                    currentVersion={currentVersion}
                    favoriteTagSet={favoriteTagSet}
                    updateState={updateState}
                    onSelectRelease={handleSelectRelease}
                    onToggleFavorite={handleToggleFavorite}
                  />
                </section>

                <section className='space-y-3'>
                  <div>
                    <h4 className='text-sm font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400'>
                      Prerelease
                    </h4>
                    <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                      预发布版本列表。
                    </p>
                  </div>
                  <VersionSection
                    description='暂时没有可用的预发布版本。'
                    releases={groupedReleases.prerelease}
                    currentVersion={currentVersion}
                    favoriteTagSet={favoriteTagSet}
                    updateState={updateState}
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
              aria-label='\u786e\u8ba4\u7248\u672c\u5207\u6362'
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
                  aria-label='关闭版本确认'
                >
                  <X className='h-5 w-5' />
                </AppIconButton>
              </AppDialogHeader>

              <div className='space-y-4 px-5 py-5 sm:px-6'>
                <div className='grid gap-3 sm:grid-cols-2'>
                  <AppSurfaceCard className='bg-gray-50/80 px-4 py-3 dark:bg-gray-800/60'>
                    <p className='text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400'>
                      {'\u5f53\u524d\u7248\u672c'}
                    </p>
                    <p className='mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100'>
                      v{currentVersion}
                    </p>
                  </AppSurfaceCard>
                  <AppSurfaceCard className='bg-gray-50/80 px-4 py-3 dark:bg-gray-800/60'>
                    <p className='text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400'>
                      {'\u76ee\u6807\u7248\u672c'}
                    </p>
                    <p className='mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100'>
                      v{pendingRelease.version}
                    </p>
                  </AppSurfaceCard>
                </div>

                <AppSurfaceCard className='px-4 py-3 text-sm text-gray-600 dark:text-gray-300'>
                  {
                    '\u5b89\u88c5\u5b8c\u6210\u540e\u4f1a\u81ea\u52a8\u91cd\u542f\uff0c\u6574\u4e2a\u6d41\u7a0b\u4f1a\u590d\u7528\u5f53\u524d\u7684\u684c\u9762\u66f4\u65b0\u903b\u8f91\u3002'
                  }
                </AppSurfaceCard>

                <div className='flex flex-col-reverse gap-3 sm:flex-row sm:justify-end'>
                  <AppButton onClick={() => setPendingRelease(null)}>
                    {'\u53d6\u6d88'}
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
