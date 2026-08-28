import { withDesktopAdminCapability } from '@/lib/desktop/admin-capability';
import { withLocalServiceAccessToken } from '@/lib/desktop/local-service-access';

import { ApiSearchParams, buildApiUrl } from './endpoint';

export interface ApiFetchOptions extends RequestInit {
  searchParams?: ApiSearchParams | URLSearchParams;
  timeoutMs?: number;
}

export async function apiFetch(
  path: string,
  options: ApiFetchOptions = {}
): Promise<Response> {
  const { searchParams, timeoutMs, ...init } = options;
  const requestInit = await withLocalServiceAccessToken(
    withDesktopAdminCapability(path, init)
  );

  // 覆盖未显式传入 signal 的请求，避免本地服务异常时请求永久挂起。
  if (typeof timeoutMs !== 'number' || requestInit.signal) {
    return fetch(buildApiUrl(path, searchParams), requestInit);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(buildApiUrl(path, searchParams), {
      ...requestInit,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
