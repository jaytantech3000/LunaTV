import { withDesktopAdminCapability } from '@/lib/desktop/admin-capability';
import { withLocalServiceAccessToken } from '@/lib/desktop/local-service-access';

import { ApiSearchParams, buildApiUrl } from './endpoint';

export interface ApiFetchOptions extends RequestInit {
  searchParams?: ApiSearchParams | URLSearchParams;
}

export async function apiFetch(
  path: string,
  options: ApiFetchOptions = {}
): Promise<Response> {
  const { searchParams, ...init } = options;
  return fetch(
    buildApiUrl(path, searchParams),
    await withLocalServiceAccessToken(withDesktopAdminCapability(path, init))
  );
}
