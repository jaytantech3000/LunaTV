# YesPlayMusic Phase 4b 喜欢歌曲同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已登录 `Netease` 账号时的 `Saved tracks / Save` 链路切到远端“我喜欢的音乐”，未登录时继续保留当前本地收藏兜底。

**Architecture:** 在 provider 和 `/api/music/account/likes` route 上补齐远端喜欢歌曲读写，再用一个独立 `music-liked-tracks` 服务层把 library store 变成账号感知。UI 保持现有壳层，只调整文案、数量和按钮动作语义。

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Zustand, Jest, Testing Library

## Global Constraints

- 只在当前 `React + Next.js + Tauri` 重写线上补能力，不回接旧音乐系统。
- 默认 ASCII，禁止 `any`，保持现有 account route / provider / store 模式。
- 先写失败测试，再写最小实现，再跑定向测试与完整音乐回归。
- 已登录时远端喜欢歌曲优先，未登录时保留本地 favorites 兜底。
- 不自动上传、不删除、不覆盖现有本地 favorites 数据。

---

### Task 1: 补齐 Netease 喜欢歌曲 provider 与 account likes route

**Files:**

- Modify: `src/features/music/domain/repositories.ts`
- Modify: `src/features/music/services/providers/netease/client.ts`
- Modify: `src/features/music/services/providers/netease/repository.ts`
- Create: `src/app/api/music/account/likes/route.ts`
- Modify: `src/features/music/tests/netease-repository.test.ts`
- Modify: `src/features/music/tests/music-account-routes.test.ts`

**Interfaces:**

- Produces:
  - `MusicAccountRepository.getLikedTracks(...)`
  - `MusicAccountRepository.setTrackLiked(...)`
  - `GET /api/music/account/likes`
  - `POST /api/music/account/likes`
  - `DELETE /api/music/account/likes`

- [ ] Step 1: 在 `netease-repository.test.ts` 先写失败测试，覆盖：
  - 可读取喜欢歌曲列表
  - 喜欢后返回刷新后的列表
  - 取消喜欢后返回刷新后的列表
- [ ] Step 2: 在 `music-account-routes.test.ts` 先写失败测试，覆盖：
  - `GET /api/music/account/likes` 成功返回列表
  - 无会话时返回 `401`
  - `POST / DELETE` 返回刷新后的列表
- [ ] Step 3: Run `pnpm jest src/features/music/tests/netease-repository.test.ts src/features/music/tests/music-account-routes.test.ts --runInBand`
- [ ] Step 4: 在 `repositories.ts` 给 `MusicAccountRepository` 增加远端喜欢歌曲 contract。
- [ ] Step 5: 在 `client.ts` 增加喜欢歌曲相关 fetcher，优先按 liked playlist 详情实现。
- [ ] Step 6: 在 `repository.ts` 实现 `getLikedTracks / setTrackLiked`，动作成功后返回刷新后的 liked list。
- [ ] Step 7: 新增 `src/app/api/music/account/likes/route.ts`，复用现有 session cookie 与 route-support 模式。
- [ ] Step 8: 重跑同一组测试，期望 PASS。

### Task 2: 新增统一 liked-tracks 服务并让 library store 账号感知

**Files:**

- Create: `src/features/music/services/music-liked-tracks.ts`
- Create: `src/features/music/tests/music-liked-tracks.test.ts`
- Create: `src/features/music/tests/music-library-store.test.ts`
- Modify: `src/features/music/state/music-library-store.ts`

**Interfaces:**

- Produces:
  - `listMusicLikedTracks()`
  - `likeMusicTrack()`
  - `unlikeMusicTrack()`
  - `useMusicLibraryStore().favoriteTracks` 按账号态切换数据源

- [ ] Step 1: 在 `music-liked-tracks.test.ts` 先写失败测试，覆盖远端 route 封装、`401` 透传、返回列表归一化。
- [ ] Step 2: 在 `music-library-store.test.ts` 先写失败测试，覆盖：
  - 已登录时 hydrate 读取远端 liked tracks
  - 未登录时 hydrate 读取本地 favorites
  - 远端 toggle 失败时保留旧状态
- [ ] Step 3: Run `pnpm jest src/features/music/tests/music-liked-tracks.test.ts src/features/music/tests/music-library-store.test.ts --runInBand`
- [ ] Step 4: 实现 `music-liked-tracks.ts`，把 account likes route 包成前端服务。
- [ ] Step 5: 修改 `music-library-store.ts`：
  - hydrate 时按 `musicAccount.authenticated` 选择远端 / 本地 favorites
  - toggle 时按账号态切分远端 / 本地分支
  - 远端错误时保留旧的 `favoriteTracks`
- [ ] Step 6: 重跑同一组测试，期望 PASS。

### Task 3: 调整播放器 / 资料库 / 账号摘要的账号感知文案与动作

**Files:**

- Modify: `src/features/music/components/MusicFullPlayer.tsx`
- Modify: `src/features/music/components/MusicLibraryView.tsx`
- Modify: `src/features/music/components/MusicAccountCard.tsx`
- Modify: `src/features/music/components/MusicTopBar.tsx`
- Modify: `src/features/music/components/MusicSettingsView.tsx`
- Modify: `src/features/music/tests/music-player-ui.test.tsx`
- Modify: `src/features/music/tests/music-sidebar.test.tsx`
- Modify: `src/features/music/tests/music-phase2-ui.test.tsx`

**Interfaces:**

- Produces:
  - 已登录时 `Like / Liked / Liked songs`
  - 已退出时恢复 `Save / Saved / Saved tracks`

- [ ] Step 1: 在 `music-player-ui.test.tsx` 先写失败测试，覆盖已登录时全屏播放器显示 `Like / Liked`。
- [ ] Step 2: 在 `music-sidebar.test.tsx` 与 `music-phase2-ui.test.tsx` 先写失败测试，覆盖：
  - 账号卡片与资料库切到 `Liked`
  - 退出登录后恢复本地 `Saved` 语义
- [ ] Step 3: Run `pnpm jest src/features/music/tests/music-player-ui.test.tsx src/features/music/tests/music-sidebar.test.tsx src/features/music/tests/music-phase2-ui.test.tsx --runInBand`
- [ ] Step 4: 最小实现 UI 文案与账号感知按钮语义，不新开页面。
- [ ] Step 5: 重跑同一组测试，期望 PASS。

### Task 4: 跑整体验证

**Files:**

- Test only

**Interfaces:**

- Consumes: Task 1-3 完整实现
- Produces: 喜欢歌曲同步纵切通过定向与完整音乐回归

- [ ] Step 1: Run

```bash
pnpm jest \
  src/features/music/tests/netease-repository.test.ts \
  src/features/music/tests/music-account-routes.test.ts \
  src/features/music/tests/music-liked-tracks.test.ts \
  src/features/music/tests/music-library-store.test.ts \
  src/features/music/tests/music-player-ui.test.tsx \
  src/features/music/tests/music-sidebar.test.tsx \
  src/features/music/tests/music-phase2-ui.test.tsx \
  --runInBand
```

- [ ] Step 2: Run `pnpm jest src/features/music/tests src/app/music/page.test.tsx --runInBand`
- [ ] Step 3: Run `pnpm typecheck`
- [ ] Step 4: 若输出与预期不一致，按失败点修正；全部通过后再考虑提交。
