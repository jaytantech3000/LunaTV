/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';

import {
  buildPublicRuntimeConfig,
  resolveSitePresentation,
} from '@/lib/runtime/public-config';

import DesktopRuntimeSync from '@/components/DesktopRuntimeSync';
import DesktopUpdateBootstrap from '@/components/DesktopUpdateBootstrap';

import { GlobalErrorIndicator } from '../components/GlobalErrorIndicator';
import { SiteProvider } from '../components/SiteProvider';
import { ThemeProvider } from '../components/ThemeProvider';

const inter = Inter({ subsets: ['latin'] });

function buildDesktopRuntimeBootstrapScript() {
  return `(function () {
    if (!window.RUNTIME_CONFIG || window.RUNTIME_CONFIG.APP_TARGET !== 'desktop') {
      return;
    }

    var baseUrl = (window.RUNTIME_CONFIG.API_BASE_URL || '').replace(/\\/+$/, '');
    if (!baseUrl) {
      return;
    }

    if (typeof fetch !== 'function') {
      return;
    }

    var attempts = 0;
    var maxAttempts = 10;
    var retryDelayMs = 1500;

    function coalesce(value, fallback) {
      return value === undefined || value === null ? fallback : value;
    }

    function applyPayload(payload) {
      var current = window.RUNTIME_CONFIG || {};
      var currentAudioLevel =
        current.PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL !== undefined &&
        current.PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL !== null
          ? current.PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL
          : current.PLAYER_AUDIO_SPIKE_PROTECTION
          ? 'standard'
          : 'off';
      var currentVisualLevel =
        current.PLAYER_VISUAL_ENHANCEMENT_LEVEL !== undefined &&
        current.PLAYER_VISUAL_ENHANCEMENT_LEVEL !== null
          ? current.PLAYER_VISUAL_ENHANCEMENT_LEVEL
          : current.PLAYER_VISUAL_ENHANCEMENT
          ? 'standard'
          : 'off';
      var currentAudioDynamicProtection = coalesce(
        current.PLAYER_AUDIO_DYNAMIC_PROTECTION,
        currentAudioLevel !== 'off'
      );
      var currentAudioFixedCeiling = coalesce(
        current.PLAYER_AUDIO_FIXED_CEILING,
        currentAudioLevel !== 'off'
      );
      var nextAudioLevel =
        payload.playerAudioSpikeProtectionLevel !== undefined &&
        payload.playerAudioSpikeProtectionLevel !== null
          ? payload.playerAudioSpikeProtectionLevel
          : payload.playerAudioSpikeProtection === undefined
          ? currentAudioLevel
          : payload.playerAudioSpikeProtection
          ? 'standard'
          : 'off';
      var nextVisualLevel =
        payload.playerVisualEnhancementLevel !== undefined &&
        payload.playerVisualEnhancementLevel !== null
          ? payload.playerVisualEnhancementLevel
          : payload.playerVisualEnhancement === undefined
          ? currentVisualLevel
          : payload.playerVisualEnhancement
          ? 'standard'
          : 'off';

      window.RUNTIME_CONFIG = Object.assign({}, current, {
        DOUBAN_PROXY_TYPE: coalesce(
          payload.doubanProxyType,
          current.DOUBAN_PROXY_TYPE
        ),
        DOUBAN_PROXY: coalesce(payload.doubanProxy, current.DOUBAN_PROXY),
        DOUBAN_IMAGE_PROXY_TYPE: coalesce(
          payload.doubanImageProxyType,
          current.DOUBAN_IMAGE_PROXY_TYPE
        ),
        DOUBAN_IMAGE_PROXY: coalesce(
          payload.doubanImageProxy,
          current.DOUBAN_IMAGE_PROXY
        ),
        DISABLE_YELLOW_FILTER: coalesce(
          payload.disableYellowFilter,
          current.DISABLE_YELLOW_FILTER
        ),
        FLUID_SEARCH: coalesce(payload.fluidSearch, coalesce(current.FLUID_SEARCH, true)),
        ENABLE_WEB_LIVE: coalesce(
          payload.enableWebLive,
          coalesce(current.ENABLE_WEB_LIVE, false)
        ),
        PLAYER_AUDIO_SPIKE_PROTECTION: nextAudioLevel !== 'off',
        PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: nextAudioLevel,
        PLAYER_AUDIO_DYNAMIC_PROTECTION: coalesce(
          payload.playerAudioDynamicProtection,
          currentAudioDynamicProtection
        ),
        PLAYER_AUDIO_FIXED_CEILING: coalesce(
          payload.playerAudioFixedCeiling,
          currentAudioFixedCeiling
        ),
        PLAYER_VISUAL_ENHANCEMENT: nextVisualLevel !== 'off',
        PLAYER_VISUAL_ENHANCEMENT_LEVEL: nextVisualLevel,
        PROFILE_SYNC_ENABLED: coalesce(
          payload.profileSyncEnabled,
          coalesce(current.PROFILE_SYNC_ENABLED, false)
        ),
        CUSTOM_CATEGORIES: Array.isArray(payload.customCategories)
          ? payload.customCategories
          : current.CUSTOM_CATEGORIES || [],
      });
      window.__SITE_PRESENTATION__ = {
        siteName: payload.siteName,
        announcement: payload.announcement,
      };

      if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event('lunatv:runtime-config-updated'));
      }
    }

    function fetchRuntimeConfig() {
      attempts += 1;

      fetch(baseUrl + '/api/runtime/public-config', {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('desktop runtime bootstrap request failed');
          }

          return response.json();
        })
        .then(function (payload) {
          applyPayload(payload);
        })
        .catch(function () {
          if (attempts < maxAttempts) {
            window.setTimeout(fetchRuntimeConfig, retryDelayMs);
          }
        });
    }

    try {
      window.setTimeout(fetchRuntimeConfig, 0);
    } catch (_) {
      // Ignore bootstrap refresh failures and fall back to build-time config.
    }
  })();`;
}

// 动态生成 metadata，支持配置更新后的标题变化
export async function generateMetadata(): Promise<Metadata> {
  const { siteName } = await resolveSitePresentation();

  return {
    title: siteName,
    description: '影视聚合',
    manifest: '/manifest.json',
  };
}

export const viewport: Viewport = {
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ siteName, announcement }, runtimeConfig] = await Promise.all([
    resolveSitePresentation(),
    buildPublicRuntimeConfig(),
  ]);

  return (
    <html lang='zh-CN' suppressHydrationWarning>
      <head>
        <meta
          name='viewport'
          content='width=device-width, initial-scale=1.0, viewport-fit=cover'
        />
        <link rel='apple-touch-icon' href='/icons/icon-192x192.png' />
        {/* 将配置序列化后直接写入脚本，浏览器端可通过 window.RUNTIME_CONFIG 获取 */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.RUNTIME_CONFIG = ${JSON.stringify(runtimeConfig)};`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: buildDesktopRuntimeBootstrapScript(),
          }}
        />
      </head>
      <body
        className={`${inter.className} min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-200`}
      >
        <ThemeProvider
          attribute='class'
          defaultTheme='system'
          enableSystem
          disableTransitionOnChange
        >
          <DesktopUpdateBootstrap />
          <DesktopRuntimeSync />
          <SiteProvider
            siteName={siteName}
            announcement={announcement}
            adultContentFilterEnabled={!runtimeConfig.DISABLE_YELLOW_FILTER}
          >
            {children}
            <GlobalErrorIndicator />
          </SiteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
