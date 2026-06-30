# 桌面帐号同步开通实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把桌面帐号同步开通改成 `desktop-admin` 内的完整迁移向导，并保证离线下载在切换到 Web 帐号时不被清空。

**Architecture:** 桌面前端继续通过本地 Rust 服务访问 Web。Web 端新增资料合并接口；本地服务新增预览/执行编排接口；前端新增向导和下载 owner 安全切换逻辑。

**Tech Stack:** Next.js App Router, TypeScript, Jest, Rust, Axum, reqwest, Tauri IPC

## Global Constraints

- 默认生产地址固定为 `https://luna.hkcu.qzz.io`
- 开通入口只放在 `desktop-admin`
- 当前登录本地帐号映射到当前登录 Web 帐号
- 其他本地帐号映射到同名 Web 帐号，不存在则自动创建，初始密码 `123456`
- 迁移域只包含播放记录、收藏、追更、搜索历史、跳过片头片尾配置
- 只重绑当前剩余离线下载，不删除文件
- 全程先写失败测试，再补最小实现

---

### Task 1: Web 资料合并核心

**Files:**

- Create: `src/lib/profile-sync/desktop-merge.ts`
- Create: `src/lib/profile-sync/desktop-merge.test.ts`
- Create: `src/app/api/admin/profile-sync/merge/route.ts`

**Interfaces:**

- Produces: `mergeDesktopProfileSnapshot(remoteSnapshot, localSnapshot, strategy)`
- Produces: `POST /api/admin/profile-sync/merge`

- [ ] 写 keyed domain/search history 合并失败测试
- [ ] 运行 Jest，确认按预期失败
- [ ] 实现最小合并纯函数
- [ ] 再跑 Jest，确认转绿
- [ ] 实现 route 的权限校验、目标用户校验、合并写回
- [ ] 跑 route/ helper 相关测试

### Task 2: 本地服务开通编排

**Files:**

- Create: `crates/moontv-local-service/src/profile_sync_onboarding.rs`
- Modify: `crates/moontv-local-service/src/lib.rs`
- Modify: `crates/moontv-local-service/src/profile_sync.rs`
- Modify: `crates/moontv-sync/src/lib.rs`（仅在确实需要公共 helper 时）

**Interfaces:**

- Produces: `POST /api/admin/profile-sync/onboarding/preview`
- Produces: `POST /api/admin/profile-sync/onboarding/execute`

- [ ] 写帐号映射、配置写回、下载重绑纯函数失败测试
- [ ] 运行 `cargo test` 目标测试，确认失败
- [ ] 实现预览/执行数据结构与纯函数
- [ ] 实现远端登录、管理员配置读取、缺失用户自动创建
- [ ] 实现逐帐号资料迁移与本地配置写回
- [ ] 运行相关 `cargo test`，确认转绿

### Task 3: 桌面离线下载安全切换

**Files:**

- Modify: `src/lib/download/session.ts`
- Modify: `src/lib/download/session.test.ts`
- Modify: `src/components/DesktopDownloadStoreSync.tsx`
- Modify: `src/components/DesktopDownloadStoreSync.test.tsx`

**Interfaces:**

- Produces: `armDesktopDownloadOwnershipHandoff(...)`
- Produces: sync 切换时 owner 变化不触发 purge

- [ ] 写 handoff/rebind 失败测试
- [ ] 运行 Jest，确认失败
- [ ] 实现浏览器侧 owner 安全重绑
- [ ] 实现 runtime 刷新后重新拉本地下载快照
- [ ] 运行相关 Jest 测试，确认转绿

### Task 4: desktop-admin 向导

**Files:**

- Create: `src/components/DesktopProfileSyncOnboardingCard.tsx`
- Create: `src/components/DesktopProfileSyncOnboardingCard.test.tsx`
- Modify: `src/app/desktop-admin/page.tsx`
- Modify: `src/components/DesktopSettingsSection.tsx`

**Interfaces:**

- Produces: 可视化开通流程
- Consumes: 本地服务 preview/execute 接口

- [ ] 写默认地址、预览、执行成功提示、初始密码提示失败测试
- [ ] 运行 Jest，确认失败
- [ ] 实现同步卡片和向导
- [ ] 把入口接到 `desktop-admin`
- [ ] 更新旧文案，去掉“手动改 JSON 才能开 sync”的主路径描述
- [ ] 运行相关 Jest 测试，确认转绿

### Task 5: 验证

**Files:**

- No code changes expected

**Interfaces:**

- Verifies: Web helper/route、本地服务、下载 owner 切换、desktop-admin UI

- [ ] 运行相关 Jest 测试
- [ ] 运行相关 Rust 测试
- [ ] 运行 `pnpm typecheck`
- [ ] 复查需求清单，确认默认地址、自动建号、初始密码提示、离线下载不清空都已覆盖
