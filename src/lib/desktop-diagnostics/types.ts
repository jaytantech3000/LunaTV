export const DESKTOP_DIAGNOSTICS_STATUSES = [
  'new',
  'triaged',
  'forwarded',
  'resolved',
  'ignored',
] as const;

export type DesktopDiagnosticsStatus =
  (typeof DESKTOP_DIAGNOSTICS_STATUSES)[number];

export type DesktopDiagnosticsOperatorRole = 'owner' | 'admin';

export interface DesktopDiagnosticsNormalizedPayload {
  channel: string;
  appVersion: string | null;
  desktopCommit: string | null;
  localServiceVersion: string | null;
  platform: string;
  osName: string | null;
  osVersion: string | null;
  arch: string | null;
  profileSyncEnabled: boolean;
  remoteSiteOrigin: string | null;
  summary: string;
  findings: string[];
  recommendations: string[];
  rawLogText: string;
  rawLogSizeBytes: number;
  rawLogSha256: string;
  rawLogExcerpt: string;
  reportPayload: Record<string, unknown>;
  errorFingerprint: string | null;
}

export interface DesktopDiagnosticsReportRow {
  id: string;
  created_at: string;
  updated_at: string;
  channel: string;
  app_version: string | null;
  desktop_commit: string | null;
  local_service_version: string | null;
  platform: string;
  os_name: string | null;
  os_version: string | null;
  arch: string | null;
  profile_sync_enabled: boolean;
  remote_site_origin: string | null;
  summary: string;
  findings: string[];
  recommendations: string[];
  error_fingerprint: string | null;
  status: DesktopDiagnosticsStatus;
  raw_log_object_path: string;
  raw_log_size_bytes: number;
  raw_log_sha256: string;
  raw_log_excerpt: string | null;
  report_payload: Record<string, unknown>;
  operator_notes: string | null;
  github_issue_number: number | null;
  github_issue_url: string | null;
  forwarded_to_github_at: string | null;
  resolved_at: string | null;
}

export type DesktopDiagnosticsListItem = Pick<
  DesktopDiagnosticsReportRow,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'channel'
  | 'app_version'
  | 'desktop_commit'
  | 'local_service_version'
  | 'platform'
  | 'os_name'
  | 'os_version'
  | 'arch'
  | 'profile_sync_enabled'
  | 'remote_site_origin'
  | 'summary'
  | 'findings'
  | 'recommendations'
  | 'error_fingerprint'
  | 'status'
  | 'raw_log_size_bytes'
  | 'raw_log_sha256'
  | 'raw_log_excerpt'
  | 'operator_notes'
  | 'resolved_at'
>;

export interface DesktopDiagnosticsListFilters {
  channel?: string;
  from?: string;
  page?: number;
  pageSize?: number;
  platform?: string;
  status?: DesktopDiagnosticsStatus;
  to?: string;
}

export interface DesktopDiagnosticsListResult {
  items: DesktopDiagnosticsListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface DesktopDiagnosticsDownloadResult {
  fileName: string;
  report: DesktopDiagnosticsReportRow;
  text: string;
}

export interface DesktopDiagnosticsIngestResult {
  forwardedToGithub: false;
  reportId: string;
  status: DesktopDiagnosticsStatus;
  stored: true;
}

export interface DesktopDiagnosticsOperator {
  role: DesktopDiagnosticsOperatorRole;
  username: string;
}

export interface DesktopDiagnosticsStatusUpdateInput {
  operatorNotes?: string;
  status: DesktopDiagnosticsStatus;
}
