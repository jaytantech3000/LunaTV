type ServiceWorkerFetchEvent = Event & {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
};

declare const self: typeof globalThis & {
  __WB_DISABLE_DEV_LOGS?: boolean;
  location: Location;
  addEventListener(
    type: 'fetch',
    listener: (event: ServiceWorkerFetchEvent) => void
  ): void;
};

self.__WB_DISABLE_DEV_LOGS = true;

const DOWNLOAD_CACHE_NAME = 'moontv-vod-download-v1';
const VOD_PROXY_PATH_PREFIX = '/api/proxy/vod/';
const RANGE_HEADER_PATTERN = /^bytes=(\d+)-(\d*)$/i;

async function matchCachedDownloadResponse(
  cache: Cache,
  request: Request
): Promise<Response | undefined> {
  const requestUrl = new URL(request.url);
  const candidates = [
    request,
    request.url,
    `${requestUrl.pathname}${requestUrl.search}`,
  ];

  for (const candidate of candidates) {
    const matched = await cache.match(candidate);
    if (matched) {
      return matched;
    }
  }

  return undefined;
}

async function createRangedCachedResponse(
  request: Request,
  cachedResponse: Response
): Promise<Response> {
  const rangeHeader = request.headers.get('range');
  if (!rangeHeader) {
    return cachedResponse;
  }

  const rangeMatch = RANGE_HEADER_PATTERN.exec(rangeHeader.trim());
  if (!rangeMatch) {
    return cachedResponse;
  }

  const fullBuffer = await cachedResponse.arrayBuffer();
  const totalLength = fullBuffer.byteLength;
  const start = Number(rangeMatch[1]);
  const end =
    rangeMatch[2] === ''
      ? totalLength - 1
      : Math.min(totalLength - 1, Number(rangeMatch[2]));

  const headers = new Headers(cachedResponse.headers);
  headers.set('Accept-Ranges', 'bytes');

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    start >= totalLength ||
    end < start
  ) {
    headers.set('Content-Range', `bytes */${totalLength}`);
    headers.set('Content-Length', '0');
    return new Response(null, {
      status: 416,
      headers,
    });
  }

  const slicedBuffer = fullBuffer.slice(start, end + 1);
  headers.set('Content-Range', `bytes ${start}-${end}/${totalLength}`);
  headers.set('Content-Length', String(slicedBuffer.byteLength));

  return new Response(slicedBuffer, {
    status: 206,
    headers,
  });
}

async function createHeadCachedResponse(
  request: Request,
  cachedResponse: Response
): Promise<Response> {
  const targetResponse = request.headers.get('range')
    ? await createRangedCachedResponse(request, cachedResponse)
    : cachedResponse;

  return new Response(null, {
    status: targetResponse.status,
    headers: new Headers(targetResponse.headers),
  });
}

async function fetchAndCacheDownloadResponse(
  cache: Cache,
  request: Request
): Promise<Response> {
  if (request.method === 'HEAD') {
    return fetch(request);
  }

  const rangeHeader = request.headers.get('range');
  if (rangeHeader) {
    const headers = new Headers(request.headers);
    headers.delete('range');

    const networkResponse = await fetch(request.url, {
      method: 'GET',
      headers,
      credentials: request.credentials || 'same-origin',
      cache: 'no-store',
      redirect: request.redirect,
    });

    if (networkResponse.ok) {
      await cache.put(request.url, networkResponse.clone());
      return createRangedCachedResponse(request, networkResponse);
    }

    return networkResponse;
  }

  const networkResponse = await fetch(request);
  if (networkResponse.ok) {
    await cache.put(request.url, networkResponse.clone());
  }

  return networkResponse;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!['GET', 'HEAD'].includes(request.method)) {
    return;
  }

  const requestUrl = new URL(request.url);
  if (
    requestUrl.origin !== self.location.origin ||
    !requestUrl.pathname.startsWith(VOD_PROXY_PATH_PREFIX)
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(DOWNLOAD_CACHE_NAME);
      const cachedResponse = await matchCachedDownloadResponse(cache, request);

      if (cachedResponse) {
        if (request.method === 'HEAD') {
          return createHeadCachedResponse(request, cachedResponse);
        }

        return createRangedCachedResponse(request, cachedResponse);
      }

      return fetchAndCacheDownloadResponse(cache, request);
    })()
  );
});
