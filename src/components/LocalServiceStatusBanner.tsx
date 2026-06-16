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
      accentClassName: active
        ? 'from-emerald-500 via-emerald-500 to-teal-500'
        : 'from-sky-500 via-cyan-500 to-teal-500',
      badgeLabel: active ? '本机加速已启用' : '刷新后启用加速',
      description: active
        ? '当前页面会优先命中本地服务进行播放与下载加速。'
        : '已检测到本地服务在线，刷新一次页面即可切换到本机加速。',
      pulseClassName: active ? 'bg-emerald-100' : 'bg-cyan-100',
      title: active ? '本地服务已连接' : '检测到本地服务在线',
    };
  }, [health]);

  if (!health || !bannerState) {
    return null;
  }

  return (
    <div className='sticky top-12 z-[950] px-3 pt-2 md:top-0 md:px-6 lg:px-8'>
      <div
        className={`overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-r ${bannerState.accentClassName} text-white shadow-lg shadow-emerald-950/20`}
      >
        <div className='flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5'>
          <div className='flex items-start gap-3'>
            <div className='mt-0.5 rounded-2xl bg-white/15 p-2.5 backdrop-blur-sm'>
              <ServerCog className='h-5 w-5' />
            </div>
            <div className='min-w-0'>
              <div className='flex flex-wrap items-center gap-2'>
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    bannerState.pulseClassName
                  } ${isChecking ? 'animate-pulse' : ''}`}
                />
                <span className='text-sm font-semibold tracking-wide'>
                  {bannerState.title}
                </span>
                <span className='inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-white/95 backdrop-blur-sm'>
                  <Zap className='h-3.5 w-3.5' />
                  {bannerState.badgeLabel}
                </span>
              </div>
              <p className='mt-1 text-sm text-white/90'>
                {bannerState.description}
              </p>
              <p className='mt-1 text-xs text-white/75'>
                {health.baseUrl}
                {health.port ? ` · 端口 ${health.port}` : ''}
              </p>
            </div>
          </div>
          <button
            className='inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15'
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
  );
}
