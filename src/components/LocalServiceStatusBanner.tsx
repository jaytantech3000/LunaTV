'use client';

import { AlertTriangle, RefreshCw, ServerCog, Zap } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

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

const LOCAL_SERVICE_POLL_MS = 20000;
const LOCAL_SERVICE_TIMEOUT_MS = 2500;
const PAGE_RELOAD_DELAY_MS = 140;

type LocalServiceBannerMode = 'available' | 'active' | 'offline';
type LocalServiceBannerState = {
  accentDotClassName: string;
  badgeClassName?: string;
  badgeLabel?: string | null;
  body?: string | null;
  bodyClassName?: string;
  icon: ReactNode;
  surfaceClassName: string;
  title: string;
};

function scheduleReload(): void {
  window.setTimeout(() => {
    window.location.reload();
  }, PAGE_RELOAD_DELAY_MS);
}

export function LocalServiceStatusBanner() {
  const [health, setHealth] = useState<ResolvedLocalServiceHealth | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [probeNonce, setProbeNonce] = useState(0);
  const [storedBaseUrl, setStoredBaseUrl] = useState<string | null>(null);

  useEffect(() => {
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
        clearTimeout(timeoutId);
        if (!cancelled) {
          setIsChecking(false);
        }
      }
    };

    void probeLocalService();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
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
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const bannerMode = useMemo<LocalServiceBannerMode | null>(() => {
    if (health) {
      return isLocalServiceAccelerationActive(health.baseUrl)
        ? 'active'
        : 'available';
    }

    return storedBaseUrl ? 'offline' : null;
  }, [health, storedBaseUrl]);

  const bannerState = useMemo(() => {
    if (!bannerMode) {
      return null;
    }

    if (bannerMode === 'active') {
      return {
        accentDotClassName: 'bg-emerald-300',
        icon: <Zap className='h-4 w-4 text-emerald-300' />,
        surfaceClassName:
          'border-emerald-500/25 bg-[#081510]/95 shadow-black/35',
        title: '本机加速已启用',
      } satisfies LocalServiceBannerState;
    }

    if (bannerMode === 'offline') {
      return {
        accentDotClassName: 'bg-amber-300',
        badgeClassName:
          'border border-amber-300/15 bg-amber-400/10 text-amber-100/85',
        badgeLabel: storedBaseUrl,
        body: '当前没有响应，恢复默认线路后可继续正常播放。',
        bodyClassName: 'text-amber-50/78',
        icon: <AlertTriangle className='h-3.5 w-3.5 text-amber-200' />,
        surfaceClassName:
          'border-amber-400/25 bg-[#171109]/95 shadow-black/40',
        title: '本机加速暂不可用',
      } satisfies LocalServiceBannerState;
    }

    return {
      accentDotClassName: 'bg-green-300',
      badgeClassName:
        'border border-green-300/15 bg-green-400/10 text-green-100/88',
      badgeLabel: health?.port ? `127.0.0.1:${health.port}` : health?.baseUrl,
      icon: <ServerCog className='h-3.5 w-3.5 text-green-100' />,
      surfaceClassName:
        'border-green-400/20 bg-[#08120f]/95 shadow-black/35',
      title: '本地服务已就绪',
    } satisfies LocalServiceBannerState;
  }, [bannerMode, health?.baseUrl, health?.port, storedBaseUrl]);

  const handleRecheck = () => {
    if (isChecking || isActivating || isResetting) {
      return;
    }

    setIsChecking(true);
    setProbeNonce((value) => value + 1);
  };

  const handleActivate = () => {
    if (!health || isActivating || isResetting) {
      return;
    }

    const nextBaseUrl = normalizeLocalServiceBaseUrl(health.baseUrl);
    if (!nextBaseUrl) {
      return;
    }

    setStoredLocalServiceAccelerationBaseUrl(nextBaseUrl);
    setStoredBaseUrl(nextBaseUrl);
    setIsActivating(true);
    scheduleReload();
  };

  const handleRestoreDefault = () => {
    if (isResetting || isActivating) {
      return;
    }

    clearStoredLocalServiceAccelerationBaseUrl();
    setIsResetting(true);
    scheduleReload();
  };

  if (!bannerMode || !bannerState) {
    return null;
  }

  return (
    <div className='pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.5rem)] z-[970] flex justify-center px-3 md:top-4'>
      {bannerMode === 'active' ? (
        <div
          className={`pointer-events-auto flex max-w-fit items-center gap-2 rounded-full border ${bannerState.surfaceClassName} px-3 py-1.5 text-white shadow-lg backdrop-blur-xl`}
          title={health?.baseUrl || storedBaseUrl || undefined}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${bannerState.accentDotClassName} ${
              isChecking ? 'animate-pulse' : ''
            }`}
          />
          {bannerState.icon}
          <span className='whitespace-nowrap text-xs font-semibold tracking-[0.02em]'>
            {bannerState.title}
          </span>
          <button
            className='inline-flex h-6 items-center justify-center rounded-full border border-white/10 bg-white/5 px-2 text-[11px] font-medium text-white/90 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60'
            disabled={isResetting}
            onClick={handleRestoreDefault}
            type='button'
          >
            {isResetting ? '停用中...' : '停用'}
          </button>
        </div>
      ) : (
        <div
          className={`pointer-events-auto w-full max-w-[min(92vw,420px)] rounded-2xl border ${bannerState.surfaceClassName} text-white shadow-2xl backdrop-blur-xl`}
        >
          <div className='flex flex-wrap items-center gap-x-2.5 gap-y-2 px-3 py-2.5'>
            <div className='flex min-w-0 items-center gap-2'>
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${bannerState.accentDotClassName} ${
                  isChecking ? 'animate-pulse' : ''
                }`}
              />
              {bannerState.icon}
              <span className='truncate text-sm font-semibold tracking-[0.01em]'>
                {bannerState.title}
              </span>
            </div>
            {bannerState.badgeLabel && bannerState.badgeClassName && (
              <span
                className={`min-w-0 max-w-full truncate rounded-full px-2 py-1 text-[11px] font-medium ${bannerState.badgeClassName}`}
                title={bannerState.badgeLabel}
              >
                {bannerState.badgeLabel}
              </span>
            )}
            {bannerState.body ? (
              <p
                className={`w-full pl-6 text-[11px] leading-4.5 ${bannerState.bodyClassName}`}
              >
                {bannerState.body}
              </p>
            ) : null}
            <div className='ml-auto flex items-center gap-2'>
              <button
                className='inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60'
                disabled={isChecking || isActivating || isResetting}
                onClick={handleRecheck}
                type='button'
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isChecking ? 'animate-spin' : ''}`}
                />
                {isChecking ? '检测中...' : '重新检测'}
              </button>
              {bannerMode === 'available' ? (
                <button
                  className='inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-green-600 px-2.5 text-xs font-semibold text-white shadow-sm shadow-black/25 transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-green-700/70'
                  disabled={isActivating || isResetting}
                  onClick={handleActivate}
                  type='button'
                >
                  <Zap className='h-3.5 w-3.5' />
                  {isActivating ? '正在切换...' : '启用加速'}
                </button>
              ) : (
                <button
                  className='inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-2.5 text-xs font-semibold text-[#1f1304] shadow-sm shadow-black/20 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-amber-600/70'
                  disabled={isResetting || isActivating}
                  onClick={handleRestoreDefault}
                  type='button'
                >
                  <AlertTriangle className='h-3.5 w-3.5' />
                  {isResetting ? '恢复中...' : '恢复默认'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
