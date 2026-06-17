# Desktop Diagnostics Upload Rollout Plan

## Document Metadata

- Date: 2026-06-17
- Branch: `nova`
- Related desktop implementation: `desktop` branch commit `2deac36`
- Status: Draft for execution

## Objective

Deliver a full diagnostics upload chain for desktop users:

1. Desktop user clicks `错误排查`.
2. Desktop user clicks `导出排查日志`.
3. The desktop app always exports a local `.txt` diagnostics log.
4. If `profile_sync.api_base_url` is configured, the desktop app also POSTs the diagnostics payload to the web site.
5. The web site relays the report to GitHub Issues using a server-side token.

The target outcome is that ordinary users do not need to run shell commands to provide useful failure reports.

## Scope

Included:

- Desktop diagnostics UI and export flow
- Desktop-to-web diagnostics upload
- Web API relay
- GitHub issue creation
- Deployment, validation, rollback, and operations notes

Excluded:

- Storing diagnostics in the web site's own database
- Direct GitHub writes from the desktop client
- Advanced abuse prevention beyond an opt-in server-side switch

## Current Implementation Status

The desktop implementation already exists on the `desktop` branch in commit `2deac36` and covers:

- desktop diagnostics modal and export UX
- desktop Tauri IPC for diagnostics upload
- web API route at `src/app/api/desktop/diagnostics/upload/route.ts`
- server-side GitHub issue relay
- README environment-variable documentation

This document describes how to roll that implementation into `nova`, validate it, then promote it to `luna`.

## Architecture

```
Desktop app
  -> local export (.txt)
  -> POST {report} to profile_sync.api_base_url/api/desktop/diagnostics/upload
  -> web server validates request
  -> web server creates GitHub issue using server-side token
  -> desktop app shows upload result to the user
```

## Why This Design

- GitHub credentials must not be stored in the desktop client.
- Using the Tauri backend avoids browser-side CORS complexity.
- The server-side upload path can be disabled by configuration without changing the desktop app.
- If remote upload is unavailable, the local export still works.

## Branch Strategy

Use the repository's existing branch roles:

- `desktop`
  Holds the desktop implementation and release work.
- `nova`
  First web verification branch.
- `luna`
  Production web branch after `nova` validation.

Recommended promotion order:

1. Keep the full implementation on `desktop`.
2. Sync the web-side diagnostics relay changes into `nova`.
3. Validate end-to-end against the `nova` site.
4. Sync the same web-side changes into `luna`.
5. Publish the desktop build that points users to the intended web environment.

## Required Inputs

Before execution, confirm the following:

- GitHub repository for receiving diagnostics issues
- GitHub Issues enabled in that repository
- A server-side token with permission to create issues in that repository
- A deployed `nova` site
- A deployed `luna` site
- A desktop build or release that contains desktop commit `2deac36`
- A test machine where the local service can be forced into a failure state

## Required Environment Variables

Set these on the web deployment that should receive diagnostics uploads:

- `DESKTOP_DIAGNOSTICS_UPLOAD_ENABLED=true`
- `DESKTOP_DIAGNOSTICS_GITHUB_TOKEN=<token-with-issue-write-access>`
- `DESKTOP_DIAGNOSTICS_GITHUB_REPOSITORY=<owner/repo>`
- `DESKTOP_DIAGNOSTICS_GITHUB_LABELS=desktop-diagnostics,bug` (optional)

Behavior rules:

- If `DESKTOP_DIAGNOSTICS_UPLOAD_ENABLED` is missing or false, upload remains disabled.
- If the GitHub token or repository is missing, the endpoint returns a controlled failure message.
- If the desktop config omits `profile_sync.api_base_url`, the desktop app skips remote upload and only exports locally.

## File-Level Rollout Targets

For `nova` and `luna`, the web-side rollout should include at minimum:

- `src/app/api/desktop/diagnostics/upload/route.ts`
- `README.md`
- `docs/desktop-diagnostics-upload-rollout-plan.md`

Desktop-side files remain primarily part of the `desktop` branch:

- `src/components/DesktopSettingsSection.tsx`
- `src/lib/desktop/tauri-client.ts`
- `src-tauri/src/lib.rs`

## Execution Plan

### Phase 0: Preparation

1. Confirm the GitHub target repository and labels.
2. Confirm the deployment platform for `nova` and `luna`.
3. Confirm where environment variables are managed.
4. Confirm whether `nova` and `luna` auto-deploy on push or require a manual deploy.
5. Confirm that a desktop package containing commit `2deac36` is available for testing.

Exit criteria:

- All external dependencies are known.
- The target repository and token owner are approved.

### Phase 1: Land the Web Relay in `nova`

1. Bring the web relay files into `nova`.
2. Push `nova`.
3. Add the required environment variables to the `nova` deployment.
4. Deploy `nova`.

Validation at this phase:

- `POST /api/desktop/diagnostics/upload` returns a structured JSON response.
- Disabled configuration returns a safe, explicit message.
- Enabled configuration can create a GitHub issue.

Exit criteria:

- `nova` is serving the diagnostics upload route.
- Server-side GitHub issue creation works.

### Phase 2: Validate End-to-End with a Desktop Build

1. Install a desktop build that contains commit `2deac36`.
2. Set `profile_sync.api_base_url` to the `nova` site URL.
3. Force the local service into a failure state.
4. Open desktop settings.
5. Click `错误排查`.
6. Click `导出排查日志`.

Expected results:

- A local `.txt` file is downloaded.
- The desktop modal shows either upload success or an explicit remote failure reason.
- A GitHub issue is created when the relay is enabled and configured.

Mandatory test cases:

1. `profile_sync.api_base_url` is empty
   Expected: local export only, no upload attempt.
2. Upload route is disabled
   Expected: local export succeeds, upload skipped with message.
3. GitHub token or repo is missing
   Expected: local export succeeds, server returns configuration error.
4. All configuration is correct
   Expected: local export succeeds and GitHub issue is created.

Exit criteria:

- All four test cases are exercised.
- The GitHub issue body includes summary, findings, recommendations, and raw log text.

### Phase 3: Promote the Web Relay to `luna`

1. Bring the same web relay files from `nova` into `luna`.
2. Push `luna`.
3. Apply the same environment variables to the `luna` deployment.
4. Deploy `luna`.
5. Repeat at least one successful end-to-end upload test against `luna`.

Exit criteria:

- `luna` serves the same relay behavior as `nova`.
- Production GitHub issue creation is verified once.

### Phase 4: Desktop Release

1. Build a desktop package from `desktop` with commit `2deac36` or later.
2. Publish an internal test build first.
3. Re-run the end-to-end diagnostics flow with the release candidate.
4. Publish the production desktop build after `luna` is ready.

Release guidance:

- Internal verification can use the existing desktop internal build workflow.
- Public release should follow the existing desktop release workflow and signing requirements.

Exit criteria:

- The published desktop build contains the diagnostics UX and upload logic.
- The target web environment is already live before users receive the build.

## Validation Checklist

Use this checklist before marking the rollout complete:

- `nova` route deployed
- `luna` route deployed
- `DESKTOP_DIAGNOSTICS_UPLOAD_ENABLED=true` set in target environment
- GitHub token configured on the server only
- GitHub repository configured correctly
- Desktop build contains commit `2deac36` or later
- Local export works
- Upload-disabled path works
- Missing-config path works
- Successful upload creates a GitHub issue
- The desktop modal shows a useful status message
- No GitHub credentials exist in desktop config or desktop binaries

## Rollback Plan

Preferred rollback order:

1. Turn off `DESKTOP_DIAGNOSTICS_UPLOAD_ENABLED`
2. If needed, remove `DESKTOP_DIAGNOSTICS_GITHUB_TOKEN`
3. If needed, revert the web route from `nova` or `luna`
4. Only roll back the desktop build if the UI behavior itself is broken

Important rollback property:

- The desktop app still supports local diagnostics export even when remote upload is disabled.

## Security Notes

- Never place GitHub PATs or write tokens inside the desktop client.
- Keep upload disabled by default and enable it only on controlled deployments.
- The server route should remain `nodejs` runtime because it depends on server-side GitHub API access.
- Issue bodies should stay bounded in size; the current implementation truncates long log text.
- If abuse becomes a problem, add rate limiting or server-side authentication as a follow-up task.

## Operational Notes

- The desktop app reads the remote base URL from `profile_sync.api_base_url`.
- The upload route is intended to be best-effort.
- Failure to upload must not block local export.
- Support staff should always ask users to attach the local `.txt` export when remote upload fails.

## Deliverables

The rollout is complete when all of the following are true:

- `nova` has the web relay route deployed and validated
- `luna` has the web relay route deployed and validated
- a desktop package containing commit `2deac36` or later is released
- GitHub issues are created successfully from desktop diagnostics uploads
- operators know how to disable the relay quickly

## Follow-Up Work

Consider these as later improvements, not part of the initial rollout:

- persist diagnostics reports in the site's own storage
- add rate limiting or signed upload authentication
- add a desktop UI link to copy the GitHub issue URL
- add an operator-only dashboard for uploaded diagnostics
