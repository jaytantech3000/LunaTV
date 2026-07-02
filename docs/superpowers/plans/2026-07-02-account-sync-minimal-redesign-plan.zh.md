# 帐号同步页极简改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/account-sync` 改造成“双卡 + 同步范围卡”的极简桌面同步页，并补齐 `adminsettings` 与手动同步链路。

**Architecture:** 先补后端 profile sync 配置与手动同步接口，再补前端 scope 管理与紧凑操作卡，最后收口页面布局和端到端状态反馈。现有 onboarding 弹窗继续复用，复杂迁移逻辑不重写，只把主页面改成动作入口。

**Tech Stack:** Next.js App Router、React、TypeScript、Jest、Rust、Axum、Tauri local service

## Global Constraints

- 必须遵守现有 spec：删除标题下说明、删除诊断详情、顶部双卡、增加同步范围卡。
- 默认同步域保持 `playrecords` `favorites` `follows` `searchhistory` `skipconfigs`，新增 `adminsettings`。
- 未开启状态继续复用现有 onboarding 流程，不把大表单留在主页面。
- 只能修改当前需求相关文件，不回滚工作区内其他脏改动。
- 所有行为改动必须先写失败测试，再写最小实现。

---

### Task 1: 补齐 profile sync 域模型与手动同步接口

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

  - `PROFILE_SYNC_USER_DATA_DOMAINS` 扩展为含 `adminsettings`
  - `type ProfileSyncUserDataDomain = ... | 'adminsettings'`
  - `interface DesktopProfileSyncManualSyncRequest { syncDomains: readonly string[] }`
  - `interface DesktopProfileSyncManualSyncResponse extends DesktopProfileSyncStatus { lastSyncError?: string | null }`
  - `async function syncDesktopProfileNow(payload: DesktopProfileSyncManualSyncRequest): Promise<DesktopProfileSyncManualSyncResponse>`

- [ ] **Step 1: Write the failing tests**

```ts
it('posts sync-now through the desktop local service', async () => {
  const responsePayload = {
    enabled: true,
    reachable: true,
    authenticated: true,
    username: 'admin',
    role: 'owner',
    storageType: 'redis',
    profileMode: 'shared-multi-user',
    error: null,
    errorKind: null,
    syncDomains: ['playrecords', 'adminsettings'],
    lastSyncError: null,
  };

  (apiFetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(responsePayload),
  });

  await expect(
    syncDesktopProfileNow({
      syncDomains: ['playrecords', 'adminsettings'],
    })
  ).resolves.toEqual(responsePayload);

  expect(apiFetch).toHaveBeenCalledWith('/profile-sync/sync-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      syncDomains: ['playrecords', 'adminsettings'],
    }),
    cache: 'no-store',
  });
});
```

```rust
#[tokio::test]
async fn profile_sync_status_endpoint_exposes_adminsettings_when_present() {
    // 写入带 sync_domains 的 profile_sync 配置，断言 status 返回 adminsettings
}

#[tokio::test]
async fn profile_sync_sync_now_rejects_adminsettings_for_non_admin_role() {
    // 模拟远端 role=user，提交 adminsettings，断言 400/502 和错误文案
}

#[tokio::test]
async fn profile_sync_sync_now_merges_only_selected_domains() {
    // 仅提交 favorites，断言远端 merge payload 只包含 favorites
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec jest src/lib/desktop/profile-sync.test.ts --runInBand
cargo test -p moontv-local-service profile_sync_sync_now -- --nocapture
```

Expected:

- TS 测试因 `syncDesktopProfileNow` 未定义失败
- Rust 测试因 `/api/profile-sync/sync-now` 不存在或行为不匹配失败

- [ ] **Step 3: Write the minimal implementation**

```ts
export interface DesktopProfileSyncManualSyncRequest {
  syncDomains: readonly string[];
}

export interface DesktopProfileSyncManualSyncResponse
  extends DesktopProfileSyncStatus {
  lastSyncError?: string | null;
}

export async function syncDesktopProfileNow(
  payload: DesktopProfileSyncManualSyncRequest
): Promise<DesktopProfileSyncManualSyncResponse> {
  const response = await apiFetch('/profile-sync/sync-now', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  return readDesktopProfileSyncJsonResponse<DesktopProfileSyncManualSyncResponse>(
    response
  );
}
```

```rust
pub const PROFILE_SYNC_USER_DATA_DOMAINS: [&str; 6] = [
    "playrecords",
    "favorites",
    "follows",
    "searchhistory",
    "skipconfigs",
    "adminsettings",
];
```

```rust
.route("/api/profile-sync/sync-now", post(post_profile_sync_sync_now))
```

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileSyncSyncNowRequest {
    sync_domains: Vec<String>,
}
```

```rust
async fn post_profile_sync_sync_now(
    State(state): State<AppState>,
    Json(payload): Json<ProfileSyncSyncNowRequest>,
) -> AppResult<Response> {
    // 校验 enabled / sync_domains / admin role
    // 读取本地快照并按域裁剪 merge payload
    // 返回最新 status + lastSyncError
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec jest src/lib/desktop/profile-sync.test.ts --runInBand
cargo test -p moontv-local-service profile_sync_ -- --nocapture
```

Expected:

- 新增 TS 测试 PASS
- Rust 新增测试 PASS

### Task 2: 实现同步范围卡与紧凑操作卡

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
  - `DesktopProfileSyncOnboardingCard` 新增：
    - `selectedSyncDomains?: readonly string[]`
    - `isAdminRole?: boolean`
    - `onSyncSuccess?: (nextStatus: DesktopProfileSyncManualSyncResponse) => void`

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows adminsettings only for admin roles', () => {
  render(
    <DesktopProfileSyncScopeCard
      selectedDomains={['playrecords']}
      isAdminRole
      onChange={jest.fn()}
    />
  );

  expect(screen.getByLabelText('管理员设置')).toBeInTheDocument();
});

it('hides adminsettings for non-admin roles', () => {
  render(
    <DesktopProfileSyncScopeCard
      selectedDomains={['playrecords']}
      isAdminRole={false}
      onChange={jest.fn()}
    />
  );

  expect(screen.queryByLabelText('管理员设置')).not.toBeInTheDocument();
});
```

```tsx
it('runs sync-now immediately when enabled', async () => {
  render(
    <DesktopProfileSyncOnboardingCard
      currentLocalUsername='local-owner'
      profileSyncEnabled
      selectedSyncDomains={['playrecords']}
      isAdminRole
    />
  );

  fireEvent.click(screen.getByRole('button', { name: '同步' }));

  await waitFor(() => {
    expect(mockSyncDesktopProfileNow).toHaveBeenCalledWith({
      syncDomains: ['playrecords'],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec jest src/components/DesktopProfileSyncScopeCard.test.tsx src/components/DesktopProfileSyncOnboardingCard.test.tsx --runInBand
```

Expected:

- scope 组件缺失
- 已开启态仍没有 `同步` 即时行为

- [ ] **Step 3: Write the minimal implementation**

```tsx
export default function DesktopProfileSyncScopeCard({
  selectedDomains,
  isAdminRole,
  disabled = false,
  onChange,
}: DesktopProfileSyncScopeCardProps) {
  const options = isAdminRole
    ? [...PROFILE_SYNC_USER_DATA_DOMAINS]
    : PROFILE_SYNC_USER_DATA_DOMAINS.filter(
        (domain) => domain !== 'adminsettings'
      );

  return <section>{/* 复选项渲染 */}</section>;
}
```

```tsx
const handleSyncNow = async () => {
  const nextStatus = await syncDesktopProfileNow({
    syncDomains: [...selectedSyncDomains],
  });
  onSyncSuccess?.(nextStatus);
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec jest src/components/DesktopProfileSyncScopeCard.test.tsx src/components/DesktopProfileSyncOnboardingCard.test.tsx --runInBand
```

Expected:

- 两组组件测试 PASS

### Task 3: 收口 `/account-sync` 页面布局与页面级状态

**Files:**

- Modify: `src/app/account-sync/page.tsx`
- Modify: `src/app/account-sync/page.test.tsx`
- Modify: `src/lib/desktop/profile-sync-status-copy.ts`
- Modify: `src/lib/desktop/profile-sync-status-copy.test.ts`

**Interfaces:**

- Consumes: `DesktopProfileSyncScopeCard`, `DesktopProfileSyncOnboardingCard`, `syncDesktopProfileNow`
- Produces:

  - 页面级 scope state
  - 页面级 sync success/error feedback
  - 无诊断区的新布局

- [ ] **Step 1: Write the failing tests**

```tsx
it('removes the helper copy and diagnostics block', async () => {
  render(<AccountSyncPage />);

  expect(screen.queryByText(/这里只保留帐号同步状态/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /诊断详情/ })
  ).not.toBeInTheDocument();
});

it('renders summary and action cards in the top row with the scope card below', async () => {
  render(<AccountSyncPage />);

  expect(screen.getByText('同步状态摘要')).toBeInTheDocument();
  expect(screen.getByText('开启帐号同步')).toBeInTheDocument();
  expect(screen.getByText('管理同步范围')).toBeInTheDocument();
});
```

```tsx
it('shows adminsettings inside the scope card for admin roles', async () => {
  render(<AccountSyncPage />);
  expect(await screen.findByLabelText('管理员设置')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec jest src/app/account-sync/page.test.tsx src/lib/desktop/profile-sync-status-copy.test.ts --runInBand
```

Expected:

- 旧说明文字仍存在
- 旧诊断区仍存在
- 新范围卡与新布局断言失败

- [ ] **Step 3: Write the minimal implementation**

```tsx
<section className='grid gap-4 lg:grid-cols-2'>
  <SummaryCard />
  <DesktopProfileSyncOnboardingCard ... />
</section>

<DesktopProfileSyncScopeCard
  selectedDomains={selectedSyncDomains}
  isAdminRole={isAdminRole}
  onChange={setSelectedSyncDomains}
/>
```

```tsx
// 删除标题下说明文字
// 删除 DesktopProfileSyncDiagnosticsGrid
// 摘要卡仅保留状态 + 帐号 + 简短状态行
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec jest src/app/account-sync/page.test.tsx src/lib/desktop/profile-sync-status-copy.test.ts --runInBand
```

Expected:

- 页面测试 PASS
- 文案/范围 helper 测试 PASS

### Task 4: 全量验证并启动桌面壳

**Files:**

- Verify only

**Interfaces:**

- Consumes: Tasks 1-3 outputs
- Produces: verified desktop shell for visual review

- [ ] **Step 1: Run focused test suites**

Run:

```bash
pnpm exec jest src/lib/desktop/profile-sync.test.ts src/components/DesktopProfileSyncScopeCard.test.tsx src/components/DesktopProfileSyncOnboardingCard.test.tsx src/app/account-sync/page.test.tsx src/lib/desktop/profile-sync-status-copy.test.ts --runInBand
cargo test -p moontv-local-service profile_sync_ -- --nocapture
```

Expected: PASS

- [ ] **Step 2: Run static verification**

Run:

```bash
pnpm exec eslint src/app/account-sync/page.tsx src/app/account-sync/page.test.tsx src/components/DesktopProfileSyncScopeCard.tsx src/components/DesktopProfileSyncScopeCard.test.tsx src/components/DesktopProfileSyncOnboardingCard.tsx src/components/DesktopProfileSyncOnboardingCard.test.tsx src/lib/desktop/profile-sync.ts src/lib/desktop/profile-sync.test.ts src/lib/desktop/profile-sync-status-copy.ts src/lib/desktop/profile-sync-status-copy.test.ts
pnpm exec tsc --noEmit --incremental false --pretty false
```

Expected: PASS

- [ ] **Step 3: Launch the desktop shell**

Run:

```bash
pnpm desktop:dev
```

Expected:

- 桌面壳启动成功
- `/account-sync` 可人工检查
