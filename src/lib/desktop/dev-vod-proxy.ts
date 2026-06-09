import { NextRequest } from 'next/server';

const DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY_ENABLED =
  process.env.NODE_ENV === 'development' &&
  process.env.NEXT_PUBLIC_APP_TARGET === 'desktop' &&
  process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY === 'true';

function getLocalServiceBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
}

function buildForwardHeaders(request: NextRequest): Headers {
  const headers = new Headers();

  ['accept', 'range'].forEach((name) => {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  });

  return headers;
}

function buildLocalServiceProxyUrl(
  request: NextRequest,
  pathname: string
): string {
  const upstreamUrl = new URL(`${getLocalServiceBaseUrl()}${pathname}`);
  upstreamUrl.search = request.nextUrl.search;
  return upstreamUrl.toString();
}

function rewriteDesktopManifestContent(
  manifestContent: string,
  localServiceBaseUrl: string
): string {
  const localServiceMediaPrefix = `${localServiceBaseUrl}/media/vod/`;
  const localServiceProxyPrefix = `${localServiceBaseUrl}/api/proxy/vod/`;
  return manifestContent
    .split(localServiceMediaPrefix)
    .join('/api/proxy/vod/')
    .split(localServiceProxyPrefix)
    .join('/api/proxy/vod/');
}

export async function proxyDesktopDevVodRequest(
  request: NextRequest,
  pathname: string,
  options: {
    rewriteManifest?: boolean;
  } = {}
): Promise<Response | null> {
  if (!DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY_ENABLED) {
    return null;
  }

  const localServiceBaseUrl = getLocalServiceBaseUrl();
  if (!localServiceBaseUrl) {
    return null;
  }

  const upstreamResponse = await fetch(
    buildLocalServiceProxyUrl(request, pathname),
    {
      method: request.method,
      headers: buildForwardHeaders(request),
      cache: 'no-store',
      redirect: 'manual',
    }
  );
  const responseHeaders = new Headers(upstreamResponse.headers);

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  }

  if (!options.rewriteManifest) {
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  }

  const manifestContent = await upstreamResponse.text();
  const rewrittenManifest = rewriteDesktopManifestContent(
    manifestContent,
    localServiceBaseUrl
  );

  if (responseHeaders.has('content-length')) {
    responseHeaders.set(
      'content-length',
      Buffer.byteLength(rewrittenManifest).toString()
    );
  }

  return new Response(rewrittenManifest, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}
