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
  type DesktopReleaseHistoryItem,
  fetchDesktopReleaseHistoryFromGithub,
} from '@/lib/desktop-release-history';
import { isDesktopAppTarget } from '@/lib/runtime-config';
import { acquireScrollLock } from '@/lib/scroll-lock';
import { compareSemver } from '@/lib/semver';

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

async function loadDesktopReleaseHistory(signal: AbortSignal) {
  if (isDesktopAppTarget()) {
    return fetchDesktopReleaseHistoryFromGithub({ signal });
  }

  try {
    const response = await fetch('/api/desktop/releases', {
      signal,
      cache: 'no-store',
    });

    if (!isJsonResponse(response)) {
      return fetchDesktopReleaseHistoryFromGithub({ signal });
    }

    const payload =
      (await response.json()) as DesktopReleaseHistoryResponse | null;

    if (!response.ok) {
      throw new Error(payload?.error ?? `HTTP ${response.status}`);
    }

    const releases = payload?.releases;
    return Array.isArray(releases) ? releases : [];
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
      <div className='rounded-xl border border-dashed border-gray-200 bg-gray-50/80 p-4 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400'>
        {description}
      </div>
    );
  }

  return (
    <div className='space-y-3'>
      {releases.map((release) => {
        const isCurrentVersion = release.version === currentVersion;
        const isFavorited = favoriteTagSet.has(release.tagName);
        const isActiveVersion =
          updateState.isBusy && updateState.latestVersion === release.version;
        const actionTitle =
          compareSemver(release.version, currentVersion) < 0
            ? `回退到 v${release.version}`
            : `切换到 v${release.version}`;
        const favoriteTitle = isFavorited
          ? `取消收藏 v${release.version}`
          : `收藏 v${release.version}`;

        return (
          <div
            key={release.id}
            data-testid={`desktop-release-card-${release.tagName}`}
            className={`rounded-xl border p-4 transition-colors ${
              isCurrentVersion
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                : isFavorited
                ? 'border-rose-200 bg-rose-50/70 dark:border-rose-900/40 dark:bg-rose-950/10'
                : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/70'
            }`}
          >
            <div className='flex items-start justify-between gap-4'>
              <div className='min-w-0 space-y-2'>
                <div className='flex flex-wrap items-center gap-2'>
                  <h4 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                    v{release.version}
                  </h4>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      release.prerelease
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
                        : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200'
                    }`}
                  >
                    {release.prerelease ? 'Prerelease' : 'Release'}
                  </span>
                </div>
                <p className='break-all text-xs text-gray-500 dark:text-gray-400'>
                  {release.tagName}
                </p>
                <p className='text-sm text-gray-500 dark:text-gray-400'>
                  {formatPublishedAt(release.publishedAt)}
                </p>
              </div>

              <div className='flex items-center gap-2'>
                {isCurrentVersion ? (
                  <span className='inline-flex h-8 items-center rounded-full bg-emerald-100 px-3 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'>
                    当前
                  </span>
                ) : null}

                <button
                  type='button'
                  onClick={() => onToggleFavorite(release)}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                    isFavorited
                      ? 'bg-rose-100 text-rose-600 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50'
                      : 'text-gray-500 hover:bg-gray-100 hover:text-rose-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-rose-300'
                  }`}
                  aria-label={favoriteTitle}
                  aria-pressed={isFavorited}
                  title={favoriteTitle}
                >
                  <Heart
                    className='h-4 w-4'
                    fill={isFavorited ? 'currentColor' : 'none'}
                  />
                </button>

                {release.htmlUrl ? (
                  <button
                    type='button'
                    onClick={() =>
                      window.open(
                        release.htmlUrl || '',
                        '_blank',
                        'noopener,noreferrer'
                      )
                    }
                    className='inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'
                    aria-label={`打开 v${release.version} 发布页`}
                    title='打开发布页'
                  >
                    <ExternalLink className='h-4 w-4' />
                  </button>
                ) : null}

                <button
                  type='button'
                  disabled={isCurrentVersion || updateState.isBusy}
                  onClick={() => onSelectRelease(release)}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                    isCurrentVersion
                      ? 'cursor-default bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
                      : 'bg-gray-900 text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'
                  }`}
                  aria-label={isCurrentVersion ? '当前版本' : actionTitle}
                  title={isCurrentVersion ? '当前版本' : actionTitle}
                >
                  {isCurrentVersion ? (
                    <CheckCircle2 className='h-4 w-4' />
                  ) : isActiveVersion ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : (
                    <RotateCcw className='h-4 w-4' />
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

  const favoriteTagSet = useMemo(() => new Set(favoriteTags), [favoriteTags]);

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
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setErrorMessage(null);

    void (async () => {
      try {
        const nextReleases = await loadDesktopReleaseHistory(controller.signal);
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

  const handleSelectRelease = (release: DesktopReleaseHistoryItem) => {
    const isRollback = compareSemver(release.version, currentVersion) < 0;
    const confirmed = window.confirm(
      isRollback
        ? `将回退到 v${release.version}，应用会静默安装并自动重启。是否继续？`
        : `将切换到 v${release.version}，应用会静默安装并自动重启。是否继续？`
    );

    if (!confirmed) {
      return;
    }

    onClose();
    void installDesktopReleaseVersion({
      manifestUrl: release.manifestUrl,
      version: release.version,
      publishedAt: release.publishedAt,
      releaseNotes: release.notes,
    });
  };

  if (!mounted || !isOpen) {
    return null;
  }

  return createPortal(
    <>
      <div
        className='fixed inset-0 z-[1010] bg-black/45 backdrop-blur-sm'
        onClick={onClose}
      />

      <div className='fixed left-1/2 top-1/2 z-[1011] flex max-h-[88vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900'>
        <div className='flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800'>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'>
              <History className='h-5 w-5' />
            </div>
            <div>
              <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                版本列表
              </h3>
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                选择指定版本后，将按桌面更新链路静默安装并自动重启。
              </p>
            </div>
          </div>

          <button
            type='button'
            onClick={onClose}
            className='inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'
            aria-label='关闭版本列表'
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        <div className='flex-1 overflow-y-auto px-5 py-4'>
          <div className='space-y-6'>
            {errorMessage ? (
              <div className='flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100'>
                <AlertCircle className='mt-0.5 h-4 w-4 flex-shrink-0' />
                <span>{errorMessage}</span>
              </div>
            ) : null}

            {isLoading ? (
              <div className='flex min-h-[240px] items-center justify-center rounded-xl border border-gray-200 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-800/30'>
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
      </div>
    </>,
    document.body
  );
}
