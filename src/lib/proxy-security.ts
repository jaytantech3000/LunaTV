import { lookup } from 'dns/promises';
import { isIP } from 'net';

const HOST_VALIDATION_CACHE_TTL_MS = 60_000;
const DNS_LOOKUP_TIMEOUT_MS = 4_000;

const validatedHostCache = new Map<string, number>();
const inflightHostValidationCache = new Map<string, Promise<void>>();

export function normalizeHeaderUrl(
  value: string | null | undefined
): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

function isBlockedHostname(hostname: string): boolean {
  return (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'metadata.google.internal'
  );
}

function isBlockedIPv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 224 && b === 0 && c === 0) ||
    a >= 224
  );
}

function isBlockedIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8')
  );
}

function isBlockedAddress(address: string): boolean {
  const version = isIP(normalizeHostname(address));
  if (version === 4) return isBlockedIPv4(address);
  if (version === 6) return isBlockedIPv6(normalizeHostname(address));
  return true;
}

function isHostValidationCached(hostname: string): boolean {
  const expiresAt = validatedHostCache.get(hostname);
  if (!expiresAt) {
    return false;
  }

  if (expiresAt <= Date.now()) {
    validatedHostCache.delete(hostname);
    return false;
  }

  return true;
}

function cacheValidatedHost(hostname: string): void {
  validatedHostCache.set(hostname, Date.now() + HOST_VALIDATION_CACHE_TTL_MS);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (result) => {
        clearTimeout(timeoutId);
        resolve(result);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

async function validateResolvableHostname(hostname: string): Promise<void> {
  if (isHostValidationCached(hostname)) {
    return;
  }

  const existingValidation = inflightHostValidationCache.get(hostname);
  if (existingValidation) {
    await existingValidation;
    return;
  }

  const validationPromise = (async () => {
    const records = await withTimeout(
      lookup(hostname, { all: true, verbatim: true }),
      DNS_LOOKUP_TIMEOUT_MS,
      `Host lookup timed out: ${hostname}`
    );

    if (!records.length) {
      throw new Error('Host did not resolve');
    }

    if (records.some((record) => isBlockedAddress(record.address))) {
      throw new Error('Host resolves to a blocked IP address');
    }

    cacheValidatedHost(hostname);
  })();

  inflightHostValidationCache.set(hostname, validationPromise);

  try {
    await validationPromise;
  } finally {
    if (inflightHostValidationCache.get(hostname) === validationPromise) {
      inflightHostValidationCache.delete(hostname);
    }
  }
}

export async function validateProxyTargetUrl(rawUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid url');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https supported');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URL credentials are not supported');
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (isBlockedHostname(hostname)) {
    throw new Error('Blocked host');
  }

  const literalVersion = isIP(hostname);
  if (literalVersion) {
    if (isBlockedAddress(hostname)) throw new Error('Blocked IP address');
    return parsed.toString();
  }

  await validateResolvableHostname(hostname);

  return parsed.toString();
}

export function clearProxyValidationCachesForTests(): void {
  validatedHostCache.clear();
  inflightHostValidationCache.clear();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  responseMode: 'stream' | 'buffer' = 'stream'
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });

    if (responseMode !== 'buffer') {
      return response;
    }

    const body = await response.arrayBuffer();
    return new Response(body, {
      headers: new Headers(response.headers),
      status: response.status,
      statusText: response.statusText,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWithValidatedRedirects(
  rawUrl: string,
  init: RequestInit,
  options: {
    timeoutMs: number;
    maxRedirects?: number;
    initialUrlValidated?: boolean;
    responseMode?: 'stream' | 'buffer';
  }
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 3;
  const initialUrlValidated = options.initialUrlValidated === true;
  const responseMode = options.responseMode ?? 'stream';
  let currentUrl = rawUrl;

  for (let i = 0; i <= maxRedirects; i += 1) {
    const validatedUrl =
      i === 0 && initialUrlValidated
        ? currentUrl
        : await validateProxyTargetUrl(currentUrl);
    const response = await fetchWithTimeout(
      validatedUrl,
      { ...init, redirect: 'manual' },
      options.timeoutMs,
      responseMode
    );

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.has('location')
    ) {
      if (i === maxRedirects) throw new Error('Too many redirects');
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect location missing');
      currentUrl = new URL(location, validatedUrl).toString();
      continue;
    }

    return response;
  }

  throw new Error('Too many redirects');
}
