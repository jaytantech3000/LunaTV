# 帐号同步页极简改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留当前 `/account-sync` 双卡与同步范围 UI，只补齐 `adminsettings` 的受控同步边界，杜绝 `owner/admin` 身份回灌，并让 `web-first`、onboarding 与本地备份导入都不再改写设备本地身份层。

**Architecture:** 仓库里现有 `/account-sync` 页面、`sync-now` 接口、scope card 和 onboarding 弹窗已经存在，这次不重做 UI。实现重点是新增一套共享白名单 helper，让 Web 端只接收业务快照上传，并在 `admin` 读取时仅脱敏 owner 原始字段；桌面端只同步这些业务字段，并始终用本地 `auth.*` 与 `profile_sync.*` 重新覆盖 raw `config.json`。

**Tech Stack:** Next.js App Router、React、TypeScript、Jest、Rust、Axum、Tauri local service

## Global Constraints

- 必须遵守 approved spec：保留当前 `/account-sync` 双卡布局与 onboarding 交互，只修正 `adminsettings` 同步边界和配套兼容层。
- `adminsettings` 只允许同步 `SiteConfig` `SourceConfig` `CustomCategories` `LiveConfig` `AdFilterConfig` `PlayerEnhancementConfig`。
- `ConfigFile` `ConfigSubscribtion` `UserConfig` `userPasswords` `profile_sync.*` 永远不能进入远端 `adminsettings` payload，也不能被远端快照回灌到本地身份层。
- `GET /api/admin/config` 面向 `admin` 时可以脱敏原始 owner 字段，但必须保留远端用户列表可见性，避免 onboarding 预览和现有管理员用户管理页回归。
- `web-first` 应用远端管理员设置时，必须在桌面端本地重建去身份化 `ConfigFile`，并保留当前设备的 `auth.*` 与 `profile_sync.*`。
- 默认管理员用户名固定为 `admin`；`owner` 只能表示角色，不能再作为默认用户名 fallback。
- 只能修改当前需求相关文件，不回滚工作区内其他脏改动。
- 所有行为改动必须先写失败测试，再写最小实现。

## File Structure

- `src/lib/admin-settings-sync.ts`
  负责 Web 端 `adminsettings` 白名单字段抽取、合并与脱敏。
- `src/app/api/admin/profile-sync/merge/route.ts`
  负责把桌面同步过来的管理员业务快照合并到远端 persisted config。
- `src/app/api/admin/config/route.ts`
  负责按角色返回完整配置或脱敏后的管理员业务快照。
- `crates/moontv-local-service/src/profile_sync_onboarding.rs`
  负责 onboarding / sync-now 的 `adminsettings` payload 构造与 `web-first` 应用逻辑。
- `crates/moontv-local-service/src/lib.rs`
  负责 raw `config.json` 重建 helper、本地备份导入导出边界和 Rust 端集成测试。
- `src/app/api/login/route.ts` 与 `config.example.json`
  负责默认管理员用户名回归到 `admin`，避免 fallback 再次滑回 `owner`。

---

### Task 1: Web 端收紧 `adminsettings` 白名单与管理员配置读取

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

- helper 测试因 `src/lib/admin-settings-sync.ts` 不存在失败
- `/api/admin/config` 仍返回完整 `ConfigFile` 和 `ConfigSubscribtion`
- merge route 仍错误地接收 `ConfigFile` / `UserConfig`

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
  // ...前置鉴权不变
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

- 3 个 Jest 文件全部 PASS
- merge route 保存的配置不再包含桌面快照带来的 `ConfigFile` / `UserConfig`
- admin 角色读取不到真实 `ConfigFile` / `ConfigSubscribtion`，但仍保留现有 `UserConfig` 可见性

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin-settings-sync.ts src/lib/admin-settings-sync.test.ts src/app/api/admin/config/route.ts src/app/api/admin/config/route.test.ts src/app/api/admin/profile-sync/merge/route.ts src/app/api/admin/profile-sync/merge/route.test.ts
git commit -m "fix(web): confine adminsettings sync payload"
```

### Task 2: 桌面端只同步业务快照，并在本地重建去身份化 `ConfigFile`

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
    // 保留当前 mock server、本地 persistence 和 sync-now 请求搭建，只替换结尾断言为下面这些检查

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
    // 保留当前 onboarding 请求和 merge mock 搭建，只把 merge payload 断言替换成下面这些白名单检查
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
    // 保留当前 mock server、本地 persistence 和 onboarding 请求搭建，只替换结尾断言为下面这些检查

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

- 现有断言仍能看到远端 `ConfigSubscribtion` / `UserConfig`
- 本地 raw `ConfigFile` 仍包含 `remote-owner-secret`
- local-first payload 仍带着整份 `adminConfig`

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

- local-first payload 里 `adminConfig` 只剩业务字段
- `web-first` 后本地 `/api/admin/config` 的 `ConfigFile` 保留本地密码与 `profile_sync.*`
- 远端 `ConfigSubscribtion`、`UserConfig` 不再污染本地 persistence

- [ ] **Step 5: Commit**

```bash
git add crates/moontv-local-service/src/profile_sync_onboarding.rs crates/moontv-local-service/src/lib.rs
git commit -m "fix(desktop): rebuild local config from adminsettings snapshot"
```

### Task 3: 让本地备份导入导出和默认管理员夹具复用同一边界

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
  - `fn build_local_admin_data_migration_archive(state: &AppState) -> Result<AdminDataMigrationArchive>` exporting only business config
  - `fn import_local_admin_data_migration_archive(state: &AppState, archive: &AdminDataMigrationArchive) -> Result<()>` preserving current local `auth.*`, `UserConfig`, `user_passwords`, `profile_sync.*`
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
    // 保留当前 export 请求搭建，只把 archive 断言替换成下面这些检查

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
    // 保留当前 import 请求搭建，只把 persistence 断言替换成下面这些检查

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

- login route 仍 fallback 到 `owner`
- 导出 archive 仍包含 `user_data` / `UserConfig`
- 导入后本地 owner 仍被 archive 里的 `new-owner` 覆盖

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

- login localstorage fallback 固定回到 `admin`
- merge route 相关夹具不再把 `owner` 当默认管理员用户名
- 本地备份导入导出只搬运业务配置，不再覆盖本地账号身份与密码

- [ ] **Step 5: Commit**

```bash
git add config.example.json src/app/api/login/route.ts src/app/api/login/route.test.ts src/app/api/admin/profile-sync/merge/route.test.ts crates/moontv-local-service/src/lib.rs
git commit -m "fix(identity): preserve local admin state across sync and backup"
```

### Task 4: 全量验证并桌面手测关键路径

**Files:**

- Verify only

**Interfaces:**

- Consumes: Tasks 1-3 outputs
- Produces: verified adminsettings hardening with unchanged `/account-sync` UX

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
- TypeScript 编译 PASS

- [ ] **Step 3: Launch the desktop shell and smoke-test the adminsettings flows**

Run:

```bash
pnpm desktop:dev
```

Expected:

- `/account-sync` 仍显示双卡 + 同步范围卡
- 选择 `adminsettings` 并执行 `local-first` / `web-first` 后，本地管理员帐号名不再从 `admin` 漂回 `owner`
- 本地 `config.example.json` / persisted raw config 保留当前 `auth.*` 与 `profile_sync.*`
- 远端管理员快照依然能更新站点设置、视频源、分类、直播和播放器增强配置
