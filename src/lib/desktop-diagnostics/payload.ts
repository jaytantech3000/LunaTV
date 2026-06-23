import { createHash } from 'crypto';

import { DesktopDiagnosticsError } from './errors';
import { DesktopDiagnosticsNormalizedPayload } from './types';

const MAX_ARRAY_ITEMS = 20;
const MAX_ARRAY_ITEM_LENGTH = 200;
const MAX_CHANNEL_LENGTH = 32;
const MAX_EXCERPT_CHARS = 2000;
const MAX_EXCERPT_LINES = 40;
const MAX_OPTIONAL_TEXT_LENGTH = 200;
const MAX_REPORT_PAYLOAD_BYTES = 65536;
const MAX_REPORT_PAYLOAD_DEPTH = 6;
const MAX_RAW_LOG_BYTES = 524288;
const MAX_RAW_LOG_LINES = 5000;
const MAX_SUMMARY_LENGTH = 200;

type JsonLike =
  | null
  | boolean
  | number
  | string
  | JsonLike[]
  | { [key: string]: JsonLike };

const FIELD_ALIASES = {
  appVersion: ['appVersion', 'app_version'],
  arch: ['arch', 'architecture'],
  channel: ['channel', 'releaseChannel'],
  desktopCommit: ['desktopCommit', 'desktop_commit', 'commit'],
  findings: ['findings'],
  localServiceVersion: [
    'localServiceVersion',
    'local_service_version',
    'serviceVersion',
  ],
  osName: ['osName', 'os_name'],
  osVersion: ['osVersion', 'os_version'],
  platform: ['platform'],
  profileSyncEnabled: ['profileSyncEnabled', 'profile_sync_enabled'],
  rawLogText: [
    'rawLogText',
    'raw_log_text',
    'rawLog',
    'raw_log',
    'log',
    'logText',
    'log_text',
  ],
  recommendations: ['recommendations'],
  remoteSiteOrigin: ['remoteSiteOrigin', 'remote_site_origin', 'remoteSiteUrl'],
  reportPayload: ['reportPayload', 'report_payload', 'payload'],
  summary: ['summary', 'message', 'issueSummary'],
} as const;

function invalidPayload(message: string): never {
  throw new DesktopDiagnosticsError('invalid_payload', message, 400);
}

function pickField<T>(
  source: Record<string, unknown>,
  keys: readonly string[]
): T | undefined {
  for (const key of keys) {
    if (source[key] !== undefined) {
      return source[key] as T;
    }
  }

  return undefined;
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidPayload('Desktop diagnostics payload must be a JSON object.');
  }

  return value as Record<string, unknown>;
}

function normalizeRequiredText(
  value: unknown,
  fieldName: string,
  maxLength: number,
  options?: { lowercase?: boolean }
): string {
  if (typeof value !== 'string') {
    invalidPayload(`${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    invalidPayload(`${fieldName} is required.`);
  }
  if (trimmed.length > maxLength) {
    invalidPayload(`${fieldName} must be at most ${maxLength} characters.`);
  }

  const normalized = options?.lowercase ? trimmed.toLowerCase() : trimmed;
  return redactSensitiveText(normalized);
}

function normalizeOptionalText(
  value: unknown,
  fieldName: string,
  maxLength = MAX_OPTIONAL_TEXT_LENGTH,
  options?: { lowercase?: boolean }
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    invalidPayload(`${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    invalidPayload(`${fieldName} must be at most ${maxLength} characters.`);
  }

  const normalized = options?.lowercase ? trimmed.toLowerCase() : trimmed;
  return redactSensitiveText(normalized);
}

function normalizeBoolean(value: unknown, fieldName: string): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  invalidPayload(`${fieldName} must be a boolean.`);
}

function normalizeStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  const rawItems =
    typeof value === 'string'
      ? [value]
      : Array.isArray(value)
      ? value
      : invalidPayload(`${fieldName} must be an array of strings.`);

  if (rawItems.length > MAX_ARRAY_ITEMS) {
    invalidPayload(
      `${fieldName} must contain at most ${MAX_ARRAY_ITEMS} items.`
    );
  }

  return rawItems.map((item, index) => {
    if (typeof item !== 'string') {
      invalidPayload(`${fieldName}[${index}] must be a string.`);
    }

    const trimmed = item.trim();
    if (!trimmed) {
      invalidPayload(`${fieldName}[${index}] cannot be empty.`);
    }
    if (trimmed.length > MAX_ARRAY_ITEM_LENGTH) {
      invalidPayload(
        `${fieldName}[${index}] must be at most ${MAX_ARRAY_ITEM_LENGTH} characters.`
      );
    }

    return redactSensitiveText(trimmed);
  });
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function trimBlankEdges(value: string): string {
  const lines = normalizeLineEndings(value).split('\n');

  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }

  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop();
  }

  return lines.join('\n');
}

function buildRawLogExcerpt(value: string): string {
  const excerpt = value.split('\n').slice(0, MAX_EXCERPT_LINES).join('\n');
  if (excerpt.length <= MAX_EXCERPT_CHARS) {
    return excerpt;
  }

  return `${excerpt.slice(0, MAX_EXCERPT_CHARS - 3)}...`;
}

function normalizeOrigin(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    invalidPayload('remoteSiteOrigin must be a string.');
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function isSensitiveKey(key: string): boolean {
  return /(api[_-]?key|cookie|password|passwd|secret|token)/i.test(key);
}

function redactJsonLike(value: JsonLike, depth = 0, key?: string): JsonLike {
  if (depth > MAX_REPORT_PAYLOAD_DEPTH) {
    return '[TRUNCATED]';
  }

  if (key && isSensitiveKey(key)) {
    return '[REDACTED]';
  }

  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJsonLike(item, depth + 1));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactJsonLike(item, depth + 1, key),
      ])
    );
  }

  return value;
}

function normalizeReportPayload(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidPayload('reportPayload must be a JSON object.');
  }

  const redacted = redactJsonLike(value as JsonLike) as Record<string, unknown>;
  const sizeBytes = Buffer.byteLength(JSON.stringify(redacted), 'utf8');

  if (sizeBytes > MAX_REPORT_PAYLOAD_BYTES) {
    invalidPayload(
      `reportPayload must be at most ${MAX_REPORT_PAYLOAD_BYTES} bytes.`
    );
  }

  return redacted;
}

function normalizeRawLogText(value: unknown): {
  excerpt: string;
  sha256: string;
  sizeBytes: number;
  text: string;
} {
  if (typeof value !== 'string') {
    invalidPayload('rawLogText must be a string.');
  }

  const normalized = trimBlankEdges(value);
  if (!normalized) {
    invalidPayload('rawLogText is required.');
  }

  const redacted = redactSensitiveText(normalized);
  const lineCount = redacted.split('\n').length;
  if (lineCount > MAX_RAW_LOG_LINES) {
    invalidPayload(
      `rawLogText must contain at most ${MAX_RAW_LOG_LINES} lines.`
    );
  }

  const sizeBytes = Buffer.byteLength(redacted, 'utf8');
  if (sizeBytes > MAX_RAW_LOG_BYTES) {
    invalidPayload(`rawLogText must be at most ${MAX_RAW_LOG_BYTES} bytes.`);
  }

  return {
    excerpt: buildRawLogExcerpt(redacted),
    sha256: createHash('sha256').update(redacted).digest('hex'),
    sizeBytes,
    text: redacted,
  };
}

export function redactSensitiveText(value: string): string {
  let redacted = value;

  redacted = redacted.replace(
    /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+\b/gi,
    '$1[REDACTED]'
  );
  redacted = redacted.replace(
    /((?:api[_-]?key|token|password|passwd|secret|cookie)\s*[:=]\s*)([^\s"'`,;]+)/gi,
    '$1[REDACTED]'
  );
  redacted = redacted.replace(
    /(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
    '$1[REDACTED]@'
  );
  redacted = redacted.replace(
    /(https?:\/\/[^\s?#]+)\?[^\s#]+/gi,
    '$1?[REDACTED]'
  );
  redacted = redacted.replace(/\/Users\/[^/\s]+/g, '/Users/[REDACTED]');
  redacted = redacted.replace(/\/home\/[^/\s]+/g, '/home/[REDACTED]');
  redacted = redacted.replace(
    /[A-Za-z]:\\Users\\[^\\\s]+/g,
    (match) => `${match.slice(0, 9)}[REDACTED]`
  );

  return redacted;
}

export function computeErrorFingerprint(params: {
  findings: string[];
  rawLogText: string;
  summary: string;
}): string | null {
  const errorLines = params.rawLogText
    .split('\n')
    .filter((line) =>
      /(error|exception|panic|failed|failure|traceback|denied|refused)/i.test(
        line
      )
    )
    .slice(0, 8);

  const source = [params.summary, ...params.findings.slice(0, 5), ...errorLines]
    .join('\n')
    .trim();

  if (!source) {
    return null;
  }

  return createHash('sha256').update(source).digest('hex').slice(0, 16);
}

export function normalizeDesktopDiagnosticsPayload(
  input: unknown
): DesktopDiagnosticsNormalizedPayload {
  const payload = ensureObject(input);

  const channel = normalizeOptionalText(
    pickField(payload, FIELD_ALIASES.channel),
    'channel',
    MAX_CHANNEL_LENGTH,
    { lowercase: true }
  );
  const platform = normalizeRequiredText(
    pickField(payload, FIELD_ALIASES.platform),
    'platform',
    MAX_CHANNEL_LENGTH,
    { lowercase: true }
  );
  const summary = normalizeRequiredText(
    pickField(payload, FIELD_ALIASES.summary),
    'summary',
    MAX_SUMMARY_LENGTH
  );
  const findings = normalizeStringArray(
    pickField(payload, FIELD_ALIASES.findings),
    'findings'
  );
  const recommendations = normalizeStringArray(
    pickField(payload, FIELD_ALIASES.recommendations),
    'recommendations'
  );
  const rawLog = normalizeRawLogText(
    pickField(payload, FIELD_ALIASES.rawLogText)
  );
  const reportPayload = normalizeReportPayload(
    pickField(payload, FIELD_ALIASES.reportPayload)
  );

  return {
    appVersion: normalizeOptionalText(
      pickField(payload, FIELD_ALIASES.appVersion),
      'appVersion'
    ),
    arch: normalizeOptionalText(
      pickField(payload, FIELD_ALIASES.arch),
      'arch',
      64,
      {
        lowercase: true,
      }
    ),
    channel: channel || 'unknown',
    desktopCommit: normalizeOptionalText(
      pickField(payload, FIELD_ALIASES.desktopCommit),
      'desktopCommit'
    ),
    errorFingerprint: computeErrorFingerprint({
      findings,
      rawLogText: rawLog.text,
      summary,
    }),
    findings,
    localServiceVersion: normalizeOptionalText(
      pickField(payload, FIELD_ALIASES.localServiceVersion),
      'localServiceVersion'
    ),
    osName: normalizeOptionalText(
      pickField(payload, FIELD_ALIASES.osName),
      'osName'
    ),
    osVersion: normalizeOptionalText(
      pickField(payload, FIELD_ALIASES.osVersion),
      'osVersion'
    ),
    platform,
    profileSyncEnabled: normalizeBoolean(
      pickField(payload, FIELD_ALIASES.profileSyncEnabled),
      'profileSyncEnabled'
    ),
    rawLogExcerpt: rawLog.excerpt,
    rawLogSha256: rawLog.sha256,
    rawLogSizeBytes: rawLog.sizeBytes,
    rawLogText: rawLog.text,
    recommendations,
    remoteSiteOrigin: normalizeOrigin(
      pickField(payload, FIELD_ALIASES.remoteSiteOrigin)
    ),
    reportPayload,
    summary,
  };
}
