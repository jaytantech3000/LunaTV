# Web Profile Merge Consistency (一致性) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` task by task. Steps use checkboxes for tracking.

**Goal:** Provide atomic (原子), per-user-revision commits, stable-read/CAS retry, and authoritative committed-snapshot responses for Web profile merges.

**Architecture:** The route performs authentication, validation, stable reads, pure merging, and retries. The storage layer uses one Lua script to compare revisions, replace selected domains, and increment the revision. Every ordinary profile mutation uses the same atomic storage helper so merge CAS can observe it.

**Tech Stack:** Next.js Route Handler, TypeScript, Jest, node-redis/Kvrocks, Upstash Redis, Lua EVAL.

## Global Constraints

- A profile revision is a decimal string; a missing value is `"0"`; never convert it to a JavaScript number.
- A success response must include the committed `mergedSnapshot`, `revision`, and existing `summary`.
- A CAS mismatch writes nothing; retry at most five times, then return `409`.
- Every ordinary profile write and revision increment must be one atomic backend operation.
- With `adminConfig`, the route accepts only allowed sync fields and must merge and validate them into a complete `AdminConfig` before atomic commit; cross-slot or atomic unavailability in any profile/admin mode returns `409`.
- Standalone Redis/Kvrocks may run multi-key Lua. Redis Cluster may run only when every EVAL key shares one slot; current keys have no Hash Tag, so `CROSSSLOT` must reject without double-write fallback.
- Do not modify desktop Rust; this plan changes only Web server protocol and storage implementation.

---

## File boundaries (文件边界)

- Create: `src/lib/profile-sync/merge-storage.ts` — route/storage-shared commit DTOs, revision constants, and result types.
- Modify: `src/lib/types.ts`, `src/lib/db.ts` — expose one storage contract and DbManager forwarding.
- Modify: `src/lib/redis-base.db.ts`, `src/lib/upstash.db.ts` — Lua commit and ordinary-mutation revision increment; `src/lib/kvrocks.db.ts` inherits BaseRedis.
- Modify: `src/app/api/admin/profile-sync/merge/route.ts` — stable reads, CAS retries, response, and error mapping.
- Modify/create tests: `src/app/api/admin/profile-sync/merge/route.test.ts`, `src/lib/profile-sync/merge-storage.test.ts`, `src/lib/redis-base.db.test.ts`, `src/lib/upstash.db.test.ts`.

### Task 1: Define the contract (契约) and DbManager forwarding

**Files:**

- Create: `src/lib/profile-sync/merge-storage.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/db.ts`
- Test: `src/lib/profile-sync/merge-storage.test.ts`

**Produces:** `ProfileSyncCommitRequest`, `ProfileSyncCommitResult`, `getProfileSyncRevision`, `getAdminSettingsRevision`, `commitProfileSyncMerge`, and same-name DbManager forwarding. DTOs use existing `DesktopProfileDomain` and `DesktopProfileSnapshot`; an admin-settings commit carries expected admin revision plus a complete, validated `AdminConfig`, never a partial sync snapshot.

- [ ] Write failing tests: DbManager forwards revision reads and commits unchanged; a commit conflict is `null`.
- [ ] Run: `npm test -- src/lib/profile-sync/merge-storage.test.ts`; expected failure: missing interfaces and methods.
- [ ] Create DTOs and add to `IStorage`:

```ts
getProfileSyncRevision(userName: string): Promise<string>;
getAdminSettingsRevision(): Promise<string>;
commitProfileSyncMerge(request: ProfileSyncCommitRequest): Promise<ProfileSyncCommitResult | null>;
```

- [ ] Add no-conversion forwarding in `DbManager`; do not add new paths that probe admin configuration through `any`.
- [ ] Re-run the test; expected pass.
- [ ] Commit: `git add src/lib/{types,db}.ts src/lib/profile-sync/merge-storage* && git commit -m "feat(web): define profile merge commit contract"`.

### Task 2: Implement atomic Redis/Kvrocks profile revisions and commits

**Files:**

- Modify: `src/lib/redis-base.db.ts`
- Test: `src/lib/redis-base.db.test.ts`

**Produces:** BaseRedis `EVAL` script and ordinary-mutation helper. Kvrocks has no separate writes because it inherits this implementation.

- [ ] Write failing tests: an expected profile or admin-settings revision mismatch returns `null` and invokes no replacement commands; a success invokes one `eval` and returns a string revision.
- [ ] Write failing tests: every actual play/favorite/follow/skip mutation and search-history mutation increments once; explicitly assert no-op delete semantics.
- [ ] Run: `npm test -- src/lib/redis-base.db.test.ts`; expected failure.
- [ ] Implement `profileRevisionKey(userName)` and shared `runProfileMutation`; Lua performs the profile command and `INCR` in one script.
- [ ] Implement commit Lua: compare `GET revision or "0"`; process only selected Hash/List domains; on success `INCR` and return it. The script must not call route-layer `splitCompositeKey`.
- [ ] Add second expected version, `admin:config-revision`, and same-script write of complete `AdminConfig`; every ordinary `setAdminConfig` also increments admin revision in one Lua call. Any profile or admin-settings `CROSSSLOT` throws recognizable `PROFILE_SYNC_CROSS_SLOT_ATOMIC_COMMIT_UNAVAILABLE`, writes no key, and never falls back to double writes.
- [ ] Re-run tests; expected pass.
- [ ] Commit: `git add src/lib/redis-base.db.ts src/lib/redis-base.db.test.ts && git commit -m "feat(web): atomically commit redis profile merges"`.

### Task 3: Implement the equivalent Upstash contract (等价契约)

**Files:**

- Modify: `src/lib/upstash.db.ts`
- Test: `src/lib/upstash.db.test.ts`

**Produces:** The same keys, Lua argument order, conflict meaning, and mutation-revision semantics as Task 2, adapted only to Upstash `eval(script, keys, args)`.

- [ ] Write failing tests: for one request, Upstash `eval` receives the same key/value set and string revision as BaseRedis; conflict is `null`.
- [ ] Write failing tests: every ordinary mutation uses `eval`; retain no independent `hset/del/lpush` plus second-step version increment.
- [ ] Run: `npm test -- src/lib/upstash.db.test.ts`; expected failure.
- [ ] Reuse shared script text or byte-for-byte equivalent script and implement `getProfileSyncRevision` plus `commitProfileSyncMerge`.
- [ ] Re-run tests; expected pass.
- [ ] Commit: `git add src/lib/upstash.db.ts src/lib/upstash.db.test.ts && git commit -m "feat(web): atomically commit upstash profile merges"`.

### Task 4: Convert the merge route to stable reads and CAS retries

**Files:**

- Modify: `src/app/api/admin/profile-sync/merge/route.ts`
- Modify: `src/app/api/admin/profile-sync/merge/route.test.ts`

**Consumes:** Task 1 `db.getProfileSyncRevision` and `db.commitProfileSyncMerge`.

- [ ] Write failing tests: success contains string `revision` and full `mergedSnapshot`; unselected domains are empty; `requestId` and `protocolVersion` remain echoed.
- [ ] Write failing tests: first CAS `null` causes re-read, re-merge, and second success; five conflicts return `409` without a successful snapshot.
- [ ] Write failing tests: differing profile or admin-settings stable-read versions do not commit; cross-slot atomic unavailability in every merge mode returns `409`; cache changes only after commit success.
- [ ] Run: `npm test -- src/app/api/admin/profile-sync/merge/route.test.ts`; expected failure.
- [ ] Remove the route path that calls `replacePlayRecords`, `replaceFavorites`, `replaceFollows`, `replaceSearchHistory`, and `replaceSkipConfigs`. Implement fixed five-attempt loop: read A, read remote, read B, compare, pure merge, CAS, short random backoff.
- [ ] Map backend errors to `503`; retain `400/401/404`; map exhausted CAS/stable-read retries and `PROFILE_SYNC_CROSS_SLOT_ATOMIC_COMMIT_UNAVAILABLE` to `409`. The route accepts allowed sync fields only, merges them into complete `AdminConfig`, then submits it. After success, call `setCachedConfig`; on failure invalidate or reload cache and return `503`, without a second commit.
- [ ] Re-run tests; expected pass.
- [ ] Commit: `git add src/app/api/admin/profile-sync/merge/route.ts src/app/api/admin/profile-sync/merge/route.test.ts && git commit -m "feat(web): return committed profile merge snapshots"`.

### Task 5: Concurrency regression (并发回归) and full verification

**Files:**

- Modify: only the test files above; do not change production interfaces.

- [ ] Add a route race test: after the first remote snapshot, simulate an ordinary web write that changes revision; prove the old merge cannot overwrite it; retry returns an authoritative snapshot containing both sides.
- [ ] Add a dual-merge test: two requests begin at one revision; one succeeds, one re-reads and retries; successful responses have distinct revisions and each matches its actual commit.
- [ ] Add a Lua-failure test: a script error never calls `setCachedConfig` and returns `503`.
- [ ] Run: `npm test -- src/lib/profile-sync/desktop-merge.test.ts src/lib/profile-sync/merge-storage.test.ts src/lib/redis-base.db.test.ts src/lib/upstash.db.test.ts src/app/api/admin/profile-sync/merge/route.test.ts`; expected all pass.
- [ ] Run: `npm run lint` and `npm run build`; expected exit code `0`.
- [ ] Commit: `git add src && git commit -m "test(web): cover concurrent profile merge commits"`.

## Independent write scopes (独立写入范围)

1. Agent A: Task 1 only — `merge-storage.ts`, `types.ts`, `db.ts`, and contract tests.
2. Agent B: Task 2 only — `redis-base.db.ts` and its tests (including inherited Kvrocks verification).
3. Agent C: Task 3 only — `upstash.db.ts` and its tests.
4. Agent D: Tasks 4 and 5 — route file and route tests, after Agent A's contract lands.

The lead agent verifies DTO signatures, complete-admin-config merge, Lua hash-slot assumptions, global admin-revision semantics, and final full verification.
