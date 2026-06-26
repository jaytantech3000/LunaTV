import { MusicApiError } from './netease';
import type { MusicPlaybackQuality } from './types';

const FETCH_TIMEOUT_MS = 15_000;
const SUMMARY_ACCENT_COLORS = [
  '#ff5f6d',
  '#7b61ff',
  '#0ea5e9',
  '#0f766e',
  '#22c55e',
  '#f97316',
];

export function normalizeOptionalText(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function normalizeRemoteUrl(
  url: string | null | undefined
): string | undefined {
  const normalized = normalizeOptionalText(url);
  if (!normalized) {
    return undefined;
  }

  return normalized;
}

export function resolveQuality(
  quality: string | null | undefined
): MusicPlaybackQuality {
  return quality === 'high' ? 'high' : 'standard';
}

export function requireQueryValue(
  value: string | null | undefined,
  errorMessage: string
): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new MusicApiError(errorMessage, 400);
  }

  return normalized;
}

export function normalizePage(page: string | null | undefined): number {
  const parsed = Number.parseInt(page || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function pickAccentColor(index: number): string {
  return SUMMARY_ACCENT_COLORS[index % SUMMARY_ACCENT_COLORS.length];
}

export function buildUpstreamUrl(
  baseUrl: string,
  pathname: string,
  searchParams?: Record<string, string>
): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const url = new URL(`${normalizedBaseUrl}${pathname}`);

  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  return url.toString();
}

export async function fetchMusicJson<T>(
  url: string,
  init: RequestInit | undefined,
  fallbackMessage: string
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new MusicApiError(fallbackMessage, 502);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof MusicApiError) {
      throw error;
    }

    throw new MusicApiError(
      error instanceof Error
        ? `${fallbackMessage}: ${error.message}`
        : fallbackMessage,
      502
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
