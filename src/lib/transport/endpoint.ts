import { getRuntimeConfig } from '@/lib/runtime-config';

export type ApiSearchParamValue =
  | string
  | number
  | boolean
  | null
  | undefined;

export type ApiSearchParams = Record<string, ApiSearchParamValue>;

const API_PREFIX = '/api';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function normalizeApiPath(path: string): string {
  if (!path) {
    return API_PREFIX;
  }

  if (path.startsWith(API_PREFIX)) {
    return path;
  }

  if (path.startsWith('/')) {
    return `${API_PREFIX}${path}`;
  }

  return `${API_PREFIX}/${path}`;
}

function toSearchParams(
  searchParams?: ApiSearchParams | URLSearchParams
): URLSearchParams {
  if (!searchParams) {
    return new URLSearchParams();
  }

  if (searchParams instanceof URLSearchParams) {
    return new URLSearchParams(searchParams);
  }

  const nextSearchParams = new URLSearchParams();

  Object.entries(searchParams).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    nextSearchParams.set(key, String(value));
  });

  return nextSearchParams;
}

export function getApiBaseUrl(): string {
  const runtimeBaseUrl = getRuntimeConfig().API_BASE_URL?.trim();
  const envBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

  return normalizeBaseUrl(runtimeBaseUrl || envBaseUrl || '');
}

export function buildApiUrl(
  path: string,
  searchParams?: ApiSearchParams | URLSearchParams
): string {
  const normalizedPath = normalizeApiPath(path);
  const baseUrl = getApiBaseUrl();
  const nextUrl = `${baseUrl}${normalizedPath}`;
  const queryString = toSearchParams(searchParams).toString();

  if (!queryString) {
    return nextUrl;
  }

  return `${nextUrl}${nextUrl.includes('?') ? '&' : '?'}${queryString}`;
}
