# Account Sync Minimal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the current `/account-sync` two-card UI, then harden the `adminsettings` sync boundary so `owner/admin` identity data cannot flow back in through `web-first`, onboarding, or local backup import.

**Architecture:** The current repo already has the `/account-sync` page, `sync-now`, the scope card, and the onboarding modal. This slice does not rebuild UI. It adds one shared allowlist (白名单) layer for Web routes, then makes desktop sync move only business settings, and finally reuses the same business-only rule for local backup import/export and admin-name defaults.

**Tech Stack:** Next.js App Router, React, TypeScript, Jest, Rust, Axum, Tauri local service

## Global Constraints

- Keep the approved `/account-sync` UX as-is unless a compatibility fix is required.
- `adminsettings` may sync only `SiteConfig` `SourceConfig` `CustomCategories` `LiveConfig` `AdFilterConfig` `PlayerEnhancementConfig`.
- `ConfigFile` `ConfigSubscribtion` `UserConfig` `userPasswords` `profile_sync.*` must never cross the remote `adminsettings` boundary.
- `GET /api/admin/config` for `admin` may redact raw owner-only fields, but it must keep remote user-list visibility so onboarding preview and the existing admin user-management UI do not regress.
- In `web-first`, desktop must rebuild a sanitized (去身份化) local `ConfigFile` and preserve the current device `auth.*` plus `profile_sync.*`.
- The default admin username is `admin`; `owner` is a role only, never the default username fallback.
- Touch only files relevant to this feature and do not revert unrelated dirty worktree changes.
- Every behavior change follows TDD: failing test first, then minimal implementation.

## File Structure

- `src/lib/admin-settings-sync.ts`
  Shared Web-side allowlist, merge, and redaction helpers.
- `src/app/api/admin/profile-sync/merge/route.ts`
  Remote merge entry that accepts desktop `adminsettings` payloads.
- `src/app/api/admin/config/route.ts`
  Role-aware admin config reads for desktop sync.
- `crates/moontv-local-service/src/profile_sync_onboarding.rs`
  Desktop onboarding and `sync-now` payload build/apply logic.
- `crates/moontv-local-service/src/lib.rs`
  Raw `config.json` rebuilding, local backup boundary hardening, and Rust integration tests.
- `src/app/api/login/route.ts` and `config.example.json`
  Default-admin-name cleanup so fallback behavior cannot slide back to `owner`.

---

### Task 1: Constrain Web-side `adminsettings` payloads and admin config reads

**Files:**

- Create: `src/lib/admin-settings-sync.ts`
- Create: `src/lib/admin-settings-sync.test.ts`
- Create: `src/app/api/admin/config/route.test.ts`
- Modify: `src/app/api/admin/profile-sync/merge/route.ts:1-330`
- Modify: `src/app/api/admin/profile-sync/merge/route.test.ts:1-420`
- Modify: `src/app/api/admin/config/route.ts:1-63`

**Interfaces:**

- Produces:
  - `export interface AdminSettingsSyncSnapshot extends Pick<AdminConfig, 'SiteConfig' | 'SourceConfig' | 'CustomCategories' | 'LiveConfig' | 'AdFilterConfig' | 'PlayerEnhancementConfig'> {}`
  - `export function pickAdminSettingsSyncSnapshot(config: AdminConfig): AdminSettingsSyncSnapshot`
  - `export function applyAdminSettingsSyncSnapshot(currentConfig: AdminConfig, snapshot: Partial<AdminSettingsSyncSnapshot>): AdminConfig`
  - `export function redactAdminConfigForAdminRole(config: AdminConfig): AdminConfig`
- Consumes:

  - `configSelfCheck`
  - `getConfig`
  - `db.saveAdminConfig`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/admin-settings-sync.test.ts
import type { AdminConfig } from '@/lib/admin.types';

import {
  applyAdminSettingsSyncSnapshot,
  pickAdminSettingsSyncSnapshot,
  redactAdminConfigForAdminRole,
} from './admin-settings-sync';

function buildAdminConfig(): AdminConfig {
  return {
    ConfigSubscribtion: {
      URL: 'https://remote.example/sub',
      AutoUpdate: true,
      LastCheck: '2026-07-02T00:00:00Z',
    },
    ConfigFile: '{"auth":{"username":"admin","password":"admin-secret"}}',
    SiteConfig: {
      SiteName: 'Remote LunaTV',
      Announcement: 'announcement',
      SearchDownstreamMaxPage: 8,
      SiteInterfaceCacheTime: 3600,
      DoubanProxyType: 'custom',
      DoubanProxy: 'https://remote.example/douban',
      DoubanImageProxyType: 'custom',
      DoubanImageProxy: 'https://remote.example/image',
      DisableYellowFilter: true,
      FluidSearch: false,
      EnableWebLive: true,
    },
    UserConfig: {
      Users: [
        { username: 'admin', role: 'owner' },
        { username: 'remote-admin', role: 'admin' },
      ],
      Tags: [{ name: 'kids', enabledApis: ['demo'] }],
    },
    SourceConfig: [
      {
        key: 'demo',
        name: 'Demo',
        api: 'https://remote.example/api.php/provide/vod',
        from: 'custom',
      },
    ],
    CustomCategories: [],
    LiveConfig: [],
    AdFilterConfig: { enabled: false },
    PlayerEnhancementConfig: {
      AudioSpikeProtection: true,
      VisualEnhancement: true,
    },
  };
}

it('extracts only adminsettings business fields', () => {
  const snapshot = pickAdminSettingsSyncSnapshot(buildAdminConfig());

  expect(snapshot).toEqual({
    SiteConfig: expect.objectContaining({ SiteName: 'Remote LunaTV' }),
    SourceConfig: expect.arrayContaining([
      expect.objectContaining({ key: 'demo' }),
    ]),
    CustomCategories: [],
    LiveConfig: [],
    AdFilterConfig: { enabled: false },
    PlayerEnhancementConfig: expect.objectContaining({
      AudioSpikeProtection: true,
    }),
  });
  expect(snapshot).not.toHaveProperty('ConfigFile');
  expect(snapshot).not.toHaveProperty('UserConfig');
});

it('redacts owner-only raw fields for admin role reads without hiding users', () => {
  const redacted = redactAdminConfigForAdminRole(buildAdminConfig());

  expect(redacted.ConfigFile).toBe('');
  expect(redacted.ConfigSubscribtion).toEqual({
    URL: '',
    AutoUpdate: false,
    LastCheck: '',
  });
  expect(redacted.UserConfig).toEqual(buildAdminConfig().UserConfig);
  expect(redacted.SiteConfig.SiteName).toBe('Remote LunaTV');
});

it('applies only allowlisted fields when merging a sync snapshot', () => {
  const current = buildAdminConfig();
  const merged = applyAdminSettingsSyncSnapshot(current, {
    SiteConfig: {
      ...current.SiteConfig,
      SiteName: 'Desktop LunaTV',
    },
  });

  expect(merged.SiteConfig.SiteName).toBe('Desktop LunaTV');
  expect(merged.ConfigFile).toBe(current.ConfigFile);
  expect(merged.UserConfig).toEqual(current.UserConfig);
});
```

```ts
// src/app/api/admin/config/route.test.ts
jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';

import { GET } from './route';

it('returns a redacted config for admin users without hiding user-management data', async () => {
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
  process.env.USERNAME = 'admin';
  (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
    username: 'remote-admin',
  });
  (getConfig as jest.Mock).mockResolvedValue({
    ConfigSubscribtion: {
      URL: 'https://remote.example/sub',
      AutoUpdate: true,
      LastCheck: '2026-07-02T00:00:00Z',
    },
    ConfigFile: '{"auth":{"username":"admin","password":"admin-secret"}}',
    SiteConfig: {
      SiteName: 'Remote LunaTV',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 7200,
      DoubanProxyType: 'custom',
      DoubanProxy: '',
      DoubanImageProxyType: 'custom',
      DoubanImageProxy: '',
      DisableYellowFilter: false,
      FluidSearch: true,
      EnableWebLive: false,
    },
    UserConfig: {
      Users: [
        { username: 'admin', role: 'owner' },
        { username: 'remote-admin', role: 'admin', banned: false },
      ],
      Tags: [{ name: 'kids', enabledApis: ['demo'] }],
    },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
    AdFilterConfig: { enabled: true },
    PlayerEnhancementConfig: {
      AudioSpikeProtection: false,
      VisualEnhancement: false,
    },
  });

  const response = await GET(
    new NextRequest('http://localhost/api/admin/config')
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    Role: 'admin',
    Config: expect.objectContaining({
      ConfigSubscribtion: {
        URL: '',
        AutoUpdate: false,
        LastCheck: '',
      },
      ConfigFile: '',
      UserConfig: {
        Users: [
          { username: 'admin', role: 'owner' },
          { username: 'remote-admin', role: 'admin', banned: false },
        ],
        Tags: [{ name: 'kids', enabledApis: ['demo'] }],
      },
      SiteConfig: expect.objectContaining({
        SiteName: 'Remote LunaTV',
      }),
    }),
  });
});
```

```ts
// src/app/api/admin/profile-sync/merge/route.test.ts
it('ignores owner-only fields from the desktop adminsettings snapshot', async () => {
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
  process.env.USERNAME = 'admin';
  (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
    username: 'remote-admin',
  });
  (getConfig as jest.Mock).mockResolvedValue({
    ConfigSubscribtion: {
      URL: 'https://remote.example/sub',
      AutoUpdate: true,
      LastCheck: '2026-07-02T00:00:00Z',
    },
    ConfigFile: '{"auth":{"username":"admin","password":"admin-secret"}}',
    SiteConfig: {
      SiteName: 'Remote LunaTV',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 7200,
      DoubanProxyType: 'custom',
      DoubanProxy: '',
      DoubanImageProxyType: 'custom',
      DoubanImageProxy: '',
      DisableYellowFilter: false,
      FluidSearch: true,
      EnableWebLive: false,
    },
    UserConfig: {
      Users: [
        { username: 'admin', role: 'owner' },
        { username: 'remote-admin', role: 'admin', banned: false },
        { username: 'target-user', role: 'user', banned: false },
      ],
      Tags: [{ name: 'legacy', enabledApis: ['legacy'] }],
    },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
    AdFilterConfig: { enabled: true },
    PlayerEnhancementConfig: {
      AudioSpikeProtection: false,
      VisualEnhancement: false,
    },
  });
  (db.getAllPlayRecords as jest.Mock).mockResolvedValue({});
  (db.getAllFavorites as jest.Mock).mockResolvedValue({});
  (db.getAllFollowRecords as jest.Mock).mockResolvedValue({});
  (db.getSearchHistory as jest.Mock).mockResolvedValue([]);
  (db.getAllSkipConfigs as jest.Mock).mockResolvedValue({});

  await POST(
    new NextRequest('http://localhost/api/admin/profile-sync/merge', {
      method: 'POST',
      body: JSON.stringify({
        targetUsername: 'target-user',
        strategy: 'web-first',
        snapshot: {
          playRecords: {},
          favorites: {},
          follows: {},
          searchHistory: [],
          skipConfigs: {},
        },
        adminConfig: {
          ConfigSubscribtion: {
            URL: 'https://desktop.example/sub',
            AutoUpdate: false,
            LastCheck: '',
          },
          ConfigFile: '{"auth":{"username":"owner","password":"owner-secret"}}',
          SiteConfig: {
            SiteName: 'Desktop LunaTV',
            Announcement: 'sync',
            SearchDownstreamMaxPage: 5,
            SiteInterfaceCacheTime: 7200,
            DoubanProxyType: 'custom',
            DoubanProxy: '',
            DoubanImageProxyType: 'custom',
            DoubanImageProxy: '',
            DisableYellowFilter: false,
            FluidSearch: true,
            EnableWebLive: false,
          },
          UserConfig: {
            Users: [{ username: 'owner', role: 'owner' }],
            Tags: [{ name: 'kids', enabledApis: ['demo'] }],
          },
          SourceConfig: [],
          CustomCategories: [],
          LiveConfig: [],
          AdFilterConfig: { enabled: false },
          PlayerEnhancementConfig: {
            AudioSpikeProtection: true,
            VisualEnhancement: true,
          },
        },
      }),
    })
  );

  expect(db.saveAdminConfig).toHaveBeenCalledWith(
    expect.objectContaining({
      ConfigSubscribtion: {
        URL: 'https://remote.example/sub',
        AutoUpdate: true,
        LastCheck: '2026-07-02T00:00:00Z',
      },
      ConfigFile: '{"auth":{"username":"admin","password":"admin-secret"}}',
      UserConfig: {
        Users: expect.arrayContaining([
          expect.objectContaining({ username: 'remote-admin', role: 'admin' }),
        ]),
        Tags: expect.arrayContaining([
          expect.objectContaining({ name: 'legacy' }),
        ]),
      },
      SiteConfig: expect.objectContaining({
        SiteName: 'Desktop LunaTV',
      }),
      AdFilterConfig: {
        enabled: false,
      },
    })
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec jest src/lib/admin-settings-sync.test.ts src/app/api/admin/config/route.test.ts src/app/api/admin/profile-sync/merge/route.test.ts --runInBand
```

Expected:

- helper tests fail because `src/lib/admin-settings-sync.ts` does not exist
- `/api/admin/config` still leaks real `ConfigFile` and `ConfigSubscribtion`
- merge still accepts `ConfigFile` / `UserConfig` from the desktop snapshot

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/lib/admin-settings-sync.ts
import type { AdminConfig } from '@/lib/admin.types';

export interface AdminSettingsSyncSnapshot
  extends Pick<
    AdminConfig,
    | 'SiteConfig'
    | 'SourceConfig'
    | 'CustomCategories'
    | 'LiveConfig'
    | 'AdFilterConfig'
    | 'PlayerEnhancementConfig'
  > {}

const EMPTY_CONFIG_SUBSCRIPTION: AdminConfig['ConfigSubscribtion'] = {
  URL: '',
  AutoUpdate: false,
  LastCheck: '',
};

export function pickAdminSettingsSyncSnapshot(
  config: AdminConfig
): AdminSettingsSyncSnapshot {
  return {
    SiteConfig: config.SiteConfig,
    SourceConfig: config.SourceConfig,
    CustomCategories: config.CustomCategories,
    LiveConfig: config.LiveConfig ?? [],
    AdFilterConfig: config.AdFilterConfig ?? { enabled: true },
    PlayerEnhancementConfig: config.PlayerEnhancementConfig ?? {
      AudioSpikeProtection: false,
      VisualEnhancement: false,
    },
  };
}

export function applyAdminSettingsSyncSnapshot(
  currentConfig: AdminConfig,
  snapshot: Partial<AdminSettingsSyncSnapshot>
): AdminConfig {
  return {
    ...currentConfig,
    SiteConfig: snapshot.SiteConfig ?? currentConfig.SiteConfig,
    SourceConfig: snapshot.SourceConfig ?? currentConfig.SourceConfig,
    CustomCategories:
      snapshot.CustomCategories ?? currentConfig.CustomCategories,
    LiveConfig: snapshot.LiveConfig ?? currentConfig.LiveConfig,
    AdFilterConfig: snapshot.AdFilterConfig ?? currentConfig.AdFilterConfig,
    PlayerEnhancementConfig:
      snapshot.PlayerEnhancementConfig ?? currentConfig.PlayerEnhancementConfig,
  };
}

export function redactAdminConfigForAdminRole(
  config: AdminConfig
): AdminConfig {
  return {
    ...config,
    ConfigSubscribtion: EMPTY_CONFIG_SUBSCRIPTION,
    ConfigFile: '',
  };
}
```

```ts
// src/app/api/admin/profile-sync/merge/route.ts
import {
  applyAdminSettingsSyncSnapshot,
  type AdminSettingsSyncSnapshot,
} from '@/lib/admin-settings-sync';

interface DesktopProfileSyncMergeRequestBody {
  targetUsername?: string;
  strategy?: DesktopProfileMergeStrategy;
  snapshot?: DesktopProfileSnapshot;
  adminConfig?: AdminSettingsSyncSnapshot;
}

function normalizeAdminSettingsSyncSnapshot(
  adminConfig: DesktopProfileSyncMergeRequestBody['adminConfig']
): AdminSettingsSyncSnapshot | null {
  if (!adminConfig || !isObjectRecord(adminConfig)) {
    return null;
  }

  if (
    !isObjectRecord(adminConfig.SiteConfig) ||
    !Array.isArray(adminConfig.SourceConfig) ||
    !Array.isArray(adminConfig.CustomCategories) ||
    !Array.isArray(adminConfig.LiveConfig)
  ) {
    return null;
  }

  return adminConfig;
}

function mergeAdminPanelSnapshot(
  currentConfig: AdminConfig,
  snapshot: AdminSettingsSyncSnapshot
): AdminConfig {
  return configSelfCheck(
    applyAdminSettingsSyncSnapshot(currentConfig, snapshot)
  );
}
```

```ts
// src/app/api/admin/config/route.ts
import { redactAdminConfigForAdminRole } from '@/lib/admin-settings-sync';

export async function GET(request: NextRequest) {
  // ...existing storage checks stay unchanged
  const config = await getConfig();
  const resultRole =
    username === process.env.USERNAME
      ? 'owner'
      : config.UserConfig.Users.find(
          (user) =>
            user.username === username && user.role === 'admin' && !user.banned
        )
      ? 'admin'
      : null;

  if (!resultRole) {
    return NextResponse.json(
      { error: '你是管理员吗你就访问？' },
      { status: 401 }
    );
  }

  const result: AdminConfigResult = {
    Role: resultRole,
    Config:
      resultRole === 'owner' ? config : redactAdminConfigForAdminRole(config),
  };

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec jest src/lib/admin-settings-sync.test.ts src/app/api/admin/config/route.test.ts src/app/api/admin/profile-sync/merge/route.test.ts --runInBand
```

Expected:

- all 3 Jest files PASS
- merge saves only allowlisted business fields from desktop `adminsettings`
- `admin` role reads no longer expose real `ConfigFile` / `ConfigSubscribtion` while still keeping `UserConfig` for existing admin flows

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin-settings-sync.ts src/lib/admin-settings-sync.test.ts src/app/api/admin/config/route.ts src/app/api/admin/config/route.test.ts src/app/api/admin/profile-sync/merge/route.ts src/app/api/admin/profile-sync/merge/route.test.ts
git commit -m "fix(web): confine adminsettings sync payload"
```

### Task 2: Sync only business snapshots on desktop and rebuild the local `ConfigFile`

**Files:**

- Modify: `crates/moontv-local-service/src/profile_sync_onboarding.rs:350-1267`
- Modify: `crates/moontv-local-service/src/lib.rs:2435-2575`
- Test: `crates/moontv-local-service/src/lib.rs:10234-11619`

**Interfaces:**

- Produces:
  - `fn build_admin_settings_sync_snapshot(config: &DesktopAdminConfig) -> DesktopAdminConfig`
  - `fn load_local_admin_config_snapshot(state: &AppState) -> AppResult<Value>` returning a redacted `DesktopAdminConfig`
  - `fn apply_admin_settings_to_config_file(base_config_file: &str, admin_config: &DesktopAdminConfig) -> Result<String>`
  - `fn apply_remote_admin_config_to_local_state(state: &AppState, remote_base_url: &str, sync_domains: &[String], remote_admin_config: DesktopAdminConfig) -> AppResult<()>`
- Consumes:

  - `apply_desktop_runtime_overrides_to_config_file`
  - `extract_owner_username_from_config_file`
  - `extract_owner_password_from_config_file`

- [ ] **Step 1: Write the failing tests**

```rust
// crates/moontv-local-service/src/lib.rs
#[tokio::test]
async fn profile_sync_sync_now_web_first_with_adminsettings_applies_remote_admin_config_locally() {
    // keep the current mock server, local persistence, and sync-now request setup from the
    // existing test body; replace only the tail assertions with the checks below

    assert_eq!(
        admin_payload
            .get("Config")
            .and_then(|value| value.get("ConfigSubscribtion"))
            .and_then(|value| value.get("URL"))
            .and_then(Value::as_str),
        Some("https://local.example/subscription")
    );
    assert!(
        admin_payload
            .get("Config")
            .and_then(|value| value.get("UserConfig"))
            .and_then(|value| value.get("Users"))
            .and_then(Value::as_array)
            .is_some_and(|users| users.iter().all(|user| {
                user.get("username").and_then(Value::as_str) != Some("remote-admin")
            })),
        "remote admin users must not be imported into the local identity layer"
    );
    assert!(
        admin_payload
            .get("Config")
            .and_then(|value| value.get("ConfigFile"))
            .and_then(Value::as_str)
            .is_some_and(|config_file| {
                config_file.contains("local-owner-secret")
                    && config_file.contains(&upstream.base_url())
                    && !config_file.contains("remote-owner-secret")
            }),
        "web-first should preserve local auth and profile_sync while applying remote business config"
    );
}

#[tokio::test]
async fn profile_sync_onboarding_execute_sends_admin_config_snapshot_to_merge_route_when_adminsettings_selected_and_localfirst() {
    // keep the current onboarding request and merge mock setup; replace the merge-payload
    // assertions with the allowlist checks below
    assert_eq!(
        payload.get("adminConfig").and_then(|value| value.get("ConfigFile")),
        None
    );
    assert_eq!(
        payload.get("adminConfig").and_then(|value| value.get("UserConfig")),
        None
    );
    assert_eq!(
        payload
            .get("adminConfig")
            .and_then(|value| value.get("SiteConfig"))
            .and_then(|value| value.get("SiteName"))
            .and_then(Value::as_str),
        Some("Desktop LunaTV")
    );
}

#[tokio::test]
async fn profile_sync_onboarding_execute_web_first_with_adminsettings_applies_remote_admin_config_locally() {
    // keep the current mock server, local persistence, and onboarding request setup from the
    // existing test body; replace only the tail assertions with the checks below

    assert_eq!(
        admin_payload
            .get("Config")
            .and_then(|value| value.get("ConfigSubscribtion"))
            .and_then(|value| value.get("URL"))
            .and_then(Value::as_str),
        Some("https://local.example/subscription")
    );
    assert!(
        admin_payload
            .get("Config")
            .and_then(|value| value.get("ConfigFile"))
            .and_then(Value::as_str)
            .is_some_and(|config_file| {
                config_file.contains("local-owner-secret")
                    && config_file.contains(&upstream.base_url())
                    && !config_file.contains("remote-owner-secret")
            }),
        "onboarding web-first should preserve local auth while applying remote business config"
    );
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test -p moontv-local-service profile_sync_sync_now_web_first_with_adminsettings_applies_remote_admin_config_locally -- --nocapture
cargo test -p moontv-local-service profile_sync_onboarding_execute_sends_admin_config_snapshot_to_merge_route_when_adminsettings_selected_and_localfirst -- --nocapture
cargo test -p moontv-local-service profile_sync_onboarding_execute_web_first_with_adminsettings_applies_remote_admin_config_locally -- --nocapture
```

Expected:

- current assertions still show remote `ConfigSubscribtion` / `UserConfig`
- local raw `ConfigFile` still contains `remote-owner-secret`
- local-first payload still carries the full desktop `adminConfig`

- [ ] **Step 3: Write the minimal implementation**

```rust
// crates/moontv-local-service/src/profile_sync_onboarding.rs
fn build_admin_settings_sync_snapshot(config: &DesktopAdminConfig) -> DesktopAdminConfig {
    let mut snapshot = DesktopAdminConfig::default();
    snapshot.site_config = config.site_config.clone();
    snapshot.source_config = config.source_config.clone();
    snapshot.custom_categories = config.custom_categories.clone();
    snapshot.live_config = config.live_config.clone();
    snapshot.ad_filter_config = config.ad_filter_config.clone();
    snapshot.player_enhancement_config = config.player_enhancement_config.clone();
    snapshot
}

fn load_local_admin_config_snapshot(state: &AppState) -> AppResult<Value> {
    let persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;

    serde_json::to_value(build_admin_settings_sync_snapshot(&persistence.config))
        .map_err(|error| AppError::internal(error.to_string()))
}
```

```rust
// crates/moontv-local-service/src/lib.rs
fn apply_admin_settings_to_config_file(
    base_config_file: &str,
    admin_config: &DesktopAdminConfig,
) -> Result<String> {
    let mut config_value = serde_json::from_str::<Value>(base_config_file.trim())
        .context("failed to parse config file json")?;
    let root = config_value
        .as_object_mut()
        .context("config file root must be an object")?;

    root.insert(
        "cache_time".to_string(),
        json!(admin_config.site_config.site_interface_cache_time),
    );
    root.insert(
        "search_downstream_max_page".to_string(),
        json!(admin_config.site_config.search_downstream_max_page),
    );
    root.insert(
        "disable_yellow_filter".to_string(),
        json!(admin_config.site_config.disable_yellow_filter),
    );
    root.insert(
        "site_name".to_string(),
        json!(admin_config.site_config.site_name),
    );
    root.insert(
        "announcement".to_string(),
        json!(admin_config.site_config.announcement),
    );
    root.insert(
        "douban_proxy_type".to_string(),
        json!(admin_config.site_config.douban_proxy_type),
    );
    root.insert(
        "douban_proxy".to_string(),
        json!(admin_config.site_config.douban_proxy),
    );
    root.insert(
        "douban_image_proxy_type".to_string(),
        json!(admin_config.site_config.douban_image_proxy_type),
    );
    root.insert(
        "douban_image_proxy".to_string(),
        json!(admin_config.site_config.douban_image_proxy),
    );
    root.insert(
        "enable_web_live".to_string(),
        json!(admin_config.site_config.enable_web_live),
    );
    root.insert(
        "api_site".to_string(),
        Value::Object(
            admin_config
                .source_config
                .iter()
                .map(|source| {
                    (
                        source.key.clone(),
                        json!({
                            "api": source.api,
                            "name": source.name,
                            "detail": source.detail,
                            "ua": source.ua,
                            "referer": source.referer,
                            "disabled": source.disabled,
                            "disable_ad_filter": source.disable_ad_filter,
                        }),
                    )
                })
                .collect(),
        ),
    );
    root.insert(
        "custom_category".to_string(),
        json!(
            admin_config
                .custom_categories
                .iter()
                .map(|category| {
                    json!({
                        "name": category.name,
                        "type": category.category_type,
                        "query": category.query,
                        "disabled": category.disabled,
                    })
                })
                .collect::<Vec<_>>()
        ),
    );
    root.insert(
        "lives".to_string(),
        Value::Object(
            admin_config
                .live_config
                .iter()
                .map(|live| {
                    (
                        live.key.clone(),
                        json!({
                            "name": live.name,
                            "url": live.url,
                            "ua": live.ua,
                            "epg": live.epg,
                            "disabled": live.disabled,
                        }),
                    )
                })
                .collect(),
        ),
    );
    root.insert(
        "player_enhancements".to_string(),
        json!({
            "audio_spike_protection": admin_config.player_enhancement_config.audio_spike_protection,
            "audio_spike_protection_level": admin_config.player_enhancement_config.audio_spike_protection_level,
            "audio_dynamic_protection": admin_config.player_enhancement_config.audio_dynamic_protection,
            "audio_fixed_ceiling": admin_config.player_enhancement_config.audio_fixed_ceiling,
            "visual_enhancement": admin_config.player_enhancement_config.visual_enhancement,
            "visual_enhancement_level": admin_config.player_enhancement_config.visual_enhancement_level,
        }),
    );

    serde_json::to_string_pretty(&config_value).context("failed to encode config file json")
}
```

```rust
// crates/moontv-local-service/src/profile_sync_onboarding.rs
fn apply_remote_admin_config_to_local_state(
    state: &AppState,
    remote_base_url: &str,
    sync_domains: &[String],
    remote_admin_config: DesktopAdminConfig,
) -> AppResult<()> {
    let mut persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let owner_username = extract_owner_username_from_config_file(&persistence.config.config_file);
    let owner_password = extract_owner_password_from_config_file(&persistence.config.config_file);

    let next_config_file = apply_admin_settings_to_config_file(
        &persistence.config.config_file,
        &remote_admin_config,
    )
    .and_then(|config_file| {
        apply_desktop_runtime_overrides_to_config_file(
            &config_file,
            owner_username.as_deref(),
            owner_password.as_deref(),
            Some(remote_base_url),
            Some(sync_domains),
        )
    })
    .map_err(|error| AppError::internal(error.to_string()))?;

    persistence.config.site_config = remote_admin_config.site_config;
    persistence.config.source_config = remote_admin_config.source_config;
    persistence.config.custom_categories = remote_admin_config.custom_categories;
    persistence.config.live_config = remote_admin_config.live_config;
    persistence.config.ad_filter_config = remote_admin_config.ad_filter_config;
    persistence.config.player_enhancement_config = remote_admin_config.player_enhancement_config;
    persistence.config.config_file = next_config_file.clone();
    persistence.profile_sync_api_base_url = Some(remote_base_url.to_string());
    persistence.profile_sync_sync_domains = sync_domains.to_vec();

    state
        .write_raw_config(&next_config_file)
        .map_err(|error| AppError::internal(error.to_string()))?;
    state
        .save_admin_persistence(&persistence)
        .map_err(|error| AppError::internal(error.to_string()))?;

    Ok(())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cargo test -p moontv-local-service profile_sync_sync_now_web_first_with_adminsettings_applies_remote_admin_config_locally -- --nocapture
cargo test -p moontv-local-service profile_sync_onboarding_execute_sends_admin_config_snapshot_to_merge_route_when_adminsettings_selected_and_localfirst -- --nocapture
cargo test -p moontv-local-service profile_sync_onboarding_execute_web_first_with_adminsettings_applies_remote_admin_config_locally -- --nocapture
```

Expected:

- local-first payload carries only business fields inside `adminConfig`
- after `web-first`, local `/api/admin/config` keeps local auth and `profile_sync.*`
- remote `ConfigSubscribtion` and `UserConfig` no longer pollute local persistence

- [ ] **Step 5: Commit**

```bash
git add crates/moontv-local-service/src/profile_sync_onboarding.rs crates/moontv-local-service/src/lib.rs
git commit -m "fix(desktop): rebuild local config from adminsettings snapshot"
```

### Task 3: Reuse the same business-only boundary for local backup and default admin fixtures

**Files:**

- Create: `src/app/api/login/route.test.ts`
- Modify: `config.example.json:1-8`
- Modify: `src/app/api/login/route.ts:1-165`
- Modify: `src/app/api/admin/profile-sync/merge/route.test.ts:64-401`
- Modify: `crates/moontv-local-service/src/lib.rs:134-135`
- Modify: `crates/moontv-local-service/src/lib.rs:2195-2260`
- Modify: `crates/moontv-local-service/src/lib.rs:4590-4707`
- Test: `crates/moontv-local-service/src/lib.rs:8580-8808`

**Interfaces:**

- Produces:
  - `const LOCALSTORAGE_FALLBACK_OWNER_USERNAME = 'admin'`
  - `fn build_local_admin_data_migration_archive(state: &AppState) -> Result<AdminDataMigrationArchive>` exporting business-only config
  - `fn import_local_admin_data_migration_archive(state: &AppState, archive: &AdminDataMigrationArchive) -> Result<()>` preserving current local `auth.*`, `UserConfig`, `user_passwords`, and `profile_sync.*`
- Consumes:

  - `build_admin_settings_sync_snapshot`
  - `apply_admin_settings_to_config_file`
  - `apply_desktop_runtime_overrides_to_config_file`

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/login/route.test.ts
import { NextRequest } from 'next/server';

import { POST } from './route';

describe('/api/login localstorage fallback', () => {
  const originalStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;
  const originalUsername = process.env.USERNAME;
  const originalPassword = process.env.PASSWORD;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localstorage';
    delete process.env.USERNAME;
    delete process.env.PASSWORD;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = originalStorageType;
    process.env.USERNAME = originalUsername;
    process.env.PASSWORD = originalPassword;
  });

  it('falls back to admin when localstorage mode has no explicit username', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/login', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      username: 'admin',
      role: 'owner',
    });
  });
});
```

```rust
// crates/moontv-local-service/src/lib.rs
#[tokio::test]
async fn admin_data_migration_export_route_omits_local_identity_payloads() {
    // keep the current export request setup from the existing test body; replace the archive
    // assertions below

    assert!(
        archive.data.user_data.is_empty(),
        "business-only export must not include local account passwords"
    );
    assert_eq!(
        archive.data.admin_config.user_config.users.len(),
        0,
        "business-only export must not include local users"
    );
    assert_eq!(archive.data.admin_config.config_file, "");
}

#[tokio::test]
async fn admin_data_migration_import_route_preserves_local_identity_layer() {
    // keep the current import request setup from the existing test body; replace the persistence
    // assertions below

    assert_eq!(
        extract_owner_username_from_config_file(&persistence.config.config_file).as_deref(),
        Some("old-owner")
    );
    assert_eq!(
        extract_owner_password_from_config_file(&persistence.config.config_file).as_deref(),
        Some("old-secret")
    );
    assert_eq!(persistence.user_passwords.get("kid"), None);
    assert!(
        persistence
            .config
            .user_config
            .users
            .iter()
            .all(|user| user.username != "new-owner"),
        "import must not add archive owner accounts into the local identity layer"
    );
}
```

```ts
// src/app/api/admin/profile-sync/merge/route.test.ts
beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
  process.env.USERNAME = 'admin';
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec jest src/app/api/login/route.test.ts src/app/api/admin/profile-sync/merge/route.test.ts --runInBand
cargo test -p moontv-local-service admin_data_migration_ -- --nocapture
```

Expected:

- login still falls back to `owner`
- export still includes `user_data` / `UserConfig`
- import still replaces the local owner with archive identity data

- [ ] **Step 3: Write the minimal implementation**

```json
// config.example.json
{
  "cache_time": 7200,
  "auth": {
    "username": "admin",
    "password": ""
  },
  "profile_sync": {
    "api_base_url": ""
  }
}
```

```ts
// src/app/api/login/route.ts
const LOCALSTORAGE_FALLBACK_OWNER_USERNAME = 'admin';

// ...
username: process.env.USERNAME || LOCALSTORAGE_FALLBACK_OWNER_USERNAME,

// ...
return buildAuthenticatedResponse(
  process.env.USERNAME || LOCALSTORAGE_FALLBACK_OWNER_USERNAME,
  password,
  'owner',
  true
);
```

```rust
// crates/moontv-local-service/src/lib.rs
const DESKTOP_LOCAL_DATA_MIGRATION_NOTE: &str =
    "桌面本地模式仅迁移管理员业务配置；本地账号身份、密码以及浏览器本地数据不会导入或导出。";

fn build_local_admin_data_migration_archive(state: &AppState) -> Result<AdminDataMigrationArchive> {
    let persistence = state.load_admin_persistence()?;

    Ok(AdminDataMigrationArchive {
        timestamp: current_iso_timestamp(),
        server_version: env!("CARGO_PKG_VERSION").to_string(),
        data: AdminDataMigrationArchiveData {
            admin_config: build_admin_settings_sync_snapshot(&persistence.config),
            user_data: BTreeMap::new(),
            desktop_metadata: Some(AdminDataMigrationDesktopMetadata {
                scope: "desktop-local".to_string(),
                note: DESKTOP_LOCAL_DATA_MIGRATION_NOTE.to_string(),
                includes_browser_local_data: false,
                includes_remote_profile_data: false,
            }),
        },
    })
}

fn import_local_admin_data_migration_archive(
    state: &AppState,
    archive: &AdminDataMigrationArchive,
) -> Result<()> {
    let current_persistence = state.load_admin_persistence()?;
    let mut imported_config = current_persistence.config.clone();

    imported_config.site_config = archive.data.admin_config.site_config.clone();
    imported_config.source_config = archive.data.admin_config.source_config.clone();
    imported_config.custom_categories = archive.data.admin_config.custom_categories.clone();
    imported_config.live_config = archive.data.admin_config.live_config.clone();
    imported_config.ad_filter_config = archive.data.admin_config.ad_filter_config.clone();
    imported_config.player_enhancement_config =
        archive.data.admin_config.player_enhancement_config.clone();

    let next_config_file = apply_admin_settings_to_config_file(
        &current_persistence.config.config_file,
        &imported_config,
    )
    .and_then(|config_file| {
        apply_desktop_runtime_overrides_to_config_file(
            &config_file,
            extract_owner_username_from_config_file(&current_persistence.config.config_file).as_deref(),
            extract_owner_password_from_config_file(&current_persistence.config.config_file).as_deref(),
            current_persistence.profile_sync_api_base_url.as_deref(),
            Some(current_persistence.profile_sync_sync_domains.as_slice()),
        )
    })?;

    imported_config.config_file = next_config_file.clone();

    let imported_persistence = DesktopAdminPersistence {
        config: imported_config,
        user_passwords: current_persistence.user_passwords,
        profile_sync_api_base_url: current_persistence.profile_sync_api_base_url,
        profile_sync_sync_domains: current_persistence.profile_sync_sync_domains,
    };

    state.write_raw_config(&next_config_file)?;
    state.save_admin_persistence(&imported_persistence)?;
    Ok(())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec jest src/app/api/login/route.test.ts src/app/api/admin/profile-sync/merge/route.test.ts --runInBand
cargo test -p moontv-local-service admin_data_migration_ -- --nocapture
```

Expected:

- localstorage login fallback stays `admin`
- merge fixtures no longer treat `owner` as the default admin username
- local backup import/export moves business config only and preserves the device-local identity layer

- [ ] **Step 5: Commit**

```bash
git add config.example.json src/app/api/login/route.ts src/app/api/login/route.test.ts src/app/api/admin/profile-sync/merge/route.test.ts crates/moontv-local-service/src/lib.rs
git commit -m "fix(identity): preserve local admin state across sync and backup"
```

### Task 4: Full verification and desktop smoke tests

**Files:**

- Verify only

**Interfaces:**

- Consumes: Tasks 1-3 outputs
- Produces: verified `adminsettings` hardening with unchanged `/account-sync` UX

- [ ] **Step 1: Run focused automated test suites**

Run:

```bash
pnpm exec jest src/lib/admin-settings-sync.test.ts src/app/api/admin/config/route.test.ts src/app/api/admin/profile-sync/merge/route.test.ts src/app/api/login/route.test.ts src/app/account-sync/page.test.tsx src/components/DesktopProfileSyncOnboardingCard.test.tsx src/components/DesktopProfileSyncScopeCard.test.tsx --runInBand
cargo test -p moontv-local-service profile_sync_ -- --nocapture
cargo test -p moontv-local-service admin_data_migration_ -- --nocapture
```

Expected:

- Jest suites PASS
- Rust `profile_sync_` suites PASS
- Rust `admin_data_migration_` suites PASS

- [ ] **Step 2: Run static verification**

Run:

```bash
pnpm exec eslint src/lib/admin-settings-sync.ts src/lib/admin-settings-sync.test.ts src/app/api/admin/config/route.ts src/app/api/admin/config/route.test.ts src/app/api/admin/profile-sync/merge/route.ts src/app/api/admin/profile-sync/merge/route.test.ts src/app/api/login/route.ts src/app/api/login/route.test.ts src/app/account-sync/page.tsx src/components/DesktopProfileSyncOnboardingCard.tsx src/components/DesktopProfileSyncScopeCard.tsx src/lib/desktop/profile-sync.ts
pnpm exec tsc --noEmit --incremental false --pretty false
```

Expected:

- ESLint PASS
- TypeScript compile PASS

- [ ] **Step 3: Launch the desktop shell and smoke-test the adminsettings flows**

Run:

```bash
pnpm desktop:dev
```

Expected:

- `/account-sync` still shows the two-card layout plus the sync-scope card
- choosing `adminsettings` and running `local-first` / `web-first` no longer renames the local admin account from `admin` back to `owner`
- the persisted local raw config keeps the current `auth.*` and `profile_sync.*`
- remote business settings still update site config, sources, categories, live config, and player enhancements
