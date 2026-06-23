'use client';

import {
  type LucideIcon,
  AlertCircle,
  BellRing,
  Clock3,
  Film,
  LogIn,
  RefreshCw,
  Sparkles,
  Tv,
  UserCircle2,
} from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import {
  BROWSER_AUTH_UPDATED_EVENT,
  getAuthInfoFromBrowserCookie,
} from '@/lib/auth';
import {
  type Favorite,
  type PlayRecord,
  getAllFavorites,
  getAllFollowRecords,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { buildLoginPath } from '@/lib/desktop/auth-session';
import { hasNewEpisodes, refreshFollowRecords } from '@/lib/follow-updates';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { type FollowRecord } from '@/lib/types';

import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
}

interface FollowCandidateItem {
  key: string;
  id: string;
  source: string;
  title: string;
  year: string;
  poster: string;
  episodes: number;
  source_name: string;
  save_time: number;
  currentEpisode?: number;
  search_title?: string;
  playback_mode?: 'online' | 'offline';
  offline_content_id?: string;
  origin?: 'vod' | 'live';
}

interface FollowItem {
  key: string;
  id: string;
  source: string;
  currentEpisode?: number;
  follow: FollowRecord;
}

type StatusCardTone = 'neutral' | 'emerald' | 'amber' | 'sky';
type NoticeTone = 'info' | 'warning' | 'danger';

function normalizeEpisodeCount(
  value: number | undefined,
  fallback = 1
): number {
  const nextValue = Number(value);

  if (!Number.isFinite(nextValue) || nextValue < 1) {
    return fallback;
  }

  return Math.floor(nextValue);
}

function getEpisodeProgress(follow: FollowRecord): {
  followed: number;
  acknowledged: number;
  latest: number;
  pending: number;
  percentage: number;
} {
  const followed = normalizeEpisodeCount(follow.followed_episode_count);
  const latest = Math.max(
    followed,
    normalizeEpisodeCount(follow.latest_episode_count, followed)
  );
  const acknowledged = Math.max(
    followed,
    normalizeEpisodeCount(follow.acknowledged_episode_count, followed)
  );
  const pending = Math.max(0, latest - acknowledged);
  const percentage = Math.max(
    0,
    Math.min(100, Math.round((Math.min(acknowledged, latest) / latest) * 100))
  );

  return {
    followed,
    acknowledged,
    latest,
    pending,
    percentage,
  };
}

function parseStorageKey(key: string): { source: string; id: string } | null {
  const separatorIndex = key.indexOf('+');

  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
    return null;
  }

  return {
    source: key.slice(0, separatorIndex),
    id: key.slice(separatorIndex + 1),
  };
}

function formatRelativeTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '尚未检查';
  }

  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffMinutes = Math.floor(diffMs / (60 * 1000));

  if (diffMinutes < 1) {
    return '刚刚';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }

  return `${Math.floor(diffHours / 24)} 天前`;
}

function formatAbsoluteTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '—';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp);
}

function buildFollowItems(
  followRecords: Record<string, FollowRecord>,
  playRecords: Record<string, PlayRecord>
): FollowItem[] {
  return Object.entries(followRecords)
    .flatMap(([key, follow]) => {
      const parsedKey = parseStorageKey(key);

      if (!parsedKey) {
        return [];
      }

      return [
        {
          key,
          source: parsedKey.source,
          id: parsedKey.id,
          currentEpisode: playRecords[key]?.index,
          follow,
        } satisfies FollowItem,
      ];
    })
    .sort((left, right) => {
      const leftHasNew = hasNewEpisodes(left.follow);
      const rightHasNew = hasNewEpisodes(right.follow);

      if (leftHasNew !== rightHasNew) {
        return leftHasNew ? -1 : 1;
      }

      return right.follow.followed_at - left.follow.followed_at;
    });
}

function buildFollowCandidateItems(
  favorites: Record<string, Favorite>,
  playRecords: Record<string, PlayRecord>,
  followRecords: Record<string, FollowRecord>
): FollowCandidateItem[] {
  return Object.entries(favorites)
    .flatMap(([key, favorite]) => {
      const parsedKey = parseStorageKey(key);

      if (!parsedKey || followRecords[key] || favorite.origin === 'live') {
        return [];
      }

      const playRecord = playRecords[key];

      return [
        {
          key,
          id: parsedKey.id,
          source: parsedKey.source,
          title: favorite.title || '未命名内容',
          year: favorite.year || '',
          poster: favorite.cover || '',
          episodes: Math.max(1, favorite.total_episodes || 1),
          source_name: favorite.source_name || '',
          save_time: favorite.save_time || 0,
          currentEpisode: playRecord?.index,
          search_title: favorite.search_title,
          playback_mode: favorite.playback_mode,
          offline_content_id: favorite.offline_content_id,
          origin: favorite.origin,
        } satisfies FollowCandidateItem,
      ];
    })
    .sort((left, right) => right.save_time - left.save_time);
}

function StatusCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: StatusCardTone;
}) {
  const toneClassNames: Record<
    StatusCardTone,
    { iconBox: string; icon: string; value: string }
  > = {
    neutral: {
      iconBox:
        'border-gray-200 bg-gray-100/80 dark:border-gray-800 dark:bg-gray-900/80',
      icon: 'text-gray-600 dark:text-gray-300',
      value: 'text-gray-900 dark:text-gray-100',
    },
    emerald: {
      iconBox:
        'border-emerald-200 bg-emerald-500/10 dark:border-emerald-900/60 dark:bg-emerald-950/50',
      icon: 'text-emerald-700 dark:text-emerald-300',
      value: 'text-emerald-700 dark:text-emerald-300',
    },
    amber: {
      iconBox:
        'border-amber-200 bg-amber-500/10 dark:border-amber-900/60 dark:bg-amber-950/50',
      icon: 'text-amber-700 dark:text-amber-300',
      value: 'text-amber-700 dark:text-amber-300',
    },
    sky: {
      iconBox:
        'border-sky-200 bg-sky-500/10 dark:border-sky-900/60 dark:bg-sky-950/50',
      icon: 'text-sky-700 dark:text-sky-300',
      value: 'text-sky-700 dark:text-sky-300',
    },
  };

  const toneClassName = toneClassNames[tone];

  return (
    <section className='rounded-[22px] border border-gray-200 bg-white/85 p-5 shadow-sm backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900/60'>
      <div className='flex items-start gap-4'>
        <div
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${toneClassName.iconBox}`}
        >
          <Icon className={`h-5 w-5 ${toneClassName.icon}`} />
        </div>
        <div className='min-w-0 flex-1'>
          <div className='text-sm font-medium text-gray-600 dark:text-gray-300'>
            {label}
          </div>
          <div className={`mt-3 text-2xl font-semibold ${toneClassName.value}`}>
            {value}
          </div>
          <div className='mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400'>
            {detail}
          </div>
        </div>
      </div>
    </section>
  );
}

function NoticePanel({
  icon: Icon,
  tone,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  tone: NoticeTone;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const toneClassNames: Record<NoticeTone, string> = {
    info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-200',
    warning:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200',
    danger:
      'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200',
  };

  return (
    <section
      className={`rounded-[22px] border px-4 py-4 shadow-sm ${toneClassNames[tone]}`}
    >
      <div className='flex items-start gap-3'>
        <Icon className='mt-0.5 h-4 w-4 shrink-0' />
        <div className='min-w-0 flex-1 space-y-3'>
          <div>
            <div className='text-sm font-medium'>{title}</div>
            <div className='mt-1 text-sm leading-6 opacity-90'>{children}</div>
          </div>
          {action ? <div>{action}</div> : null}
        </div>
      </div>
    </section>
  );
}

function SectionShell({
  title,
  description,
  meta,
  children,
}: {
  title: string;
  description: string;
  meta: string;
  children: ReactNode;
}) {
  return (
    <section className='rounded-[26px] border border-gray-200 bg-white/75 p-5 shadow-sm backdrop-blur-sm dark:border-gray-800 dark:bg-gray-950/50'>
      <div className='flex flex-col gap-3 md:flex-row md:items-start md:justify-between'>
        <div className='space-y-1.5'>
          <div className='flex flex-wrap items-center gap-2'>
            <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
              {title}
            </h2>
            <span className='text-sm text-gray-500 dark:text-gray-400'>
              {meta}
            </span>
          </div>
          <p className='text-sm leading-6 text-gray-600 dark:text-gray-400'>
            {description}
          </p>
        </div>
      </div>
      <div className='mt-5'>{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className='grid gap-1 sm:grid-cols-[92px_minmax(0,1fr)] sm:items-center'>
      <span className='text-xs font-medium uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400'>
        {label}
      </span>
      <span className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
        {value}
      </span>
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className='rounded-2xl border border-dashed border-gray-300 px-6 py-10 text-center dark:border-gray-700'>
      <div className='text-sm font-medium text-gray-700 dark:text-gray-200'>
        {title}
      </div>
      <div className='mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400'>
        {description}
      </div>
    </div>
  );
}

function FollowRecordCard({ item }: { item: FollowItem }) {
  const { acknowledged, followed, latest, pending, percentage } =
    getEpisodeProgress(item.follow);
  const isNew = hasNewEpisodes(item.follow);

  return (
    <article className='group overflow-hidden rounded-[22px] border border-gray-200 bg-white/85 p-4 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:border-gray-800 dark:bg-gray-900/55'>
      <div className='flex flex-col gap-4 xl:flex-row'>
        <div className='mx-auto w-full max-w-[13rem] shrink-0 xl:mx-0'>
          <VideoCard
            id={item.id}
            source={item.source}
            title={item.follow.title}
            query={item.follow.search_title}
            poster={item.follow.cover}
            episodes={latest}
            source_name={item.follow.source_name}
            year={item.follow.year}
            currentEpisode={item.currentEpisode}
            from='favorite'
            type={latest > 1 ? 'tv' : 'movie'}
          />
        </div>

        <div className='min-w-0 flex-1 space-y-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                isNew
                  ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
              }`}
            >
              {isNew ? `NEW ${pending} 集` : '已追平'}
            </span>
            {item.follow.source_name ? (
              <span className='inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300'>
                {item.follow.source_name}
              </span>
            ) : null}
            {item.follow.year ? (
              <span className='inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300'>
                {item.follow.year}
              </span>
            ) : null}
          </div>

          <div className='grid gap-3 text-gray-600 dark:text-gray-300'>
            <DetailRow label='开启时集数' value={String(followed)} />
            <DetailRow
              label='已确认 / 最新'
              value={`${acknowledged} / ${latest}`}
            />
            <DetailRow
              label='开始追更'
              value={formatAbsoluteTime(item.follow.followed_at)}
            />
            <DetailRow
              label='最近检查'
              value={
                <span className='inline-flex items-center gap-1'>
                  <Clock3 className='h-3.5 w-3.5' />
                  {formatRelativeTime(item.follow.last_checked_at)}
                </span>
              }
            />
          </div>

          <div className='rounded-2xl border border-gray-200/80 bg-gray-50/80 p-3 dark:border-gray-800 dark:bg-gray-950/70'>
            <div className='flex items-center justify-between text-xs font-medium text-gray-500 dark:text-gray-400'>
              <span>追更进度</span>
              <span>{percentage}%</span>
            </div>
            <div className='mt-2 h-2 rounded-full bg-gray-200 dark:bg-gray-800'>
              <div
                className={`h-full rounded-full transition-all ${
                  isNew ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${percentage}%` }}
              />
            </div>
            <div className='mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400'>
              {isNew
                ? `还有 ${pending} 集未确认，播放新集后会自动推进。`
                : '当前已追平最新集数，后续更新会自动显示 NEW 标记。'}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function FollowCandidateCard({ item }: { item: FollowCandidateItem }) {
  const isSeries = item.episodes > 1;

  return (
    <article className='group overflow-hidden rounded-[22px] border border-gray-200 bg-white/85 p-4 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:border-gray-800 dark:bg-gray-900/55'>
      <div className='mx-auto w-full max-w-[12rem]'>
        <VideoCard
          id={item.id}
          source={item.source}
          title={item.title}
          query={item.search_title}
          poster={item.poster}
          episodes={item.episodes}
          source_name={item.source_name}
          year={item.year}
          currentEpisode={item.currentEpisode}
          from='favorite'
          playbackMode={item.playback_mode}
          offlineContentId={item.offline_content_id}
          origin={item.origin}
          type={isSeries ? 'tv' : 'movie'}
        />
      </div>

      <div className='mt-4 space-y-3'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='inline-flex rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300'>
            {isSeries ? '连载候选' : '单片候选'}
          </span>
          <span className='inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300'>
            {item.playback_mode === 'offline' ? '离线入口' : '在线播放'}
          </span>
        </div>

        <div className='grid gap-3 text-gray-600 dark:text-gray-300'>
          <DetailRow label='来源' value={item.source_name || '未标记来源'} />
          <DetailRow
            label='内容规模'
            value={isSeries ? `共 ${item.episodes} 集` : '单片 / 特别篇'}
          />
          <DetailRow
            label='收藏时间'
            value={formatAbsoluteTime(item.save_time)}
          />
        </div>

        <div className='rounded-2xl border border-dashed border-gray-300 px-3 py-3 text-xs leading-5 text-gray-500 dark:border-gray-700 dark:text-gray-400'>
          右键卡片即可开启追更。开启后会记录当前集数，并参与桌面端后续自动检查。
        </div>
      </div>
    </article>
  );
}

export default function FollowUpdatesPage() {
  const [isReady, setIsReady] = useState(false);
  const [isDesktopTarget, setIsDesktopTarget] = useState(false);
  const [requiresProfileLogin, setRequiresProfileLogin] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [favorites, setFavorites] = useState<Record<string, Favorite>>({});
  const [playRecords, setPlayRecords] = useState<Record<string, PlayRecord>>(
    {}
  );
  const [followRecords, setFollowRecords] = useState<
    Record<string, FollowRecord>
  >({});
  const [errorMessage, setErrorMessage] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    let active = true;

    const syncPageState = async () => {
      const runtimeConfig = getRuntimeConfig();
      const desktopTarget = runtimeConfig.APP_TARGET === 'desktop';
      const effectiveStorageType =
        desktopTarget && runtimeConfig.PROFILE_SYNC_ENABLED === true
          ? runtimeConfig.PROFILE_SYNC_STORAGE_TYPE ||
            runtimeConfig.STORAGE_TYPE
          : runtimeConfig.STORAGE_TYPE;
      const needsLogin = Boolean(
        effectiveStorageType && effectiveStorageType !== 'localstorage'
      );
      const nextAuthInfo = getAuthInfoFromBrowserCookie();

      if (!active) {
        return;
      }

      setIsDesktopTarget(desktopTarget);
      setRequiresProfileLogin(needsLogin);
      setAuthInfo(nextAuthInfo);
      setErrorMessage('');

      if (!desktopTarget || (needsLogin && !nextAuthInfo?.username)) {
        setFavorites({});
        setPlayRecords({});
        setFollowRecords({});
        setIsReady(true);
        return;
      }

      setIsReady(false);

      try {
        const [nextFavorites, nextPlayRecords, nextFollowRecords] =
          await Promise.all([
            getAllFavorites(),
            getAllPlayRecords(),
            getAllFollowRecords(),
          ]);

        if (!active) {
          return;
        }

        setFavorites(nextFavorites);
        setPlayRecords(nextPlayRecords);
        setFollowRecords(nextFollowRecords);
      } catch (error) {
        if (!active) {
          return;
        }

        setErrorMessage(
          error instanceof Error ? error.message : '加载追更数据失败'
        );
      } finally {
        if (active) {
          setIsReady(true);
        }
      }
    };

    void syncPageState();
    window.addEventListener(BROWSER_AUTH_UPDATED_EVENT, syncPageState);

    return () => {
      active = false;
      window.removeEventListener(BROWSER_AUTH_UPDATED_EVENT, syncPageState);
    };
  }, []);

  useEffect(() => {
    if (!isDesktopTarget || (requiresProfileLogin && !authInfo?.username)) {
      return;
    }

    const unsubscribeFavorites = subscribeToDataUpdates<
      Record<string, Favorite>
    >('favoritesUpdated', setFavorites);
    const unsubscribePlayRecords = subscribeToDataUpdates<
      Record<string, PlayRecord>
    >('playRecordsUpdated', setPlayRecords);
    const unsubscribeFollowRecords = subscribeToDataUpdates<
      Record<string, FollowRecord>
    >('followRecordsUpdated', setFollowRecords);

    return () => {
      unsubscribeFavorites();
      unsubscribePlayRecords();
      unsubscribeFollowRecords();
    };
  }, [authInfo?.username, isDesktopTarget, requiresProfileLogin]);

  const followItems = useMemo(
    () => buildFollowItems(followRecords, playRecords),
    [followRecords, playRecords]
  );
  const followCandidateItems = useMemo(
    () => buildFollowCandidateItems(favorites, playRecords, followRecords),
    [favorites, playRecords, followRecords]
  );
  const newFollowCount = useMemo(
    () => followItems.filter((item) => hasNewEpisodes(item.follow)).length,
    [followItems]
  );
  const serialCandidateCount = useMemo(
    () => followCandidateItems.filter((item) => item.episodes > 1).length,
    [followCandidateItems]
  );
  const pendingEpisodeCount = useMemo(
    () =>
      followItems.reduce(
        (total, item) => total + getEpisodeProgress(item.follow).pending,
        0
      ),
    [followItems]
  );
  const lastCheckedAt = useMemo(
    () =>
      followItems.reduce(
        (latestTimestamp, item) =>
          Math.max(latestTimestamp, item.follow.last_checked_at || 0),
        0
      ),
    [followItems]
  );

  const canViewFollowData =
    isDesktopTarget && (!requiresProfileLogin || Boolean(authInfo?.username));
  const sessionLabel = requiresProfileLogin
    ? authInfo?.username || '未登录'
    : '本地设备';

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      setErrorMessage('');
      await refreshFollowRecords({ force: true });
      const nextFollowRecords = await getAllFollowRecords();
      setFollowRecords(nextFollowRecords);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : '检查追更更新失败'
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <PageLayout activePath='/follow-updates'>
      <div className='mx-auto flex max-w-6xl flex-col gap-6 px-5 py-6 lg:px-12 2xl:px-20'>
        <section className='rounded-[28px] border border-gray-200 bg-white/80 p-6 shadow-sm backdrop-blur-sm dark:border-gray-800 dark:bg-gray-900/60'>
          <div className='flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between'>
            <div className='space-y-3'>
              <div className='inline-flex items-center gap-2 rounded-full border border-emerald-300/50 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-200'>
                <BellRing className='h-3.5 w-3.5' />
                追更
              </div>
              <div className='space-y-2'>
                <h1 className='text-3xl font-semibold text-gray-900 dark:text-gray-100'>
                  追更管理
                </h1>
                <p className='max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-400'>
                  桌面版会在应用启动、窗口重新聚焦和页面恢复可见时按节流规则检查已追更内容。
                  卡片上的 NEW 标签和播放页中的新集提示，都依赖同一份追更记录。
                </p>
              </div>
              <div className='flex flex-wrap gap-2 text-xs'>
                <span className='rounded-full border border-gray-200 bg-white/85 px-3 py-1 font-medium text-gray-600 dark:border-gray-800 dark:bg-gray-950/80 dark:text-gray-300'>
                  桌面端自动检查
                </span>
                <span className='rounded-full border border-gray-200 bg-white/85 px-3 py-1 font-medium text-gray-600 dark:border-gray-800 dark:bg-gray-950/80 dark:text-gray-300'>
                  右键卡片开启 / 取消
                </span>
                <span className='rounded-full border border-gray-200 bg-white/85 px-3 py-1 font-medium text-gray-600 dark:border-gray-800 dark:bg-gray-950/80 dark:text-gray-300'>
                  播放新集自动确认
                </span>
              </div>
            </div>

            <div className='flex flex-col items-start gap-2 xl:items-end'>
              <div className='flex flex-wrap items-center gap-2 xl:justify-end'>
                <div className='inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white/85 px-3 py-2 text-sm font-medium text-gray-700 shadow-sm dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-200'>
                  <UserCircle2 className='h-4 w-4' />
                  {sessionLabel}
                </div>

                {canViewFollowData ? (
                  <button
                    type='button'
                    onClick={() => void handleRefresh()}
                    disabled={isRefreshing}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                      isRefreshing
                        ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-500'
                        : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-200'
                    }`}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${
                        isRefreshing ? 'animate-spin' : ''
                      }`}
                    />
                    {isRefreshing ? '检查中...' : '检查更新'}
                  </button>
                ) : requiresProfileLogin && !authInfo?.username ? (
                  <Link
                    href={buildLoginPath('/follow-updates')}
                    className='inline-flex shrink-0 items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-200'
                  >
                    <LogIn className='h-4 w-4' />
                    前往登录
                  </Link>
                ) : null}
              </div>

              {canViewFollowData ? (
                <div className='text-xs text-gray-500 dark:text-gray-400'>
                  上次检查 {formatRelativeTime(lastCheckedAt)}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {!isReady ? (
          <NoticePanel icon={RefreshCw} tone='info' title='正在读取追更数据'>
            当前正在同步桌面端的收藏、播放记录和追更记录，请稍候。
          </NoticePanel>
        ) : !isDesktopTarget ? (
          <NoticePanel
            icon={AlertCircle}
            tone='warning'
            title='当前不是桌面运行时'
          >
            追更入口和自动检查策略目前只在桌面版启用，后续再迁移到 Web 版。
          </NoticePanel>
        ) : requiresProfileLogin && !authInfo?.username ? (
          <NoticePanel
            icon={LogIn}
            tone='warning'
            title='需要先登录桌面账号'
            action={
              <Link
                href={buildLoginPath('/follow-updates')}
                className='inline-flex items-center rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700'
              >
                前往登录
              </Link>
            }
          >
            当前会话还没有可用的桌面用户信息，追更列表暂时无法加载。
          </NoticePanel>
        ) : (
          <>
            <section className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
              <StatusCard
                icon={UserCircle2}
                label='当前会话'
                value={sessionLabel}
                detail={
                  requiresProfileLogin
                    ? '追更记录按桌面用户隔离存储。'
                    : '当前处于本地存储模式，不依赖登录会话。'
                }
                tone='neutral'
              />
              <StatusCard
                icon={Film}
                label='已追更'
                value={String(followItems.length)}
                detail={
                  followItems.length > 0
                    ? `最近一次检查在 ${formatRelativeTime(lastCheckedAt)}。`
                    : '开启追更后，这些内容会自动参与更新检查。'
                }
                tone='emerald'
              />
              <StatusCard
                icon={Sparkles}
                label='NEW 更新'
                value={String(newFollowCount)}
                detail={
                  newFollowCount > 0
                    ? `当前还有 ${pendingEpisodeCount} 集待确认。`
                    : '当前已追更内容都处于最新进度。'
                }
                tone='amber'
              />
              <StatusCard
                icon={Tv}
                label='追更候选'
                value={String(followCandidateItems.length)}
                detail={
                  followCandidateItems.length > 0
                    ? `其中 ${serialCandidateCount} 个是连载候选。`
                    : '收藏中的稳定点播内容会自动出现在这里。'
                }
                tone='sky'
              />
            </section>

            {errorMessage ? (
              <NoticePanel
                icon={AlertCircle}
                tone='danger'
                title='追更数据处理失败'
              >
                {errorMessage}
              </NoticePanel>
            ) : null}

            <SectionShell
              title='已追更'
              meta={`${followItems.length} 部内容 · ${newFollowCount} 部有更新`}
              description='有更新的内容会自动排在前面。右键视频卡片可取消追更，播放新集后已确认集数会自动推进。'
            >
              {followItems.length === 0 ? (
                <EmptyState
                  title='还没有追更内容'
                  description='先在任意视频卡片上右键选择“开启追更”，这里就会开始聚合你的追更列表。'
                />
              ) : (
                <div className='grid gap-4 xl:grid-cols-2'>
                  {followItems.map((item) => (
                    <FollowRecordCard key={item.key} item={item} />
                  ))}
                </div>
              )}
            </SectionShell>

            <SectionShell
              title='追更候选'
              meta={`${followCandidateItems.length} 个候选 · ${serialCandidateCount} 个连载`}
              description='这里展示已收藏但尚未开启追更的稳定点播内容，适合作为快速补全追更列表的入口。'
            >
              {followCandidateItems.length === 0 ? (
                <EmptyState
                  title='当前没有新的候选内容'
                  description='如果收藏里的稳定点播内容都已经开启追更，这里会自动清空。'
                />
              ) : (
                <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
                  {followCandidateItems.map((item) => (
                    <FollowCandidateCard key={item.key} item={item} />
                  ))}
                </div>
              )}
            </SectionShell>
          </>
        )}
      </div>
    </PageLayout>
  );
}
