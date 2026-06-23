create extension if not exists pgcrypto;

create table if not exists public.desktop_diagnostics_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  channel text not null default 'unknown',
  app_version text,
  desktop_commit text,
  local_service_version text,
  platform text not null,
  os_name text,
  os_version text,
  arch text,
  profile_sync_enabled boolean not null default false,
  remote_site_origin text,
  summary text not null,
  findings jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  error_fingerprint text,
  status text not null default 'new',
  raw_log_object_path text not null,
  raw_log_size_bytes integer not null,
  raw_log_sha256 text not null,
  raw_log_excerpt text,
  report_payload jsonb not null default '{}'::jsonb,
  operator_notes text,
  github_issue_number integer,
  github_issue_url text,
  forwarded_to_github_at timestamptz,
  resolved_at timestamptz,
  constraint desktop_diagnostics_reports_status_check
    check (status in ('new', 'triaged', 'forwarded', 'resolved', 'ignored'))
);

create index if not exists desktop_diagnostics_reports_created_at_idx
  on public.desktop_diagnostics_reports (created_at desc);

create index if not exists desktop_diagnostics_reports_status_idx
  on public.desktop_diagnostics_reports (status);

create index if not exists desktop_diagnostics_reports_channel_idx
  on public.desktop_diagnostics_reports (channel);

create index if not exists desktop_diagnostics_reports_fingerprint_idx
  on public.desktop_diagnostics_reports (error_fingerprint);

create index if not exists desktop_diagnostics_reports_raw_log_sha256_idx
  on public.desktop_diagnostics_reports (raw_log_sha256);
