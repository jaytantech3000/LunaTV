# Account Sync Minimal Redesign

## Goal

Reduce `/account-sync` into a minimal desktop sync page:

- Remove the helper copy under the page title
- Compress `Sync Status Summary` and `Enable Account Sync` into a single top row with two half-width cards
- Remove `Diagnostics`
- Add `Manage Sync Scope`
- Add a single admin-only sync item: `Admin Settings`

## Non-Goals

- No structural change to `/config` in this round
- No large inline onboarding form in the main page area
- No further split of `Admin Settings` into sub-domains
- No syncing of local runtime state, local connection config, or diagnostics data

## Layout

The page becomes a two-layer layout:

1. Top row with two cards
   - Left: `Sync Status Summary`
   - Right: `Enable Account Sync` / `Sync Now`
2. One full-width card below
   - `Manage Sync Scope`

Desktop uses a `1/2 + 1/2` layout. Mobile stacks the cards vertically.

## Interaction Design

### 1. Header Area

- Keep `桌面同步`
- Keep `帐号同步`
- Remove the full line of helper copy under `帐号同步`

### 2. Sync Status Summary

The summary card keeps only the minimum information:

- Large result state:
  - `已连接并已登录`
  - `未启用`
  - `需要处理`
- Two short lines:
  - `帐号：admin`
  - `状态：远端可达 / 登录失效 / 本地服务异常`

Remove from the current card:

- Long status explanation
- Sync scope text
- Diagnostic entry

### 3. Enable Account Sync / Sync Now

The right card becomes action-only.

#### Disabled

- Title: `开启帐号同步`
- Short state: `当前仍在使用本地模式`
- Primary button: `开启同步`

Clicking the button opens the existing onboarding modal and reuses the current Web login, preview, and execute flow.

#### Enabled

- Title: `已开启帐号同步`
- Short state: `当前使用 Web 帐号`
- Primary button: `同步`

Clicking the button runs an immediate manual sync.

#### In Progress

- The button enters loading state
- The card shows one short status only:
  - `同步中...`
  - `同步成功`
  - `同步失败：远端不可达`

### 4. Remove Diagnostics

Remove the current diagnostics block completely.

Error feedback stays only in the top two cards:

- The summary card shows the sync result
- The action card shows the operation result

If local status loading fails, the page shows only:

- `需要处理`
- One short error message
- A `去配置` link

## Manage Sync Scope

Add a dedicated card: `管理同步范围`

### Default Options

Show the current five user-data domains by default:

- Play Records (播放记录)
- Favorites (收藏)
- Follows (追更)
- Search History (搜索历史)
- Skip Configs (跳过片头片尾)

### Admin Extension

If the current remote role is `owner` or `admin`, show one extra option:

- Admin Settings (管理员设置)

This is a single top-level sync domain: `adminsettings`.

### Selection Model

- Use a multi-select control
- Initial value comes from current `syncDomains`
- If `syncDomains` is missing, fall back to the current five defaults
- Normal users never see `Admin Settings`
- If the role drops from admin to normal user, the frontend removes `Admin Settings` automatically

### Save Model

Do not add a separate save button.

Scope changes are submitted together when the user clicks `同步`:

- Save the new sync scope
- Run an immediate manual sync

While sync is disabled, users may adjust the scope first. It becomes effective when onboarding finishes.

## Scope of Admin Settings

`Admin Settings` syncs only the editable business configuration snapshot (业务配置快照) from the admin page. It must not sync the full `AdminConfig`, and it must not copy the remote raw `ConfigFile` back into desktop state.

Included:

- `SiteConfig`
- `AdFilterConfig`
- `SourceConfig`
- `CustomCategories`
- `LiveConfig`
- `PlayerEnhancementConfig`

Excluded:

- `ConfigFile`
- `ConfigSubscribtion`
- `UserConfig`
- `userPasswords`
- `profile_sync.*`
- Local service runtime state
- Diagnostics data
- Reset actions
- Desktop-only connection or runtime parameters

When desktop applies remote admin settings in `web-first`, it must rebuild a sanitized (去身份化) local `ConfigFile` from the structured business fields while preserving local `auth.*` and `profile_sync.*`.

### Invariants

- The default admin username stays `admin`
- `owner` means a role only; it is no longer a username
- Neither profile sync nor local backup import may rewrite the device-local identity layer (身份层)

The design uses a controlled sync domain (受控同步域) so local environment config or identity-layer data cannot be pushed upstream by mistake.

## Backend Design

### 1. New Sync Domain

Extend the current sync-domain set:

- Existing: `playrecords` `favorites` `follows` `searchhistory` `skipconfigs`
- New: `adminsettings`

### 2. New Manual Sync Endpoint

Add:

- `POST /api/profile-sync/sync-now`

Request responsibility:

- Submit the currently selected `syncDomains`
- Trigger an immediate sync

Endpoint behavior:

1. Validate that account sync is already enabled
2. Validate all sync domains
3. If `adminsettings` is included, require remote role `owner/admin`
4. Load local user-data snapshots
5. If `adminsettings` is included, build a business-only snapshot from the allowed fields
6. Sync only the selected domains
7. In `web-first`, if `adminsettings` is included, fetch the remote business snapshot and rebuild a sanitized local `ConfigFile`
8. Return updated sync status and the latest operation result

### 3. Onboarding Integration

After onboarding succeeds, the current scope selection must be persisted immediately so the first enabled session does not require one extra manual sync click.

If onboarding includes `adminsettings`, it must reuse the same controlled business-snapshot builder instead of uploading the full local `adminConfig`.

### 4. Redacted Admin Config Reads

- `GET /api/admin/config` may keep the full payload for `owner`
- For `admin`, return only the business fields needed by `adminsettings`; do not return `ConfigFile` or other owner-only sensitive fields
- `web-first` and onboarding flows must rely only on this redacted (脱敏) business snapshot

## Frontend Responsibilities

### `src/app/account-sync/page.tsx`

Owns:

- New layout orchestration (布局编排)
- Status loading
- Role checks
- Sync-scope state
- Manual sync entry

No longer owns:

- Diagnostics rendering

### `src/components/DesktopProfileSyncOnboardingCard.tsx`

Becomes a compact action card:

- When disabled, it only opens onboarding
- When enabled, it only runs `Sync Now`
- It no longer occupies a full row with long copy

The complex onboarding content still reuses the current modal and execution logic.

### New Scope Component

Recommended new component:

- `src/components/DesktopProfileSyncScopeCard.tsx`

Owns:

- Rendering sync-domain options
- Showing or hiding the admin-only option
- Emitting the selected scope back to the page layer

## State Matrix

### Disabled

- Left card: `未启用`
- Right card: `开启同步`
- Scope card: editable default scope

### Enabled and Healthy

- Left card: `已连接并已登录`
- Right card: `同步`
- Scope card: editable current scope

### Enabled but Unhealthy

- Left card: `需要处理`
- Right card: still allows `同步`
- One short error line in the card

### Local Service Read Failure

- Left card: `需要处理`
- Right card: sync button disabled
- Show `去配置`

## Test Requirements

### Frontend

- The helper copy under the title is removed
- The top area is a two-card row
- Diagnostics are removed
- Admin and normal users see different scope options
- Enabled state runs a request immediately when clicking `同步`
- Disabled state opens the existing onboarding flow when clicking `开启同步`

### Backend

- `adminsettings` is allowed only for `owner/admin`
- Normal-user submission of `adminsettings` is rejected
- Manual sync processes only selected domains
- `ConfigFile`, `UserConfig`, and `userPasswords` are never synced upstream
- `web-first` rebuilds a sanitized local `ConfigFile` while preserving local `auth.*` and `profile_sync.*`
- `/api/admin/config` returns a redacted business snapshot for `admin`

## Risks and Constraints

- The repo does not currently expose a ready-made frontend API for updating `syncDomains`; this round needs a new endpoint and returned status shape.
- Current onboarding attaches the admin-config snapshot only during the first primary-account migration. Long-term optional syncing requires promoting it into an explicit sync domain and switching to a controlled allowlist of fields.
- Desktop currently backfills `SourceConfig`, `CustomCategories`, `LiveConfig`, and player-enhancement state from raw `config.json`; without rebuilding a sanitized local `ConfigFile`, old identity data can flow back in and overwrite the intended sync result.
- `UserConfig.Tags` is coupled to `Users` and source-permission behavior. Keeping it inside `adminsettings` would indirectly rewrite user permissions and reintroduce account conflicts.
- After diagnostics are removed, error copy must stay short but precise, or users lose their troubleshooting path.

## Recommended Implementation Order

1. Define the `adminsettings` sync domain and backend validation
2. Add admin business-snapshot filtering and sanitized local `ConfigFile` rebuilding
3. Add the `sync-now` endpoint
4. Add redacted `/api/admin/config` responses for `admin`
5. Add the sync-scope card
6. Refactor the top row into two compact cards
7. Remove diagnostics and finish frontend/backend tests
