# Desktop Account Sync Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual desktop sync enablement with a guided onboarding flow in `desktop-admin`, while preserving offline downloads during the switch to Web accounts.

**Architecture:** The desktop frontend continues to go through the local Rust service. The Web app gains a profile merge endpoint; the local service gains preview/execute orchestration endpoints; the frontend gains a wizard and a safe download-owner cutover path.

**Tech Stack:** Next.js App Router, TypeScript, Jest, Rust, Axum, reqwest, Tauri IPC

## Global Constraints

- Default production URL is `https://luna.hkcu.qzz.io`
- The onboarding entry lives only in `desktop-admin`
- Current local account maps to the current logged-in Web account
- Other local accounts map to same-name Web accounts; missing ones are auto-created with password `123456`
- Migrated domains are play records, favorites, follows, search history, and skip configs
- Only the current surviving offline download set is rebound; files are not deleted
- Every behavior change follows red-green first

---

### Task 1: Web Profile Merge Core

**Files:**

- Create: `src/lib/profile-sync/desktop-merge.ts`
- Create: `src/lib/profile-sync/desktop-merge.test.ts`
- Create: `src/app/api/admin/profile-sync/merge/route.ts`

**Interfaces:**

- Produces: `mergeDesktopProfileSnapshot(remoteSnapshot, localSnapshot, strategy)`
- Produces: `POST /api/admin/profile-sync/merge`

- [ ] Write failing tests for keyed domain merges and search history ordering
- [ ] Run Jest and confirm expected failure
- [ ] Implement the minimum merge helpers
- [ ] Re-run Jest and confirm green
- [ ] Implement route auth, target-user validation, and merged write-back
- [ ] Re-run the relevant tests

### Task 2: Local Service Onboarding Orchestration

**Files:**

- Create: `crates/moontv-local-service/src/profile_sync_onboarding.rs`
- Modify: `crates/moontv-local-service/src/lib.rs`
- Modify: `crates/moontv-local-service/src/profile_sync.rs`
- Modify: `crates/moontv-sync/src/lib.rs` (only if shared helpers are needed)

**Interfaces:**

- Produces: `POST /api/admin/profile-sync/onboarding/preview`
- Produces: `POST /api/admin/profile-sync/onboarding/execute`

- [ ] Write failing tests for account mapping, config mutation, and download rebinding helpers
- [ ] Run targeted `cargo test` commands and confirm failure
- [ ] Implement the helper layer and request/response models
- [ ] Implement remote login, remote admin-config read, and missing-user auto-create
- [ ] Implement per-account migration and local config write-back
- [ ] Re-run the targeted Rust tests and confirm green

### Task 3: Safe Desktop Offline Download Cutover

**Files:**

- Modify: `src/lib/download/session.ts`
- Modify: `src/lib/download/session.test.ts`
- Modify: `src/components/DesktopDownloadStoreSync.tsx`
- Modify: `src/components/DesktopDownloadStoreSync.test.tsx`

**Interfaces:**

- Produces: `armDesktopDownloadOwnershipHandoff(...)`
- Produces: owner change during sync cutover does not purge offline downloads

- [ ] Write failing tests for handoff and ownership rebinding
- [ ] Run Jest and confirm failure
- [ ] Implement the browser-side safe owner rebinding
- [ ] Implement runtime-refresh rehydration from the desktop snapshot
- [ ] Re-run the relevant Jest tests and confirm green

### Task 4: `desktop-admin` Wizard

**Files:**

- Create: `src/components/DesktopProfileSyncOnboardingCard.tsx`
- Create: `src/components/DesktopProfileSyncOnboardingCard.test.tsx`
- Modify: `src/app/desktop-admin/page.tsx`
- Modify: `src/components/DesktopSettingsSection.tsx`

**Interfaces:**

- Produces: visible onboarding flow
- Consumes: local-service preview/execute endpoints

- [ ] Write failing tests for default URL, preview, completion notice, and initial-password notice
- [ ] Run Jest and confirm failure
- [ ] Implement the sync card and wizard
- [ ] Wire it into `desktop-admin`
- [ ] Update old copy so JSON editing is no longer the main sync path
- [ ] Re-run the relevant Jest tests and confirm green

### Task 5: Verification

**Files:**

- No code changes expected

**Interfaces:**

- Verifies: Web helper/route, local service, download-owner cutover, and `desktop-admin` UI

- [ ] Run targeted Jest tests
- [ ] Run targeted Rust tests
- [ ] Run `pnpm typecheck`
- [ ] Recheck the requirement list: default URL, auto-created users, password `123456` notice, and no offline download purge
