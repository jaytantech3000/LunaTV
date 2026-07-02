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
      var runtime =
        payload && typeof payload === 'object' && payload.runtime
          ? payload.runtime
          : {};
      var profileSync =
        payload && typeof payload === 'object' && payload.profileSync
          ? payload.profileSync
          : {};
      var current = window.RUNTIME_CONFIG || {};
      var baseConfig = {
        APP_TARGET: current.APP_TARGET,
        STORAGE_TYPE: current.STORAGE_TYPE,
        PROFILE_MODE: current.PROFILE_MODE,
        DESKTOP_RELEASE_PROXY_BASE_URL: current.DESKTOP_RELEASE_PROXY_BASE_URL,
        DOUBAN_PROXY_TYPE: current.DOUBAN_PROXY_TYPE,
        DOUBAN_PROXY: current.DOUBAN_PROXY,
        DOUBAN_IMAGE_PROXY_TYPE: current.DOUBAN_IMAGE_PROXY_TYPE,
        DOUBAN_IMAGE_PROXY: current.DOUBAN_IMAGE_PROXY,
        DISABLE_YELLOW_FILTER: current.DISABLE_YELLOW_FILTER,
        CUSTOM_CATEGORIES: current.CUSTOM_CATEGORIES,
        FLUID_SEARCH: current.FLUID_SEARCH,
        ENABLE_WEB_LIVE: current.ENABLE_WEB_LIVE,
        API_BASE_URL: current.API_BASE_URL,
        MEDIA_PROXY_BASE_URL: current.MEDIA_PROXY_BASE_URL,
        ENABLE_ADMIN_PANEL: current.ENABLE_ADMIN_PANEL,
        PLAYER_AUDIO_SPIKE_PROTECTION: current.PLAYER_AUDIO_SPIKE_PROTECTION,
        PLAYER_AUDIO_DYNAMIC_PROTECTION: current.PLAYER_AUDIO_DYNAMIC_PROTECTION,
        PLAYER_AUDIO_FIXED_CEILING: current.PLAYER_AUDIO_FIXED_CEILING,
        PLAYER_VISUAL_ENHANCEMENT: current.PLAYER_VISUAL_ENHANCEMENT,
        PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL:
          current.PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL,
        PLAYER_VISUAL_ENHANCEMENT_LEVEL:
          current.PLAYER_VISUAL_ENHANCEMENT_LEVEL,
        PROFILE_SYNC_ENABLED: current.PROFILE_SYNC_ENABLED,
        PROFILE_SYNC_STORAGE_TYPE: current.PROFILE_SYNC_STORAGE_TYPE,
        PROFILE_SYNC_PROFILE_MODE: current.PROFILE_SYNC_PROFILE_MODE,
      };
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
        runtime.playerAudioSpikeProtectionLevel !== undefined &&
        runtime.playerAudioSpikeProtectionLevel !== null
          ? runtime.playerAudioSpikeProtectionLevel
          : runtime.playerAudioSpikeProtection === undefined
          ? currentAudioLevel
          : runtime.playerAudioSpikeProtection
          ? 'standard'
          : 'off';
      var nextVisualLevel =
        runtime.playerVisualEnhancementLevel !== undefined &&
        runtime.playerVisualEnhancementLevel !== null
          ? runtime.playerVisualEnhancementLevel
          : runtime.playerVisualEnhancement === undefined
          ? currentVisualLevel
          : runtime.playerVisualEnhancement
          ? 'standard'
          : 'off';
      var profileSyncEnabled = coalesce(
        profileSync.enabled,
        coalesce(runtime.profileSyncEnabled, coalesce(current.PROFILE_SYNC_ENABLED, false))
      );

      window.RUNTIME_CONFIG = Object.assign(baseConfig, {
        DOUBAN_PROXY_TYPE: coalesce(
          runtime.doubanProxyType,
          current.DOUBAN_PROXY_TYPE
        ),
        DOUBAN_PROXY: coalesce(runtime.doubanProxy, current.DOUBAN_PROXY),
        DOUBAN_IMAGE_PROXY_TYPE: coalesce(
          runtime.doubanImageProxyType,
          current.DOUBAN_IMAGE_PROXY_TYPE
        ),
        DOUBAN_IMAGE_PROXY: coalesce(
          runtime.doubanImageProxy,
          current.DOUBAN_IMAGE_PROXY
        ),
        DISABLE_YELLOW_FILTER: coalesce(
          runtime.disableYellowFilter,
          current.DISABLE_YELLOW_FILTER
        ),
        FLUID_SEARCH: coalesce(runtime.fluidSearch, coalesce(current.FLUID_SEARCH, true)),
        ENABLE_WEB_LIVE: coalesce(
          runtime.enableWebLive,
          coalesce(current.ENABLE_WEB_LIVE, false)
        ),
        PLAYER_AUDIO_SPIKE_PROTECTION: nextAudioLevel !== 'off',
        PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: nextAudioLevel,
        PLAYER_AUDIO_DYNAMIC_PROTECTION: coalesce(
          runtime.playerAudioDynamicProtection,
          currentAudioDynamicProtection
        ),
        PLAYER_AUDIO_FIXED_CEILING: coalesce(
          runtime.playerAudioFixedCeiling,
          currentAudioFixedCeiling
        ),
        PLAYER_VISUAL_ENHANCEMENT: nextVisualLevel !== 'off',
        PLAYER_VISUAL_ENHANCEMENT_LEVEL: nextVisualLevel,
        PROFILE_SYNC_ENABLED: profileSyncEnabled,
        PROFILE_SYNC_STORAGE_TYPE: profileSyncEnabled
          ? coalesce(
              profileSync.storageType,
              current.PROFILE_SYNC_STORAGE_TYPE
            )
          : undefined,
        PROFILE_SYNC_PROFILE_MODE: profileSyncEnabled
          ? coalesce(
              profileSync.profileMode,
              current.PROFILE_SYNC_PROFILE_MODE
            )
          : undefined,
        CUSTOM_CATEGORIES: Array.isArray(runtime.customCategories)
          ? runtime.customCategories
          : current.CUSTOM_CATEGORIES || [],
      });
      window.__DESKTOP_PROFILE_BOOTSTRAP__ = payload;
      window.__SITE_PRESENTATION__ = {
        siteName: runtime.siteName,
        announcement: runtime.announcement,
      };

      if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event('lunatv:runtime-config-updated'));
      }
    }

    function fetchRuntimeConfig() {
      attempts += 1;

      fetch(baseUrl + '/api/profile/bootstrap', {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('desktop profile bootstrap request failed');
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
