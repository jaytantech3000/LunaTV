# Desktop Diagnostics Storage Execution Plan

## Document Metadata

- Date: 2026-06-18
- Branch: `nova`
- Status: Final execution baseline
- Desktop status: diagnostics UI and local `.txt` export already exist in the desktop app
- Initial rollout boundary: ship web ingestion, Supabase persistence, and admin triage first; do not enable GitHub forwarding in v1

## Execution Summary

This rollout finishes the server-side half of desktop diagnostics.

Desktop users already have local diagnostics export. The missing path is:

1. desktop app submits diagnostics to the web deployment
2. web deployment validates and redacts the payload
3. web deployment stores metadata in Supabase Postgres
4. web deployment stores raw log text in a private Supabase Storage bucket
5. operators inspect and triage reports in the existing admin surface

GitHub Issues are explicitly not part of the initial critical path.

## Final Decisions

- `nova` and `luna` use separate Supabase projects. Do not share one database or bucket across environments.
- Raw diagnostics text is stored only in a private Supabase Storage bucket named `desktop-diagnostics`.
- Searchable metadata is stored in Postgres table `desktop_diagnostics_reports`.
- Initial release stops at operator triage. GitHub forwarding stays disabled and is not a release blocker.
- Diagnostics operator tooling lives inside the existing `/admin` surface instead of a new app.
- Raw log retention defaults to 30 days. Metadata retention defaults to 180 days.
- `desktop_diagnostics_events` is deferred. Status changes are written directly on the report row in v1.
- The upload route must run on the `nodejs` runtime and use server-side credentials only.
- If the existing desktop upload payload differs from the canonical schema below, the web route normalizes it server-side instead of requiring a desktop redesign.

## Scope

Included:

- compatibility with the existing desktop diagnostics payload
- web ingestion API
- server-side validation, redaction, hashing, and persistence
- admin list, detail, download, and status update flow
- deployment, validation, rollback, and retention guidance

Excluded:

- redesigning the desktop diagnostics UI
- redesigning the local `.txt` log export format unless compatibility requires it
- direct desktop writes to Supabase
- public client-side access to diagnostics rows or raw logs
- automatic GitHub issue creation
- advanced deduplication or merge UI
- automated retention cleanup jobs

## Current Repository Reality

- `nova` does not yet include the ingestion route, persistence helpers, or admin diagnostics UI.
- The current storage abstraction in `src/lib/db.ts` is designed for user-facing app data and is not an appropriate home for large raw diagnostics text.
- `package.json` does not currently include a Supabase client dependency, so the web implementation must add one.
- The existing admin page at `src/app/admin/page.tsx` is the correct integration point for operator tooling.

## High-Level Architecture

```text
Desktop app
  -> local export (.txt)
  -> POST {report} to profile_sync.api_base_url/api/desktop/diagnostics/upload
  -> web server validates request
  -> web server redacts and normalizes payload
  -> web server stores metadata row in Supabase Postgres
  -> web server stores raw log text in private Supabase Storage
  -> web server returns reportId and status to the desktop app
  -> operator reviews report in admin UI
```

## Storage Design

### Environment Split

- `nova`: dedicated Supabase project for validation and internal rollout
- `luna`: dedicated Supabase project for production rollout
- `luna` must not reuse the `nova` Supabase project, schema, or Storage bucket

### Persistence Split

Do not store the full raw diagnostics log inside the main Postgres row.

Use:

- one Postgres row for searchable metadata, triage status, hash, and object path
- one private Storage object for the raw `.txt` log body
- one short redacted excerpt in the row for list/detail convenience

This keeps large text out of hot relational rows while preserving operator searchability.

### Storage Object Path

Use this path pattern:

```text
{channel}/{yyyy}/{mm}/{dd}/{reportId}.txt
```

Examples:

```text
nova/2026/06/18/7d6d0f4b-91e4-4fbb-9f37-6dd5a7dd5fef.txt
luna/2026/06/18/2ac55f97-7fb9-45cf-9786-e8da2c1a3d16.txt
```

## Required Supabase Data Model

### Table: `desktop_diagnostics_reports`

Purpose:

- one row per uploaded report
- searchable operator metadata
- triage status and notes
- reference to the private raw log object

Required schema for v1:

```sql
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
```

Required indexes:

```sql
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
```

Implementation notes:

- `updated_at` is updated by application code on every status or notes change.
- `error_fingerprint` is best-effort in v1. If fingerprint generation is unavailable, store `null` and do not fail ingestion.
- `github_issue_*` fields stay unused in v1 but remain in schema to avoid a later destructive migration.

### Storage Bucket: `desktop-diagnostics`

Requirements:

- bucket is private
- no public URLs
- objects are readable only through server-authenticated admin routes

## Upload API Contract

### `POST /api/desktop/diagnostics/upload`

Purpose:

- accept diagnostics from desktop clients
- validate and redact the payload
- persist raw and structured diagnostics
- return a stable `reportId` for operator follow-up

Implementation requirements:

- route runtime: `nodejs`
- request body: JSON
- upload remains feature-flagged
- route accepts the canonical schema below and normalizes any legacy field names already emitted by the desktop build

Canonical payload shape:

```json
{
  "channel": "nova",
  "appVersion": "desktop-v200.0.0-beta.5",
  "desktopCommit": "abcdef1",
  "localServiceVersion": "local-service-nova-2026-06-18.1",
  "platform": "macos",
  "osName": "macOS",
  "osVersion": "15.5",
  "arch": "arm64",
  "profileSyncEnabled": true,
  "remoteSiteOrigin": "https://nova.example.com",
  "summary": "Local service failed to start",
  "findings": ["LaunchDaemon is missing", "Port 39000 is unavailable"],
  "recommendations": [
    "Reinstall local service",
    "Retry after freeing the port"
  ],
  "rawLogText": "... full text ...",
  "reportPayload": {
    "serviceStatus": "stopped",
    "logLines": 218
  }
}
```

Validation rules for v1:

- `summary` is required and must be 1 to 200 characters after trimming
- `platform` is required and must be 1 to 32 characters
- `findings` is optional and may contain up to 20 strings, each up to 200 characters
- `recommendations` is optional and may contain up to 20 strings, each up to 200 characters
- `rawLogText` is required and must not exceed 524288 UTF-8 bytes or 5000 lines after normalization
- `reportPayload` is optional and must serialize to no more than 65536 bytes
- non-object payloads are rejected

Required behavior:

- check `DESKTOP_DIAGNOSTICS_UPLOAD_ENABLED`
- fail fast on missing Supabase configuration
- normalize line endings and trim obviously empty top and bottom padding
- redact obvious secrets before writing either the Storage object or the Postgres row
- store only the origin portion of `remoteSiteOrigin`
- compute `raw_log_sha256` from the redacted raw log text
- compute `error_fingerprint` on a best-effort basis
- write the Storage object first, then the Postgres row
- if the row write fails after object upload, attempt best-effort object deletion
- never write the raw unredacted payload to server logs

Success response shape:

```json
{
  "ok": true,
  "reportId": "7d6d0f4b-91e4-4fbb-9f37-6dd5a7dd5fef",
  "stored": true,
  "forwardedToGithub": false
}
```

Failure response shape:

```json
{
  "ok": false,
  "code": "disabled",
  "message": "Desktop diagnostics upload is disabled."
}
```

Expected error codes:

- `disabled`
- `invalid_payload`
- `server_misconfigured`
- `rate_limited`
- `storage_failed`

## Admin Contract

### Auth Model

- all diagnostics admin routes must reuse the existing admin authentication model
- only authenticated admins or owners can read or change diagnostics state
- no raw log access is allowed from public routes

### Admin APIs

#### `GET /api/admin/diagnostics`

Purpose:

- paginated report list for operators
- filter by `status`, `channel`, `platform`, and time range

Behavior:

- list response does not include the full raw log body
- list response may include `raw_log_excerpt`

#### `GET /api/admin/diagnostics/[id]`

Purpose:

- retrieve one metadata row
- retrieve findings, recommendations, notes, and redacted excerpt

#### `GET /api/admin/diagnostics/[id]/download`

Purpose:

- stream or download the redacted raw log text from private Storage

#### `POST /api/admin/diagnostics/[id]/status`

Purpose:

- update operator triage status
- optionally update `operator_notes`

Allowed status transitions in v1:

- `new -> triaged`
- `new -> ignored`
- `triaged -> resolved`
- `triaged -> ignored`
- `resolved -> triaged`
- `ignored -> triaged`

`forwarded` exists in schema for future use but is not used in v1.

### Admin UI Requirements

Initial admin capabilities must include:

- report list with status filters
- detail view for one report
- raw log download button
- status update actions
- copyable `reportId`

Initial admin UI must not include:

- a public share link
- a GitHub forwarding button

## Required Environment Variables

Set these on the web deployment that should receive diagnostics uploads:

- `DESKTOP_DIAGNOSTICS_UPLOAD_ENABLED=true`
- `DESKTOP_DIAGNOSTICS_SUPABASE_URL=<project-url>`
- `DESKTOP_DIAGNOSTICS_SUPABASE_SERVICE_ROLE_KEY=<service-role-key>`
- `DESKTOP_DIAGNOSTICS_SUPABASE_BUCKET=desktop-diagnostics`

Behavior rules:

- if `DESKTOP_DIAGNOSTICS_UPLOAD_ENABLED` is missing or false, the route returns `disabled`
- if Supabase URL, service-role key, or bucket name is missing, the route returns `server_misconfigured`
- if `profile_sync.api_base_url` is missing in desktop config, desktop falls back to local export only
- do not set any `DESKTOP_DIAGNOSTICS_GITHUB_*` variables in `nova` or `luna` during the initial rollout

## Security Requirements

These are mandatory for v1:

- never place Supabase service-role keys in desktop clients
- keep the Storage bucket private
- do not expose raw log objects through public URLs
- route all operator reads through authenticated server routes
- redact secrets before writing either rows or objects
- bound payload size and line count on upload
- avoid logging raw payload contents in application logs
- add rate limiting or platform-level abuse protection before enabling the route on `luna`

Required redaction targets:

- bearer tokens
- API keys
- cookies
- passwords
- local absolute paths if they contain usernames
- full query strings or embedded credentials in URLs

## Retention and Operations

Retention defaults:

- keep metadata rows for 180 days
- keep raw log objects for 30 days
- if a report becomes incident evidence, preserve it manually outside the v1 flow before the retention window ends

Manual operations until cleanup automation exists:

1. delete expired raw log objects at least once per month
2. delete expired metadata rows at least once per month
3. spot-check fresh reports for redaction failures
4. keep GitHub forwarding disabled

Recommended operator workflow:

1. review new reports in admin UI
2. mark low-signal reports as `ignored`
3. mark actionable reports as `triaged`
4. mark fixed reports as `resolved`
5. use `raw_log_sha256` and `error_fingerprint` for manual duplicate detection when needed

## File-Level Rollout Targets

The v1 web rollout should touch at minimum:

- `package.json`
- `pnpm-lock.yaml`
- `src/app/api/desktop/diagnostics/upload/route.ts`
- `src/app/api/desktop/diagnostics/upload/route.test.ts`
- `src/app/api/admin/diagnostics/route.ts`
- `src/app/api/admin/diagnostics/[id]/route.ts`
- `src/app/api/admin/diagnostics/[id]/download/route.ts`
- `src/app/api/admin/diagnostics/[id]/status/route.ts`
- `src/lib/desktop-diagnostics/`
- `src/app/admin/page.tsx`
- `README.md`
- `docs/desktop-diagnostics-upload-rollout-plan.md`

Not part of v1:

- `src/app/api/admin/diagnostics/[id]/forward/route.ts`

## Execution Plan

### Phase 0: Freeze the Desktop Contract and Provision `nova`

1. Capture one real diagnostics sample from the current desktop build or desktop branch.
2. Freeze the request and response contract.
3. If the desktop payload uses older field names, document the server-side normalization map.
4. Add the Supabase client dependency.
5. Create the `nova` Supabase project.
6. Create the private `desktop-diagnostics` bucket.
7. Apply the `desktop_diagnostics_reports` schema and indexes.
8. Add required `DESKTOP_DIAGNOSTICS_*` environment variables to the `nova` deployment.

Exit criteria:

- one real desktop sample exists for implementation and tests
- the upload contract is frozen
- the `nova` Supabase project exists
- the bucket exists and is private
- the schema is applied
- secrets are available to the web deployment only

### Phase 1: Implement Storage Ingestion on `nova`

1. Add a server-only Supabase client helper.
2. Add config parsing for diagnostics storage.
3. Add payload normalization, redaction, hashing, and object-path helpers.
4. Add `POST /api/desktop/diagnostics/upload`.
5. Add route tests for:
   - upload disabled
   - missing Supabase config
   - invalid payload
   - successful storage write
   - best-effort cleanup after row-write failure
6. Deploy to `nova`.
7. Turn on `DESKTOP_DIAGNOSTICS_UPLOAD_ENABLED` only after the deployment is live.

Validation at this phase:

- `POST /api/desktop/diagnostics/upload` returns structured JSON
- a successful upload writes one Postgres row and one Storage object
- invalid or oversized payloads are rejected
- failures never expose secrets in the response body

Exit criteria:

- `nova` serves the upload route
- storage writes succeed end to end
- failure paths are explicit and safe

### Phase 2: Implement Operator Triage on `nova`

1. Add `GET /api/admin/diagnostics`.
2. Add `GET /api/admin/diagnostics/[id]`.
3. Add `GET /api/admin/diagnostics/[id]/download`.
4. Add `POST /api/admin/diagnostics/[id]/status`.
5. Add a diagnostics section to the existing admin page.
6. Ensure list responses do not include the raw log body.
7. Add auth and authorization tests for the admin routes.
8. Deploy to `nova`.

Validation at this phase:

- operators can list reports
- operators can open one report
- operators can download the raw redacted log
- operators can update status and notes
- unauthenticated or unauthorized callers cannot access diagnostics routes

Exit criteria:

- `nova` operators can triage reports without using the Supabase dashboard

### Phase 3: Validate End to End with the Existing Desktop Build

1. Point `profile_sync.api_base_url` at the `nova` site URL.
2. Force the local service into a failure state.
3. Open desktop settings.
4. Click `错误排查`.
5. Click `导出排查日志`.
6. Confirm local export still succeeds.
7. Confirm remote upload behavior matches the route configuration.

Mandatory test cases:

1. `profile_sync.api_base_url` is empty
   Expected: local export only, no upload attempt.
2. Upload route is disabled
   Expected: local export succeeds, remote upload is skipped with an explicit message.
3. Supabase config is missing
   Expected: local export succeeds, server returns `server_misconfigured`.
4. All configuration is correct
   Expected: local export succeeds and one report is stored.
5. Oversized payload
   Expected: route returns `invalid_payload`.

Exit criteria:

- all five test cases are exercised
- successful upload returns a stable `reportId`
- the report is visible in admin UI
- the raw log object is accessible only through the admin download route

### Phase 4: Promote the Web Path to `luna`

1. Create a separate `luna` Supabase project.
2. Create the same private bucket in `luna`.
3. Apply the same schema and indexes in `luna`.
4. Bring the same code from `nova` into `luna`.
5. Apply the required `DESKTOP_DIAGNOSTICS_*` environment variables to the `luna` deployment.
6. Add rate limiting or equivalent platform-level abuse protection.
7. Deploy `luna`.
8. Run at least one successful end-to-end upload and one admin triage pass against `luna`.
9. Keep all `DESKTOP_DIAGNOSTICS_GITHUB_*` variables unset.

Exit criteria:

- `luna` serves the same storage behavior as `nova`
- `luna` operators can triage reports
- production diagnostics upload does not depend on the `nova` Supabase project
- production upload is not enabled without abuse protection

### Phase 5: Desktop Release Gate

1. Confirm the desktop build that will be distributed to users points at the intended web base URL when remote upload is enabled.
2. If the current desktop build only supports local export and not remote POST, add that thin integration without redesigning the diagnostics UI or log format.
3. Re-run one successful `luna` end-to-end diagnostics flow before release.

Exit criteria:

- the desktop build keeps local export
- the desktop build uses the intended web environment for best-effort upload
- users do not receive a build that points at the wrong environment

## Validation Checklist

Use this checklist before marking the rollout complete:

- `nova` upload route deployed
- `nova` admin triage flow deployed
- `luna` upload route deployed
- `luna` admin triage flow deployed
- separate Supabase projects provisioned for `nova` and `luna`
- schema applied in both environments
- private Storage bucket created in both environments
- `DESKTOP_DIAGNOSTICS_UPLOAD_ENABLED=true` set only where intended
- Supabase service-role key configured on the server only
- local export works
- upload-disabled path works
- missing-Supabase-config path works
- oversized payload path works
- successful upload stores one row and one raw log object
- admin review and download path works
- no raw diagnostics are exposed in public URLs or server logs
- no GitHub forwarding variables are set in the initial rollout

## Rollback Plan

Preferred rollback order:

1. turn off `DESKTOP_DIAGNOSTICS_UPLOAD_ENABLED`
2. if needed, remove `DESKTOP_DIAGNOSTICS_SUPABASE_SERVICE_ROLE_KEY`
3. hide diagnostics admin entry points if the admin surface is causing issues
4. revert the diagnostics web routes from `nova` or `luna`
5. only change the desktop build if it points at the wrong environment or its upload behavior is broken

Important rollback property:

- local `.txt` export remains available even if remote upload is disabled

## Deliverables

The rollout is complete when all of the following are true:

- `nova` has the web ingestion route and diagnostics admin flow deployed and validated
- `luna` has the same flow deployed and validated
- Supabase stores diagnostics metadata and raw log objects correctly in both environments
- operators can inspect, download, and triage reports without using the Supabase dashboard
- desktop users keep local export and gain best-effort remote storage when enabled
- operators can disable the ingestion path quickly
- GitHub is not part of the critical path

## Deferred Follow-Up

Do not include these in v1:

- GitHub forwarding endpoint and `DESKTOP_DIAGNOSTICS_GITHUB_*` variables
- `desktop_diagnostics_events`
- automated retention cleanup job
- deduplication or merge UI
- signed upload authentication between desktop and web
- stricter bot protection beyond the initial `luna` abuse controls
- desktop UI backlink to a forwarded GitHub issue
