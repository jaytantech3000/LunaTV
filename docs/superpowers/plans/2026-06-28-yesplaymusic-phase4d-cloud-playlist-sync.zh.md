# YesPlayMusic Phase 4d 云端歌单联动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已登录 `Netease` 账号时的 `playlist` 保存语义切到远端歌单收藏 / 取消收藏，`My playlists` 与资料库歌单区即时刷新；未登录时继续保留本地歌单保存兜底。

**Architecture:** 在 provider 和 `/api/music/account/playlists/subscriptions` route 上补齐远端歌单收藏 mutation，再用独立 `music-account-playlists` 前端服务与 `music-account-store` / `music-library-store` 串起账号歌单状态。UI 保持当前壳层，只把登录态 `playlist` 从“本地保存合集”切成“云端歌单库联动”。

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Zustand, Jest, Testing Library

## Global Constraints

- 只在当前 `React + Next.js + Tauri` 重写线上补能力，不回接旧音乐系统。
- 默认 ASCII，禁止 `any`，保持现有 account route / provider / store 模式。
- 先写失败测试，再写最小实现，再跑定向测试与完整音乐回归。
- 已登录时仅 `playlist` 切到远端歌单收藏语义；`rank / album / artist-toplist` 继续本地保存。
- `savedCollections` 在登录态下不再承载远端 playlist 语义。
- 不新增歌单 CRUD、曲目增删、歌单排序和隐私编辑。

---

### Task 1: 补齐账号歌单角色与歌单收藏 provider / route

**Files:**

- Modify: `src/features/music/domain/entities.ts`
- Modify: `src/features/music/domain/repositories.ts`
- Modify: `src/features/music/services/providers/netease/client.ts`
- Modify: `src/features/music/services/providers/netease/mappers.ts`
- Modify: `src/features/music/services/providers/netease/repository.ts`
- Create: `src/app/api/music/account/playlists/subscriptions/route.ts`
- Modify: `src/features/music/tests/netease-repository.test.ts`
- Modify: `src/features/music/tests/music-account-routes.test.ts`

**Interfaces:**

- Produces:
  - `MusicCollectionSummaryEntity.accountPlaylistRole?: 'owned' | 'subscribed'`
  - `MusicAccountRepository.setPlaylistSubscribed(...)`
  - `POST /api/music/account/playlists/subscriptions`
  - `DELETE /api/music/account/playlists/subscriptions`

- [ ] Step 1: 在 `netease-repository.test.ts` 先写失败测试，覆盖：
  - 账号歌单 summary 区分 `owned / subscribed`
  - 收藏歌单后返回刷新后的账号歌单列表
  - 取消收藏歌单后返回刷新后的账号歌单列表
- [ ] Step 2: 在 `music-account-routes.test.ts` 先写失败测试，覆盖：
  - `POST /api/music/account/playlists/subscriptions` 成功返回刷新列表
  - `DELETE /api/music/account/playlists/subscriptions` 成功返回刷新列表
  - 无会话时返回 `401`
- [ ] Step 3: Run `pnpm jest src/features/music/tests/netease-repository.test.ts src/features/music/tests/music-account-routes.test.ts --runInBand`
- [ ] Step 4: 在 `entities.ts` 增加 playlist 角色字段。
- [ ] Step 5: 在 `repositories.ts` 增加 `setPlaylistSubscribed` contract。
- [ ] Step 6: 在 `client.ts` 增加歌单收藏 / 取消收藏 fetcher。
- [ ] Step 7: 在 `mappers.ts` 与 `repository.ts` 里补齐账号歌单角色映射和 mutation 后刷新逻辑。
- [ ] Step 8: 新增 `src/app/api/music/account/playlists/subscriptions/route.ts`，复用现有 session cookie 与 route-support 模式。
- [ ] Step 9: 重跑同一组测试，期望 PASS。

### Task 2: 新增账号歌单前端服务并让 account store / library store 账号感知

**Files:**

- Create: `src/features/music/services/music-account-playlists.ts`
- Modify: `src/features/music/state/music-account-store.ts`
- Modify: `src/features/music/state/music-library-store.ts`
- Modify: `src/features/music/tests/music-account-store.test.ts`
- Modify: `src/features/music/tests/music-library-store.test.ts`

**Interfaces:**

- Produces:
  - `subscribeMusicAccountPlaylist()`
  - `unsubscribeMusicAccountPlaylist()`
  - `useMusicAccountStore().togglePlaylistSubscription(...)`
  - `useMusicLibraryStore().toggleSavedCollection(...)` 的 playlist 远端分支

- [ ] Step 1: 在 `music-account-store.test.ts` 先写失败测试，覆盖：
  - 收藏歌单后刷新 `account.playlists`
  - 取消收藏歌单后刷新 `account.playlists`
  - 远端失败时保留旧 playlist 列表
- [ ] Step 2: 在 `music-library-store.test.ts` 先写失败测试，覆盖：
  - 登录态下 `toggleSavedCollection(playlist)` 走远端分支
  - 登录态下 hydrate 会过滤本地 playlist saved collections
  - 未登录时 `toggleSavedCollection(playlist)` 继续本地分支
  - `clearSavedCollections()` 不影响远端账号歌单
- [ ] Step 3: Run `pnpm jest src/features/music/tests/music-account-store.test.ts src/features/music/tests/music-library-store.test.ts --runInBand`
- [ ] Step 4: 实现 `music-account-playlists.ts`，封装账号歌单收藏 route。
- [ ] Step 5: 修改 `music-account-store.ts`，新增歌单收藏 mutation 和回滚逻辑。
- [ ] Step 6: 修改 `music-library-store.ts`：
  - 登录态下过滤本地 playlist saved collections
  - `toggleSavedCollection()` 在登录态 + playlist 时委托账号 store
  - 本地 clear 只清本地 pin
- [ ] Step 7: 重跑同一组测试，期望 PASS。

### Task 3: 调整资料库 / 合集页 / 侧边栏的云端歌单语义

**Files:**

- Modify: `src/features/music/components/MusicCollectionView.tsx`
- Modify: `src/features/music/components/MusicLibraryView.tsx`
- Modify: `src/features/music/components/MusicSidebar.tsx`
- Modify: `src/features/music/components/MusicTopBar.tsx`
- Modify: `src/features/music/tests/music-phase2-ui.test.tsx`
- Modify: `src/features/music/tests/music-sidebar.test.tsx`

**Interfaces:**

- Produces:
  - 已登录 playlist 页展示 `Collect playlist / Collected / In your playlists`
  - 已登录资料库新增 `My playlists` 区块
  - 收藏 / 取消收藏后 sidebar 列表即时刷新

- [ ] Step 1: 在 `music-phase2-ui.test.tsx` 与 `music-sidebar.test.tsx` 先写失败测试，覆盖：
  - 已登录 playlist 页按钮文案切成云端歌单语义
  - 自建歌单展示只读态
  - 收藏 / 取消收藏后 `My playlists` 数量与列表刷新
  - 已登录资料库出现账号歌单区块
  - 退出登录后恢复本地 `Save to library`
- [ ] Step 2: Run `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx src/features/music/tests/music-sidebar.test.tsx --runInBand`
- [ ] Step 3: 最小实现 UI 文案、按钮状态、账号歌单区块，不新开页面。
- [ ] Step 4: 重跑同一组测试，期望 PASS。

### Task 4: 跑整体验证

**Files:**

- Test only

**Interfaces:**

- Consumes: Task 1-3 完整实现
- Produces: 云端歌单联动纵切通过定向与完整音乐回归

- [ ] Step 1: Run

```bash
pnpm jest \
  src/features/music/tests/netease-repository.test.ts \
  src/features/music/tests/music-account-routes.test.ts \
  src/features/music/tests/music-account-store.test.ts \
  src/features/music/tests/music-library-store.test.ts \
  src/features/music/tests/music-phase2-ui.test.tsx \
  src/features/music/tests/music-sidebar.test.tsx \
  --runInBand
```

- [ ] Step 2: Run `pnpm jest src/features/music/tests src/app/music/page.test.tsx --runInBand`
- [ ] Step 3: Run `pnpm typecheck`
- [ ] Step 4: 若输出与预期不一致，按失败点修正；全部通过后再考虑提交。
