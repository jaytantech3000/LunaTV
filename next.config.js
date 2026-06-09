/** @type {import('next').NextConfig} */
/* eslint-disable @typescript-eslint/no-var-requires */

const defaultRuntimeCaching = require('next-pwa/cache');

const isVercel = Boolean(process.env.VERCEL);
const enablePwaInDev = process.env.ENABLE_PWA_DEV === 'true';
const buildTarget = process.env.NEXT_BUILD_TARGET || 'web';
const isDesktopBuild = buildTarget === 'desktop';
const distDir =
  process.env.NEXT_DIST_DIR ||
  (isDesktopBuild
    ? '.next-desktop'
    : // Vercel's Next.js runtime expects the default `.next` directory unless the
      // project-level output directory is changed in Vercel settings.
      process.env.NODE_ENV === 'production' && !isVercel
      ? '.next-build'
      : '.next');

const nextConfig = {
  output: isDesktopBuild ? 'export' : 'standalone',
  // Keep dev and local production build artifacts isolated so a local
  // `next build` never corrupts a running `next dev` instance.
  distDir,
  eslint: {
    dirs: ['src'],
  },

  reactStrictMode: false,
  swcMinify: false,

  experimental: {
    instrumentationHook: process.env.NODE_ENV === 'production',
  },

  // Uncoment to add domain whitelist
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },

  webpack(config) {
    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg')
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: { not: /\.(css|scss|sass)$/ },
        resourceQuery: { not: /url/ }, // exclude if *.svg?url
        loader: '@svgr/webpack',
        options: {
          dimensions: false,
          titleProp: true,
        },
      }
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      crypto: false,
    };

    return config;
  },
};

const runtimeCaching = defaultRuntimeCaching.map((entry) => {
  if (entry?.options?.cacheName !== 'apis') {
    return entry;
  }

  return {
    ...entry,
    urlPattern: ({ url }) => {
      const isSameOrigin = self.origin === url.origin;
      if (!isSameOrigin) return false;

      const pathname = url.pathname;
      if (pathname.startsWith('/api/auth/')) return false;
      if (pathname.startsWith('/api/proxy/vod/')) return false;
      return pathname.startsWith('/api/');
    },
  };
});

const withPWA = require('next-pwa')({
  dest: 'public',
  disable:
    isDesktopBuild ||
    (process.env.NODE_ENV === 'development' && !enablePwaInDev),
  ...(enablePwaInDev
    ? {
        mode: 'production',
      }
    : {}),
  register: true,
  skipWaiting: true,
  runtimeCaching,
  fallbacks: {
    document: '/_offline',
  },
});

module.exports = withPWA(nextConfig);
