import { createHmac, timingSafeEqual } from 'crypto';

interface M3U8ProxySignatureOptions {
  source?: string;
  referer?: string;
}

function getM3U8ProxySecret(): string | null {
  const explicit =
    process.env.M3U8_PROXY_SIGNING_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.PASSWORD ||
    process.env.ADMIN_PASSWORD;

  if (explicit) return explicit;

  return process.env.NODE_ENV === 'production'
    ? null
    : 'dev-m3u8-proxy-signing-secret';
}

function base64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signaturePayload(
  upstreamUrl: string,
  options: M3U8ProxySignatureOptions = {}
): string {
  return `${upstreamUrl}\n${options.source || ''}\n${options.referer || ''}`;
}

export function signM3U8ProxyRequest(
  upstreamUrl: string,
  options: M3U8ProxySignatureOptions = {}
): string | null {
  const secret = getM3U8ProxySecret();
  if (!secret) return null;

  return base64Url(
    createHmac('sha256', secret)
      .update(signaturePayload(upstreamUrl, options))
      .digest()
  );
}

export function verifyM3U8ProxySignature(
  upstreamUrl: string,
  signature: string | null,
  options: M3U8ProxySignatureOptions = {}
): boolean {
  if (!signature) return false;

  const expected = signM3U8ProxyRequest(upstreamUrl, options);
  if (!expected || expected.length !== signature.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
