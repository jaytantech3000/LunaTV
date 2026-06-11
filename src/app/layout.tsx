/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';

import {
  buildPublicRuntimeConfig,
  resolveSitePresentation,
} from '@/lib/runtime/public-config';

import DesktopRuntimeSync from '@/components/DesktopRuntimeSync';

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

    try {
      var request = new XMLHttpRequest();
      request.open('GET', baseUrl + '/api/runtime/public-config', false);
      request.setRequestHeader('Accept', 'application/json');
      request.send(null);

      if (request.status >= 200 && request.status < 300 && request.responseText) {
        var payload = JSON.parse(request.responseText);
        var current = window.RUNTIME_CONFIG || {};
        window.RUNTIME_CONFIG = Object.assign({}, current, {
          DOUBAN_PROXY_TYPE: payload.doubanProxyType ?? current.DOUBAN_PROXY_TYPE,
          DOUBAN_PROXY: payload.doubanProxy ?? current.DOUBAN_PROXY,
          DOUBAN_IMAGE_PROXY_TYPE: payload.doubanImageProxyType ?? current.DOUBAN_IMAGE_PROXY_TYPE,
          DOUBAN_IMAGE_PROXY: payload.doubanImageProxy ?? current.DOUBAN_IMAGE_PROXY,
          FLUID_SEARCH: payload.fluidSearch ?? current.FLUID_SEARCH ?? true,
          ENABLE_WEB_LIVE: payload.enableWebLive ?? current.ENABLE_WEB_LIVE ?? false,
          PLAYER_AUDIO_SPIKE_PROTECTION:
            payload.playerAudioSpikeProtection ?? current.PLAYER_AUDIO_SPIKE_PROTECTION ?? false,
          PLAYER_VISUAL_ENHANCEMENT:
            payload.playerVisualEnhancement ?? current.PLAYER_VISUAL_ENHANCEMENT ?? false,
          PROFILE_SYNC_ENABLED: payload.profileSyncEnabled ?? current.PROFILE_SYNC_ENABLED ?? false,
          CUSTOM_CATEGORIES: Array.isArray(payload.customCategories)
            ? payload.customCategories
            : current.CUSTOM_CATEGORIES || [],
        });
        window.__SITE_PRESENTATION__ = {
          siteName: payload.siteName,
          announcement: payload.announcement,
        };
      }
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
          <DesktopRuntimeSync />
          <SiteProvider siteName={siteName} announcement={announcement}>
            {children}
            <GlobalErrorIndicator />
          </SiteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
