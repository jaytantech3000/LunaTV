export function buildQueryCacheHeaders(
  cacheTime: number
): Record<string, string> {
  return {
    'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
    'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
    'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
    'Netlify-Vary': 'query',
  };
}
