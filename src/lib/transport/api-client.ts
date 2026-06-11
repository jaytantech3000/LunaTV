import { ApiSearchParams, buildApiUrl } from './endpoint';

export interface ApiFetchOptions extends RequestInit {
  searchParams?: ApiSearchParams | URLSearchParams;
}

export function apiFetch(
  path: string,
  options: ApiFetchOptions = {}
): Promise<Response> {
  const { searchParams, ...init } = options;
  return fetch(buildApiUrl(path, searchParams), init);
}
