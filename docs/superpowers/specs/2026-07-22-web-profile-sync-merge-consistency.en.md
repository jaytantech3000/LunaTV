# Web Profile Merge Consistency (一致性) Specification

## Goal

Change `POST /api/admin/profile-sync/merge` from read-then-many-writes to a revision-controlled, atomic (原子) commit. A successful response must describe the final persisted state and must not overwrite concurrent web writes or another desktop merge.

## Confirmed current state

- The `luna` route reads five profile domains, then deletes and writes them one by one, and returns only `summary`.
- The current desktop branch adds `domains`, `requestId`, and an admin-settings snapshot, but still writes through independent storage commands.
- `BaseRedisStorage`, `KvrocksStorage`, and `UpstashRedisStorage` have independent ordinary profile writes; there is no revision, compare-and-swap (CAS, 比较并交换), or transactional (事务) commit.

Consequently, concurrent writes can be lost between reading and replacement, and a backend failure can leave partially updated domains.

## Data and revision model

- Add one Redis string key per user: `u:${username}:profile-sync-revision`; a missing key means string `"0"`.
- Pass revisions only as decimal strings between TypeScript, HTTP JSON, and Rust. Never convert them to JavaScript `number`.
- Every successful ordinary profile mutation (变更) or profile merge increments this user's revision once in the same atomic script.
- `revision` covers the user's five profile domains as a whole, not one revision per domain.
- `mergedSnapshot` always has the full `DesktopProfileSnapshot` shape. Unselected domains are `{}` or `[]`, matching `mergeDesktopProfileSnapshot`.

## Atomic commit contract (原子提交契约)

Add this server contract to `IStorage` and `DbManager`; place concrete DTOs in route-independent `src/lib/profile-sync/merge-storage.ts`:

```ts
interface ProfileSyncCommitRequest {
  username: string;
  expectedRevision: string;
  domains: readonly DesktopProfileDomain[];
  mergedSnapshot: DesktopProfileSnapshot;
  adminSettings?: ProfileSyncAdminSettingsCommit;
}

interface ProfileSyncCommitResult {
  revision: string;
}

getProfileSyncRevision(username: string): Promise<string>;
getAdminSettingsRevision(): Promise<string>;
commitProfileSyncMerge(
  request: ProfileSyncCommitRequest
): Promise<ProfileSyncCommitResult | null>;
```

`ProfileSyncAdminSettingsCommit` must carry `expectedRevision: string` and a complete, validated `config: AdminConfig`. The route accepts only allowed admin-setting fields from the request, merges them into the current complete config, runs `configSelfCheck`, and then passes the complete `AdminConfig` to storage. Storage must never overwrite `admin:config` with a partial sync snapshot.

`null` means a revision mismatch and the script must write no key. On success, one Lua `EVAL` must compare the profile revision, fully replace selected profile domains, optionally compare and commit the complete admin config, increment profile and admin-settings revisions, and return the new profile revision. It must not be split into `DEL/HSET/LPUSH/SET` calls.

Ordinary profile writes must use one internal storage mutation helper: play-record, favorite, follow, and skip-config `set/delete/deleteAll`, plus search-history add/delete/clear. The helper must not expose an intermediate state between the mutation and revision increment. A no-op may avoid an increment, but the semantics must be explicit and tested.

## Stable read (稳定读取) and CAS retry (重试)

The route makes at most five attempts:

1. Read profile revision A.
2. Read selected remote profile domains; when admin settings are present, also read its config and admin-settings revision.
3. Read profile revision B; if A differs from B, restart without merging.
4. Merge the B snapshot and request snapshot with the existing conflict strategy, then call atomic `commitProfileSyncMerge` with B.
5. On CAS success, immediately return the committed `mergedSnapshot` and script revision; on CAS failure, retry with short random backoff.

After the limit, return `409`; never report false success or return a failed snapshot. Ordinary web writes increment their revision, so an old merge read cannot overwrite them.

## HTTP contract (HTTP 契约)

Keep request fields: `targetUsername`, `strategy`, `domains`, `snapshot`, `adminConfig`, `protocolVersion`, and `requestId`. Add this to a success response:

```json
{
  "ok": true,
  "targetUsername": "alice",
  "strategy": "local-first",
  "revision": "42",
  "mergedSnapshot": {
    "playRecords": {},
    "favorites": {},
    "follows": {},
    "searchHistory": [],
    "skipConfigs": {}
  },
  "summary": {}
}
```

`mergedSnapshot` is the authoritative (权威) server commit, not an echo of the request. Continue returning `protocolVersion` and `requestId` unchanged for compatibility (兼容性); new fields are additive.

Errors: malformed input `400`; unauthenticated or unauthorized `401`; absent target `404`; exhausted stable-read or CAS retries `409`; cross-slot or atomic-commit unavailability in any merge mode `409` (code `PROFILE_SYNC_CROSS_SLOT_ATOMIC_COMMIT_UNAVAILABLE`); unavailable backend, script, or cache-refresh failure `503`. An error response contains neither a new revision nor `mergedSnapshot`.

## Admin settings (管理设置)

Admin settings are not a user profile domain and use global `admin:config`. A request with `adminConfig` must use a separate global admin-settings revision (`admin:config-revision`) in the same Lua CAS. Only when both profile and admin revisions match may the script write the complete `AdminConfig` and increment both revisions. Every ordinary `saveAdminConfig` must also increment the admin revision in the same Lua call.

Call `setCachedConfig` only after script success. If cache refresh fails, invalidate or reload the cache and return `503`; do not claim a storage commit failed and write it again. Standalone Redis/Kvrocks may run multi-key Lua atomically. In Redis Cluster, every key of this `EVAL` (profile revision, each selected profile domain, and optional admin config plus admin revision) must share one hash slot. Current keys have no Hash Tag, so the condition is not guaranteed; every profile or admin-settings merge that receives `CROSSSLOT` must throw the stated error and map to `409`, never fall back to a non-atomic double write.

## Acceptance

- Every successful `mergedSnapshot` can be persisted by the desktop client and its `revision` exists on the server.
- Two concurrent merges, or a merge concurrent with an ordinary web write, do not lose a successful ordinary write; the conflicting operation retries or receives `409`.
- Unselected domains are never replaced after reading and remain empty in the response shape.
- Lua failure, CAS failure, or cross-slot atomic unavailability in any mode creates no partial persistence and returns the specified error.
- Redis, Kvrocks, and Upstash implement the same contract; local storage keeps the current unsupported response.
