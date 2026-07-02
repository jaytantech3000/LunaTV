# Account Sync Minimal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `/account-sync` into a compact two-card desktop sync page with a dedicated sync-scope card, plus add the `adminsettings` domain and manual sync flow.

**Architecture:** First extend the backend profile-sync config and manual sync API, then add frontend scope management and a compact action card, and finally refactor the page layout and state feedback. The existing onboarding modal stays in place; the main page becomes a thin action surface.

**Tech Stack:** Next.js App Router, React, TypeScript, Jest, Rust, Axum, Tauri local service

## Global Constraints

- Must follow the approved spec exactly: remove helper copy, remove diagnostics, render a two-card top row, and add a sync-scope card.
- Default sync domains remain `playrecords` `favorites` `follows` `searchhistory` `skipconfigs`, with new `adminsettings`.
- Disabled state must continue to reuse the existing onboarding flow instead of keeping the large inline form.
- Touch only files relevant to this feature and do not revert unrelated dirty worktree changes.
- Every behavior change must follow TDD: failing test first, then minimal implementation.

---

### Task 1: Extend profile-sync domain models and add the manual sync API

**Files:**

- Modify: `crates/moontv-sync/src/lib.rs`
- Modify: `crates/moontv-local-service/src/lib.rs`
- Modify: `crates/moontv-local-service/src/profile_sync_onboarding.rs`
- Modify: `src/lib/profile/contracts.ts`
- Modify: `src/lib/desktop/profile-sync.ts`
- Test: `src/lib/desktop/profile-sync.test.ts`

**Interfaces:**

- Consumes: `PROFILE_SYNC_USER_DATA_DOMAINS`, `ProfileSyncStatusResponse`, `build_profile_sync_target_url`, `send_remote_json_request`
- Produces:

  - `PROFILE_SYNC_USER_DATA_DOMAINS` extended with `adminsettings`
  - `type ProfileSyncUserDataDomain = ... | 'adminsettings'`
  - `interface DesktopProfileSyncManualSyncRequest { syncDomains: readonly string[] }`
  - `interface DesktopProfileSyncManualSyncResponse extends DesktopProfileSyncStatus { lastSyncError?: string | null }`
  - `async function syncDesktopProfileNow(payload: DesktopProfileSyncManualSyncRequest): Promise<DesktopProfileSyncManualSyncResponse>`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Write the minimal implementation**
- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec jest src/lib/desktop/profile-sync.test.ts --runInBand
cargo test -p moontv-local-service profile_sync_ -- --nocapture
```

### Task 2: Build the sync-scope card and compact action card

**Files:**

- Create: `src/components/DesktopProfileSyncScopeCard.tsx`
- Create: `src/components/DesktopProfileSyncScopeCard.test.tsx`
- Modify: `src/components/DesktopProfileSyncOnboardingCard.tsx`
- Modify: `src/components/DesktopProfileSyncOnboardingCard.test.tsx`
- Modify: `src/lib/desktop/profile-sync-status-copy.ts`

**Interfaces:**

- Consumes: `ProfileSyncUserDataDomain`, `syncDesktopProfileNow`, `DesktopProfileSyncStatus`
- Produces:

  - `interface DesktopProfileSyncScopeCardProps { selectedDomains: readonly string[]; isAdminRole: boolean; disabled?: boolean; onChange: (nextDomains: string[]) => void }`
  - `DesktopProfileSyncOnboardingCard` new props:
    - `selectedSyncDomains?: readonly string[]`
    - `isAdminRole?: boolean`
    - `onSyncSuccess?: (nextStatus: DesktopProfileSyncManualSyncResponse) => void`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Write the minimal implementation**
- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec jest src/components/DesktopProfileSyncScopeCard.test.tsx src/components/DesktopProfileSyncOnboardingCard.test.tsx --runInBand
```

### Task 3: Refactor `/account-sync` layout and page-level state

**Files:**

- Modify: `src/app/account-sync/page.tsx`
- Modify: `src/app/account-sync/page.test.tsx`
- Modify: `src/lib/desktop/profile-sync-status-copy.ts`
- Modify: `src/lib/desktop/profile-sync-status-copy.test.ts`

**Interfaces:**

- Consumes: `DesktopProfileSyncScopeCard`, `DesktopProfileSyncOnboardingCard`, `syncDesktopProfileNow`
- Produces:

  - page-level scope state
  - page-level sync success/error feedback
  - the new no-diagnostics layout

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Write the minimal implementation**
- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec jest src/app/account-sync/page.test.tsx src/lib/desktop/profile-sync-status-copy.test.ts --runInBand
```

### Task 4: Verify everything and launch the desktop shell

**Files:**

- Verify only

**Interfaces:**

- Consumes: Tasks 1-3 outputs
- Produces: a verified desktop shell for manual review

- [ ] **Step 1: Run focused test suites**
- [ ] **Step 2: Run static verification**
- [ ] **Step 3: Launch the desktop shell**

Run:

```bash
pnpm exec jest src/lib/desktop/profile-sync.test.ts src/components/DesktopProfileSyncScopeCard.test.tsx src/components/DesktopProfileSyncOnboardingCard.test.tsx src/app/account-sync/page.test.tsx src/lib/desktop/profile-sync-status-copy.test.ts --runInBand
cargo test -p moontv-local-service profile_sync_ -- --nocapture
pnpm exec eslint src/app/account-sync/page.tsx src/app/account-sync/page.test.tsx src/components/DesktopProfileSyncScopeCard.tsx src/components/DesktopProfileSyncScopeCard.test.tsx src/components/DesktopProfileSyncOnboardingCard.tsx src/components/DesktopProfileSyncOnboardingCard.test.tsx src/lib/desktop/profile-sync.ts src/lib/desktop/profile-sync.test.ts src/lib/desktop/profile-sync-status-copy.ts src/lib/desktop/profile-sync-status-copy.test.ts
pnpm exec tsc --noEmit --incremental false --pretty false
pnpm desktop:dev
```
