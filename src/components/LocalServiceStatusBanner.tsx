'use client';

import { RefreshCw, ServerCog, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { getRuntimeConfig } from '@/lib/runtime-config';

interface LocalServiceHealthPayload {
  base_url?: string;
  port?: number;
  status?: string;
}

interface ResolvedLocalServiceHealth {
  baseUrl: string;
  port: number | null;
}

const LOCAL_SERVICE_HEALTH_URL = 'http://127.0.0.1:8787/health';
const LOCAL_SERVICE_POLL_MS = 20000;
const LOCAL_SERVICE_TIMEOUT_MS = 2500;

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return normalized.replace(/\/+$/, '');
  }
}

function normalizeOrigin(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).origin;
  } catch {
    return normalizeBaseUrl(normalized);
  }
}

function isLocalAccelerationActive(baseUrl: string): boolean {
  const runtimeConfig = getRuntimeConfig();
  const configuredBaseUrls = [
    runtimeConfig.API_BASE_URL,
    runtimeConfig.MEDIA_PROXY_BASE_URL,
  ]
    .map((value) => normalizeOrigin(value))
    .filter((value): value is string => Boolean(value));

  const localServiceOrigin = normalizeOrigin(baseUrl);
  return Boolean(
    localServiceOrigin &&
      configuredBaseUrls.some((value) => value === localServiceOrigin)
  );
}

export function LocalServiceStatusBanner() {
  const [health, setHealth] = useState<ResolvedLocalServiceHealth | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [probeNonce, setProbeNonce] = useState(0);

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
            normalizeBaseUrl(payload.base_url) ||
            normalizeBaseUrl(
              LOCAL_SERVICE_HEALTH_URL.replace(/\/health$/, '')
            ) ||
            'http://127.0.0.1:8787',
          port: typeof payload.port === 'number' ? payload.port : null,
        });
      } catch {
        if (!cancelled) {
          setHealth(null);
        }
      } finally {
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

  const bannerState = useMemo(() => {
    if (!health) {
      return null;
    }

    const active = isLocalAccelerationActive(health.baseUrl);
    return {
      active,
      glowClassName: active
        ? 'from-emerald-500/18 via-emerald-400/8'
        : 'from-green-500/14 via-emerald-500/8',
      iconSurfaceClassName: active
        ? 'border-emerald-400/20 bg-emerald-500/12 text-emerald-100'
        : 'border-green-400/15 bg-green-500/10 text-green-100',
      metaClassName: active ? 'text-emerald-100/70' : 'text-green-100/70',
      pulseClassName: active ? 'bg-emerald-300' : 'bg-green-300',
      surfaceClassName: active
        ? 'border-emerald-500/20 bg-[#071510]/95 shadow-black/40'
        : 'border-green-500/15 bg-[#08110f]/95 shadow-black/35',
      title: active ? '本机加速已启用' : '检测到本地服务在线',
    };
  }, [health]);

  if (!health || !bannerState) {
    return null;
  }

  return (
    <div className='sticky top-12 z-[950] px-3 pt-1.5 md:top-0 md:px-6 lg:px-8'>
      <div
        className={`relative overflow-hidden rounded-xl border ${bannerState.surfaceClassName} text-white shadow-lg`}
      >
        <div
          aria-hidden='true'
          className={`pointer-events-none absolute inset-y-0 left-0 w-28 bg-gradient-to-r ${bannerState.glowClassName} to-transparent`}
        />
        <div className='flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4'>
          <div className='flex min-w-0 items-center gap-3'>
            <div
              className={`rounded-xl border p-2 backdrop-blur-sm ${bannerState.iconSurfaceClassName}`}
            >
              <ServerCog className='h-4.5 w-4.5' />
            </div>
            <div className='min-w-0'>
              <div className='flex flex-wrap items-center gap-2'>
                <span
                  className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                    bannerState.pulseClassName
                  } ${isChecking ? 'animate-pulse' : ''}`}
                />
                <span className='text-sm font-semibold tracking-wide'>
                  {bannerState.title}
                </span>
                {bannerState.active && (
                  <span className='inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-100 backdrop-blur-sm'>
                    <Zap className='h-3.5 w-3.5' />
                    当前页已走本机加速
                  </span>
                )}
              </div>
              <p
                className={`mt-0.5 truncate text-xs ${bannerState.metaClassName}`}
              >
                {health.baseUrl}
                {health.port ? ` · 端口 ${health.port}` : ''}
              </p>
            </div>
          </div>
          <div className='flex items-center gap-2 self-start sm:self-center'>
            {!bannerState.active && (
              <button
                className='inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm shadow-black/30 transition-colors hover:bg-green-500'
                onClick={() => window.location.reload()}
                type='button'
              >
                <Zap className='h-4 w-4' />
                刷新启用加速
              </button>
            )}
            <button
              className='inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10'
              onClick={() => setProbeNonce((value) => value + 1)}
              type='button'
            >
              <RefreshCw
                className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`}
              />
              重新检测
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
