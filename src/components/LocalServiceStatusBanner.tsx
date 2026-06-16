'use client';

import {
  AlertTriangle,
  Minus,
  RefreshCw,
  ServerCog,
  Zap,
} from 'lucide-react';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

import {
  clearStoredLocalServiceAccelerationBaseUrl,
  getStoredLocalServiceAccelerationBaseUrl,
  isLocalServiceAccelerationActive,
  LOCAL_SERVICE_DEFAULT_BASE_URL,
  LOCAL_SERVICE_HEALTH_URL,
  normalizeLocalServiceBaseUrl,
  setStoredLocalServiceAccelerationBaseUrl,
} from '@/lib/local-service-runtime';

interface LocalServiceHealthPayload {
  base_url?: string;
  port?: number;
  status?: string;
}

interface ResolvedLocalServiceHealth {
  baseUrl: string;
  port: number | null;
}

type LocalServiceBannerMode = 'available' | 'active' | 'offline';
type LocalServiceMinimizedMode = Extract<
  LocalServiceBannerMode,
  'available' | 'offline'
>;

interface LocalServiceStatusContextValue {
  bannerMode: LocalServiceBannerMode | null;
  health: ResolvedLocalServiceHealth | null;
  storedBaseUrl: string | null;
  isActivating: boolean;
  isChecking: boolean;
  isResetting: boolean;
  activate: () => void;
  recheck: () => void;
  restoreDefault: () => void;
}

const LOCAL_SERVICE_POLL_MS = 20000;
const LOCAL_SERVICE_TIMEOUT_MS = 2500;
const PAGE_RELOAD_DELAY_MS = 140;
const LOCAL_SERVICE_MINIMIZED_MODE_STORAGE_KEY =
  'lunatv.localService.bannerMinimizedMode';

const LocalServiceStatusContext =
  createContext<LocalServiceStatusContextValue | null>(null);

function scheduleReload(): void {
  window.setTimeout(() => {
    window.location.reload();
  }, PAGE_RELOAD_DELAY_MS);
}

function getStoredLocalServiceMinimizedMode(): LocalServiceMinimizedMode | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const value = window.sessionStorage.getItem(
      LOCAL_SERVICE_MINIMIZED_MODE_STORAGE_KEY
    );
    return value === 'available' || value === 'offline' ? value : null;
  } catch {
    return null;
  }
}

function setStoredLocalServiceMinimizedMode(
  mode: LocalServiceMinimizedMode | null
): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (mode) {
      window.sessionStorage.setItem(
        LOCAL_SERVICE_MINIMIZED_MODE_STORAGE_KEY,
        mode
      );
      return;
    }

    window.sessionStorage.removeItem(LOCAL_SERVICE_MINIMIZED_MODE_STORAGE_KEY);
  } catch {
    // Ignore transient storage failures and keep the banner interactive.
  }
}

function useLocalServiceStatusContext() {
  return useContext(LocalServiceStatusContext);
}

export function LocalServiceStatusProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [health, setHealth] = useState<ResolvedLocalServiceHealth | null>(null);
  const [hasResolvedProbe, setHasResolvedProbe] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [probeNonce, setProbeNonce] = useState(0);
  const [storedBaseUrl, setStoredBaseUrl] = useState<string | null>(null);

  useLayoutEffect(() => {
    setStoredBaseUrl(getStoredLocalServiceAccelerationBaseUrl());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      LOCAL_SERVICE_TIMEOUT_MS
    );
    let cancelled = false;

    setIsChecking(true);

    const probeLocalService = async () => {
      try {
        const response = await fetch(LOCAL_SERVICE_HEALTH_URL, {
          cache: 'no-store',
          mode: 'cors',
          signal: controller.signal,
        });
        const payload = (await response
          .json()
          .catch(() => null)) as LocalServiceHealthPayload | null;

        if (!response.ok || !payload || payload.status !== 'ok' || cancelled) {
          if (!cancelled) {
            setHealth(null);
          }
          return;
        }

        setHealth({
          baseUrl:
            normalizeLocalServiceBaseUrl(payload.base_url) ||
            normalizeLocalServiceBaseUrl(
              LOCAL_SERVICE_HEALTH_URL.replace(/\/health$/, '')
            ) ||
            LOCAL_SERVICE_DEFAULT_BASE_URL,
          port: typeof payload.port === 'number' ? payload.port : null,
        });
      } catch {
        if (!cancelled) {
          setHealth(null);
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (!cancelled) {
          setHasResolvedProbe(true);
          setIsChecking(false);
        }
      }
    };

    void probeLocalService();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [probeNonce]);

  useEffect(() => {
    const handleFocus = () => setProbeNonce((value) => value + 1);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setProbeNonce((value) => value + 1);
      }
    };
    const intervalId = window.setInterval(() => {
      setProbeNonce((value) => value + 1);
    }, LOCAL_SERVICE_POLL_MS);

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const shouldKeepActivePillWhileProbing =
    Boolean(storedBaseUrl) &&
    !hasResolvedProbe &&
    isLocalServiceAccelerationActive(storedBaseUrl || '');

  const bannerMode = useMemo<LocalServiceBannerMode | null>(() => {
    if (health) {
      return isLocalServiceAccelerationActive(health.baseUrl)
        ? 'active'
        : 'available';
    }

    if (!storedBaseUrl) {
      return null;
    }

    if (shouldKeepActivePillWhileProbing) {
      return 'active';
    }

    return hasResolvedProbe ? 'offline' : null;
  }, [hasResolvedProbe, health, shouldKeepActivePillWhileProbing, storedBaseUrl]);

  const recheck = useCallback(() => {
    if (isChecking || isActivating || isResetting) {
      return;
    }

    setIsChecking(true);
    setProbeNonce((value) => value + 1);
  }, [isActivating, isChecking, isResetting]);

  const activate = useCallback(() => {
    if (!health || isActivating || isResetting) {
      return;
    }

    const nextBaseUrl = normalizeLocalServiceBaseUrl(health.baseUrl);
    if (!nextBaseUrl) {
      return;
    }

    const persistedBaseUrl =
      setStoredLocalServiceAccelerationBaseUrl(nextBaseUrl);
    if (!persistedBaseUrl) {
      return;
    }

    setStoredBaseUrl(persistedBaseUrl);
    setIsActivating(true);
    scheduleReload();
  }, [health, isActivating, isResetting]);

  const restoreDefault = useCallback(() => {
    if (isResetting || isActivating) {
      return;
    }

    clearStoredLocalServiceAccelerationBaseUrl();
    setIsResetting(true);
    scheduleReload();
  }, [isActivating, isResetting]);

  const contextValue = useMemo(
    () => ({
      activate,
      bannerMode,
      health,
      isActivating,
      isChecking,
      isResetting,
      recheck,
      restoreDefault,
      storedBaseUrl,
    }),
    [
      activate,
      bannerMode,
      health,
      isActivating,
      isChecking,
      isResetting,
      recheck,
      restoreDefault,
      storedBaseUrl,
    ]
  );

  return (
    <LocalServiceStatusContext.Provider value={contextValue}>
      {children}
    </LocalServiceStatusContext.Provider>
  );
}

export function LocalServiceStatusBanner() {
  const status = useLocalServiceStatusContext();
  const [minimizedMode, setMinimizedMode] =
    useState<LocalServiceMinimizedMode | null>(null);

  useLayoutEffect(() => {
    setMinimizedMode(getStoredLocalServiceMinimizedMode());
  }, []);

  const handleExpand = useCallback(() => {
    setMinimizedMode(null);
    setStoredLocalServiceMinimizedMode(null);
  }, []);

  if (!status?.bannerMode) {
    return null;
  }

  const {
    activate,
    bannerMode,
    health,
    isActivating,
    isChecking,
    isResetting,
    recheck,
    restoreDefault,
    storedBaseUrl,
  } = status;
  const badgeLabel =
    bannerMode === 'offline'
      ? storedBaseUrl
      : health?.port
        ? `127.0.0.1:${health.port}`
        : health?.baseUrl;
  const isOffline = bannerMode === 'offline';
  const isActive = bannerMode === 'active';
  const isMinimized =
    !isActive && minimizedMode !== null && minimizedMode === bannerMode;

  const handleMinimize = () => {
    if (isActive) {
      return;
    }

    setMinimizedMode(bannerMode);
    setStoredLocalServiceMinimizedMode(bannerMode);
  };

  if (isActive) {
    return (
      <div className='pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.35rem)] z-[970] flex justify-center px-3 md:hidden'>
        <div
          className='pointer-events-auto flex max-w-fit items-center gap-2 rounded-full border border-green-500/20 bg-white/90 px-3 py-1.5 text-green-700 shadow-lg shadow-green-950/10 backdrop-blur-xl dark:border-green-400/20 dark:bg-[#0a1410]/92 dark:text-green-100'
          title={health?.baseUrl || storedBaseUrl || undefined}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full bg-green-500 ${
              isChecking ? 'animate-pulse' : ''
            }`}
          />
          <Zap className='h-3.5 w-3.5' />
          <span className='whitespace-nowrap text-xs font-semibold'>
            本地服务启动
          </span>
          <button
            className='inline-flex h-6 items-center justify-center rounded-full border border-green-500/20 bg-green-500/10 px-2 text-[11px] font-medium text-green-700 transition-colors hover:bg-green-500/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-green-400/15 dark:bg-green-500/10 dark:text-green-100 dark:hover:bg-green-500/15'
            disabled={isResetting}
            onClick={restoreDefault}
            type='button'
          >
            {isResetting ? '停用中...' : '停用'}
          </button>
        </div>
      </div>
    );
  }

  if (isMinimized) {
    return (
      <div className='pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.35rem)] z-[970] flex justify-center px-3 md:hidden'>
        <button
          aria-label='展开本地服务提示'
          className={`pointer-events-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-lg shadow-slate-950/10 backdrop-blur-xl transition-colors ${
            isOffline
              ? 'border-amber-300/50 bg-white/92 text-amber-700 hover:bg-white dark:border-amber-300/20 dark:bg-[#171109]/92 dark:text-amber-100 dark:hover:bg-[#1c140b]'
              : 'border-green-500/20 bg-white/92 text-green-700 hover:bg-white dark:border-green-400/15 dark:bg-[#0a1410]/92 dark:text-green-100 dark:hover:bg-[#0d1913]'
          }`}
          onClick={handleExpand}
          type='button'
        >
          {isOffline ? (
            <AlertTriangle className='h-3.5 w-3.5' />
          ) : (
            <ServerCog className='h-3.5 w-3.5' />
          )}
          <span>{isOffline ? '本机加速' : '本地服务'}</span>
        </button>
      </div>
    );
  }

  return (
    <div className='pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.35rem)] z-[970] flex justify-center px-3 md:hidden'>
      <div
        className={`pointer-events-auto w-full max-w-[min(88vw,340px)] rounded-2xl border px-3 py-2 text-slate-900 shadow-[0_14px_36px_rgba(15,23,42,0.14)] backdrop-blur-xl dark:text-white ${
          isOffline
            ? 'border-amber-300/40 bg-white/94 dark:border-amber-300/20 dark:bg-[#171109]/94'
            : 'border-green-500/15 bg-white/94 dark:border-green-400/15 dark:bg-[#0a1410]/94'
        }`}
      >
        <div className='flex items-start gap-2.5'>
          <span
            className={`mt-[0.45rem] h-2 w-2 shrink-0 rounded-full ${
              isOffline ? 'bg-amber-400' : 'bg-green-500'
            } ${isChecking ? 'animate-pulse' : ''}`}
          />
          <div className='min-w-0 flex-1'>
            <div className='flex min-w-0 items-start gap-2'>
              {isOffline ? (
                <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500 dark:text-amber-200' />
              ) : (
                <ServerCog className='mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-100' />
              )}
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-2'>
                  <span className='truncate text-[13px] font-semibold leading-5'>
                    {isOffline ? '本机加速暂不可用' : '本地服务已就绪'}
                  </span>
                  {badgeLabel ? (
                    <span
                      className={`min-w-0 max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        isOffline
                          ? 'bg-amber-500/10 text-amber-700 dark:bg-amber-500/10 dark:text-amber-100/90'
                          : 'bg-green-500/10 text-green-700 dark:bg-green-500/10 dark:text-green-100/90'
                      }`}
                      title={badgeLabel}
                    >
                      {badgeLabel}
                    </span>
                  ) : null}
                </div>
                {isOffline ? (
                  <p className='mt-1 text-[11px] leading-4 text-amber-700/90 dark:text-amber-100/75'>
                    当前没有响应，可恢复默认线路继续播放。
                  </p>
                ) : null}
              </div>
              <button
                aria-label='最小化本地服务提示'
                className='inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-white/80 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65 dark:hover:bg-white/10 dark:hover:text-white/90'
                onClick={handleMinimize}
                type='button'
              >
                <Minus className='h-3.5 w-3.5' />
              </button>
            </div>
            <div className='mt-2 flex items-center gap-1.5'>
              <button
                className='inline-flex h-7 items-center justify-center gap-1.5 rounded-full border border-slate-200/80 bg-white/85 px-2.5 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white/90 dark:hover:bg-white/10'
                disabled={isChecking || isActivating || isResetting}
                onClick={recheck}
                type='button'
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isChecking ? 'animate-spin' : ''}`}
                />
                {isChecking ? '检测中...' : '检测'}
              </button>
              {isOffline ? (
                <button
                  className='inline-flex h-7 items-center justify-center gap-1.5 rounded-full bg-amber-500 px-2.5 text-[11px] font-semibold text-[#201304] shadow-sm shadow-amber-950/10 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-amber-500/70'
                  disabled={isResetting || isActivating}
                  onClick={restoreDefault}
                  type='button'
                >
                  <AlertTriangle className='h-3.5 w-3.5' />
                  {isResetting ? '恢复中...' : '恢复默认'}
                </button>
              ) : (
                <button
                  className='inline-flex h-7 items-center justify-center gap-1.5 rounded-full bg-green-600 px-2.5 text-[11px] font-semibold text-white shadow-sm shadow-green-950/10 transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-green-700/70'
                  disabled={isActivating || isResetting}
                  onClick={activate}
                  type='button'
                >
                  <Zap className='h-3.5 w-3.5' />
                  {isActivating ? '启动中...' : '启动'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LocalServiceStatusSidebarPill({
  isCollapsed = false,
}: {
  isCollapsed?: boolean;
}) {
  const status = useLocalServiceStatusContext();

  if (!status?.bannerMode) {
    return null;
  }

  const {
    activate,
    bannerMode,
    health,
    isActivating,
    isChecking,
    isResetting,
    recheck,
    restoreDefault,
    storedBaseUrl,
  } = status;
  const title = health?.baseUrl || storedBaseUrl || undefined;
  const isActive = bannerMode === 'active';
  const isOffline = bannerMode === 'offline';
  const badgeLabel =
    bannerMode === 'offline'
      ? storedBaseUrl
      : health?.port
        ? `127.0.0.1:${health.port}`
        : health?.baseUrl;

  if (isCollapsed) {
    const handleCollapsedClick = () => {
      if (isActive || isActivating || isResetting) {
        return;
      }

      if (isOffline) {
        recheck();
        return;
      }

      activate();
    };

    return (
      <div className='px-2 pt-1.5'>
        <div className='flex justify-center'>
          <button
            aria-label={
              isActive
                ? '本地服务启动'
                : isOffline
                  ? '本机加速暂不可用'
                  : '本地服务已就绪'
            }
            className={`relative flex h-9 w-9 items-center justify-center rounded-2xl border shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              isOffline
                ? 'border-amber-300/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:border-amber-300/20 dark:bg-amber-500/10 dark:text-amber-100 dark:hover:bg-amber-500/15'
                : 'border-green-500/20 bg-green-500/10 text-green-700 hover:bg-green-500/15 dark:border-green-400/20 dark:bg-green-500/10 dark:text-green-100 dark:hover:bg-green-500/15'
            }`}
            disabled={!isOffline && isActive}
            onClick={handleCollapsedClick}
            type='button'
            title={title}
          >
            <span
              className={`absolute mt-[-14px] h-2 w-2 rounded-full ${
                isOffline ? 'bg-amber-400' : 'bg-green-500'
              } ${
                isChecking ? 'animate-pulse' : ''
              }`}
            />
            {isOffline ? (
              <AlertTriangle className='h-4 w-4' />
            ) : isActive ? (
              <Zap className='h-4 w-4' />
            ) : (
              <ServerCog className='h-4 w-4' />
            )}
          </button>
        </div>
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className='px-2 pt-1.5'>
        <div
          className={`rounded-2xl border px-3 py-2 shadow-sm ${
            isOffline
              ? 'border-amber-300/25 bg-amber-500/10 text-amber-800 shadow-amber-950/5 dark:border-amber-300/20 dark:bg-amber-500/10 dark:text-amber-100'
              : 'border-green-500/20 bg-green-500/10 text-green-800 shadow-green-950/5 dark:border-green-400/20 dark:bg-green-500/10 dark:text-green-100'
          }`}
          title={title}
        >
          <div className='flex min-w-0 items-center gap-2'>
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                isOffline ? 'bg-amber-400' : 'bg-green-500'
              } ${isChecking ? 'animate-pulse' : ''}`}
            />
            {isOffline ? (
              <AlertTriangle className='h-3.5 w-3.5 shrink-0' />
            ) : (
              <ServerCog className='h-3.5 w-3.5 shrink-0' />
            )}
            <span className='min-w-0 flex-1 truncate text-[12px] font-semibold'>
              {isOffline ? '本机加速异常' : '检测到本地服务'}
            </span>
            {badgeLabel ? (
              <span
                className={`max-w-[104px] truncate rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  isOffline
                    ? 'bg-amber-500/10 text-amber-700 dark:bg-amber-500/10 dark:text-amber-100/90'
                    : 'bg-green-600/10 text-green-700 dark:bg-green-500/10 dark:text-green-100/90'
                }`}
                title={badgeLabel}
              >
                {badgeLabel}
              </span>
            ) : null}
          </div>
          <div className='mt-2 grid grid-cols-2 gap-1.5'>
            <button
              className={`inline-flex h-6 w-full items-center justify-center gap-1.5 rounded-full border px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                isOffline
                  ? 'border-amber-300/25 bg-white/65 text-amber-700 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-amber-100 dark:hover:bg-white/10'
                  : 'border-green-500/20 bg-white/70 text-green-700 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-green-100 dark:hover:bg-white/10'
              }`}
              disabled={isChecking || isActivating || isResetting}
              onClick={recheck}
              type='button'
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isChecking ? 'animate-spin' : ''}`}
              />
              {isChecking ? '检测中...' : '检测'}
            </button>
            {isOffline ? (
              <button
                className='inline-flex h-6 w-full items-center justify-center gap-1.5 rounded-full bg-amber-500 px-2 text-[11px] font-semibold text-[#201304] shadow-sm shadow-amber-950/10 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-amber-500/70'
                disabled={isResetting || isActivating}
                onClick={restoreDefault}
                type='button'
              >
                <AlertTriangle className='h-3.5 w-3.5' />
                {isResetting ? '恢复中...' : '恢复默认'}
              </button>
            ) : (
              <button
                className='inline-flex h-6 w-full items-center justify-center gap-1.5 rounded-full bg-green-600 px-2 text-[11px] font-semibold text-white shadow-sm shadow-green-950/10 transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-green-700/70'
                disabled={isActivating || isResetting}
                onClick={activate}
                type='button'
              >
                <Zap className='h-3.5 w-3.5' />
                {isActivating ? '启动中...' : '启动'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='px-2 pt-1.5'>
      <div
        className='flex items-center gap-2 rounded-2xl border border-green-500/20 bg-green-500/10 px-3 py-2 text-green-800 shadow-sm shadow-green-950/5 dark:border-green-400/20 dark:bg-green-500/10 dark:text-green-100'
        title={title}
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full bg-green-500 ${
            isChecking ? 'animate-pulse' : ''
          }`}
        />
        <Zap className='h-3.5 w-3.5 shrink-0' />
        <span className='min-w-0 flex-1 truncate text-[12px] font-semibold'>
          本地服务启动
        </span>
        <button
          className='inline-flex h-6 items-center justify-center rounded-full border border-green-500/20 bg-white/70 px-2 text-[11px] font-medium text-green-700 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-green-400/15 dark:bg-white/5 dark:text-green-100 dark:hover:bg-white/10'
          disabled={isResetting}
          onClick={restoreDefault}
          type='button'
        >
          {isResetting ? '停用中...' : '停用'}
        </button>
      </div>
    </div>
  );
}
