import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import 'server-only';

import {
  assertDesktopDiagnosticsSupabaseConfig,
  isDesktopDiagnosticsUploadEnabled,
} from './config';
import { DesktopDiagnosticsError } from './errors';
import { normalizeDesktopDiagnosticsPayload } from './payload';
import {
  DESKTOP_DIAGNOSTICS_STATUSES,
  DesktopDiagnosticsDownloadResult,
  DesktopDiagnosticsIngestResult,
  DesktopDiagnosticsListFilters,
  DesktopDiagnosticsListResult,
  DesktopDiagnosticsReportRow,
  DesktopDiagnosticsStatus,
  DesktopDiagnosticsStatusUpdateInput,
} from './types';

const LIST_COLUMNS = [
  'id',
  'created_at',
  'updated_at',
  'channel',
  'app_version',
  'desktop_commit',
  'local_service_version',
  'platform',
  'os_name',
  'os_version',
  'arch',
  'profile_sync_enabled',
  'remote_site_origin',
  'summary',
  'findings',
  'recommendations',
  'error_fingerprint',
  'status',
  'raw_log_size_bytes',
  'raw_log_sha256',
  'raw_log_excerpt',
  'operator_notes',
  'resolved_at',
].join(',');

const DETAIL_COLUMNS = [
  LIST_COLUMNS,
  'raw_log_object_path',
  'report_payload',
  'github_issue_number',
  'github_issue_url',
  'forwarded_to_github_at',
].join(',');

const STATUS_TRANSITIONS: Record<
  DesktopDiagnosticsStatus,
  DesktopDiagnosticsStatus[]
> = {
  forwarded: [],
  ignored: ['triaged'],
  new: ['triaged', 'ignored'],
  resolved: ['triaged'],
  triaged: ['resolved', 'ignored'],
};

const TABLE_NAME = 'desktop_diagnostics_reports';

function createSupabaseServiceClient() {
  const config = assertDesktopDiagnosticsSupabaseConfig();

  return {
    bucketName: config.bucketName,
    client: createClient(config.url, config.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }),
  };
}

function buildStorageObjectPath(
  channel: string,
  reportId: string,
  now = new Date()
): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');

  return `${channel}/${year}/${month}/${day}/${reportId}.txt`;
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function ensureStorageError(error: unknown, message: string): never {
  const details =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message)
      : null;

  throw new DesktopDiagnosticsError(
    'storage_failed',
    details ? `${message}: ${details}` : message,
    500
  );
}

function ensureAllowedStatusTransition(
  currentStatus: DesktopDiagnosticsStatus,
  nextStatus: DesktopDiagnosticsStatus
) {
  if (!DESKTOP_DIAGNOSTICS_STATUSES.includes(nextStatus)) {
    throw new DesktopDiagnosticsError(
      'invalid_payload',
      'Unsupported diagnostics status.',
      400
    );
  }

  if (currentStatus === nextStatus) {
    return;
  }

  if (!STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new DesktopDiagnosticsError(
      'invalid_status_transition',
      `Cannot move diagnostics status from ${currentStatus} to ${nextStatus}.`,
      400
    );
  }
}

function normalizeOperatorNotes(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new DesktopDiagnosticsError(
      'invalid_payload',
      'operatorNotes must be a string.',
      400
    );
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > 5000) {
    throw new DesktopDiagnosticsError(
      'invalid_payload',
      'operatorNotes must be at most 5000 characters.',
      400
    );
  }

  return trimmed;
}

export async function ingestDesktopDiagnosticsReport(
  input: unknown
): Promise<DesktopDiagnosticsIngestResult> {
  if (!isDesktopDiagnosticsUploadEnabled()) {
    throw new DesktopDiagnosticsError(
      'disabled',
      'Desktop diagnostics upload is disabled.',
      503
    );
  }

  const payload = normalizeDesktopDiagnosticsPayload(input);
  const { bucketName, client } = createSupabaseServiceClient();
  const reportId = randomUUID();
  const objectPath = buildStorageObjectPath(payload.channel, reportId);

  const uploadResult = await client.storage
    .from(bucketName)
    .upload(objectPath, payload.rawLogText, {
      contentType: 'text/plain; charset=utf-8',
      upsert: false,
    });

  if (uploadResult.error) {
    ensureStorageError(
      uploadResult.error,
      'Failed to store the raw diagnostics log.'
    );
  }

  const insertResult = await client
    .from(TABLE_NAME)
    .insert({
      app_version: payload.appVersion,
      arch: payload.arch,
      channel: payload.channel,
      desktop_commit: payload.desktopCommit,
      error_fingerprint: payload.errorFingerprint,
      findings: payload.findings,
      id: reportId,
      local_service_version: payload.localServiceVersion,
      operator_notes: null,
      os_name: payload.osName,
      os_version: payload.osVersion,
      platform: payload.platform,
      profile_sync_enabled: payload.profileSyncEnabled,
      raw_log_excerpt: payload.rawLogExcerpt,
      raw_log_object_path: objectPath,
      raw_log_sha256: payload.rawLogSha256,
      raw_log_size_bytes: payload.rawLogSizeBytes,
      recommendations: payload.recommendations,
      remote_site_origin: payload.remoteSiteOrigin,
      report_payload: payload.reportPayload,
      status: 'new' as const,
      summary: payload.summary,
    })
    .select('id,status')
    .single();

  if (insertResult.error) {
    try {
      await client.storage.from(bucketName).remove([objectPath]);
    } catch {
      // Swallow cleanup failures so the original write error remains visible.
    }

    ensureStorageError(
      insertResult.error,
      'Failed to store diagnostics metadata.'
    );
  }

  return {
    forwardedToGithub: false,
    reportId: insertResult.data.id,
    status: insertResult.data.status as DesktopDiagnosticsStatus,
    stored: true,
  };
}

export async function listDesktopDiagnosticsReports(
  filters: DesktopDiagnosticsListFilters
): Promise<DesktopDiagnosticsListResult> {
  const { client } = createSupabaseServiceClient();
  const page = clampInteger(filters.page, 1, 1, 100000);
  const pageSize = clampInteger(filters.pageSize, 20, 1, 100);
  const start = (page - 1) * pageSize;
  const end = start + pageSize - 1;

  let query = client
    .from(TABLE_NAME)
    .select(LIST_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(start, end);

  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.channel) {
    query = query.eq('channel', filters.channel);
  }
  if (filters.platform) {
    query = query.eq('platform', filters.platform);
  }
  if (filters.from) {
    query = query.gte('created_at', filters.from);
  }
  if (filters.to) {
    query = query.lte('created_at', filters.to);
  }

  const result = await query;

  if (result.error) {
    ensureStorageError(result.error, 'Failed to list diagnostics reports.');
  }

  return {
    items: (result.data ||
      []) as unknown as DesktopDiagnosticsListResult['items'],
    page,
    pageSize,
    total: result.count ?? 0,
  };
}

export async function getDesktopDiagnosticsReport(
  id: string
): Promise<DesktopDiagnosticsReportRow> {
  const { client } = createSupabaseServiceClient();
  const result = await client
    .from(TABLE_NAME)
    .select(DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (result.error) {
    ensureStorageError(result.error, 'Failed to load diagnostics report.');
  }
  if (!result.data) {
    throw new DesktopDiagnosticsError(
      'not_found',
      'Diagnostics report not found.',
      404
    );
  }

  return result.data as unknown as DesktopDiagnosticsReportRow;
}

export async function downloadDesktopDiagnosticsRawLog(
  id: string
): Promise<DesktopDiagnosticsDownloadResult> {
  const { bucketName, client } = createSupabaseServiceClient();
  const report = await getDesktopDiagnosticsReport(id);
  const downloadResult = await client.storage
    .from(bucketName)
    .download(report.raw_log_object_path);

  if (downloadResult.error || !downloadResult.data) {
    ensureStorageError(
      downloadResult.error,
      'Failed to download diagnostics raw log.'
    );
  }

  return {
    fileName: `desktop-diagnostics-${report.id}.txt`,
    report,
    text: await downloadResult.data.text(),
  };
}

export async function updateDesktopDiagnosticsReportStatus(
  id: string,
  input: DesktopDiagnosticsStatusUpdateInput
): Promise<DesktopDiagnosticsReportRow> {
  const current = await getDesktopDiagnosticsReport(id);
  const nextStatus = input.status;
  const operatorNotes = normalizeOperatorNotes(input.operatorNotes);

  ensureAllowedStatusTransition(current.status, nextStatus);

  const now = new Date().toISOString();
  const wasResolved = current.status === 'resolved';
  const updatePayload: Partial<DesktopDiagnosticsReportRow> = {
    operator_notes: operatorNotes,
    status: nextStatus,
    updated_at: now,
  };

  if (nextStatus === 'resolved') {
    updatePayload.resolved_at = now;
  } else if (wasResolved) {
    updatePayload.resolved_at = null;
  }

  const { client } = createSupabaseServiceClient();
  const result = await client
    .from(TABLE_NAME)
    .update(updatePayload)
    .eq('id', id)
    .select(DETAIL_COLUMNS)
    .single();

  if (result.error) {
    ensureStorageError(result.error, 'Failed to update diagnostics report.');
  }

  return result.data as unknown as DesktopDiagnosticsReportRow;
}
