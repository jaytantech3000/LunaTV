# YesPlayMusic Phase 4c 最近播放同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已登录 `Netease` 账号时的 `Recently played` 链路切到远端最近播放，播放新曲目时能刷新远端列表；未登录时继续保留当前本地 recent tracks 兜底。`resumeTracks` 保持本地语义。

**Architecture:** 在 provider 和 `/api/music/account/recent-tracks` route 上补齐远端最近播放读写，再用独立 `music-recent-tracks` 服务层与 `music-library-store.reportRecentTrack()` 把 player root、library 和 settings 串起来。UI 保持现有壳层，只调整数据源与少量文案/动作语义。

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Zustand, Jest, Testing Library

## Global Constraints

- 只在当前 `React + Next.js + Tauri` 重写线上补能力，不回接旧音乐系统。
- 默认 ASCII，禁止 `any`，保持现有 account route / provider / store 模式。
- 先写失败测试，再写最小实现，再跑定向测试与完整音乐回归。
- 已登录时远端最近播放优先，未登录时保留本地 recent tracks 兜底。
- `resumeTracks` 继续读本地 play records，不做远端化。
- 不新增“清空网易云最近播放”这类破坏性账号动作。

---

### Task 1: 补齐 Netease 最近播放 provider 与 account recent-tracks route

**Files:**

- Modify: `src/features/music/domain/repositories.ts`
- Modify: `src/features/music/services/providers/netease/client.ts`
- Modify: `src/features/music/services/providers/netease/repository.ts`
- Create: `src/app/api/music/account/recent-tracks/route.ts`
- Modify: `src/features/music/tests/netease-repository.test.ts`
- Modify: `src/features/music/tests/music-account-routes.test.ts`

**Interfaces:**

- Produces:
  - `MusicAccountRepository.getRecentTracks(...)`
  - `MusicAccountRepository.reportTrackPlayed(...)`
  - `GET /api/music/account/recent-tracks`
  - `POST /api/music/account/recent-tracks`

- [ ] Step 1: 在 `netease-repository.test.ts` 先写失败测试，覆盖：
  - 可读取最近播放列表
  - 上报播放后返回刷新后的列表
- [ ] Step 2: 在 `music-account-routes.test.ts` 先写失败测试，覆盖：
  - `GET /api/music/account/recent-tracks` 成功返回列表
  - 无会话时返回 `401`
  - `POST` 返回刷新后的列表
- [ ] Step 3: Run `pnpm jest src/features/music/tests/netease-repository.test.ts src/features/music/tests/music-account-routes.test.ts --runInBand`
- [ ] Step 4: 在 `repositories.ts` 给 `MusicAccountRepository` 增加远端最近播放 contract。
- [ ] Step 5: 在 `client.ts` 增加最近播放相关 fetcher。
- [ ] Step 6: 在 `repository.ts` 实现 `getRecentTracks / reportTrackPlayed`，动作成功后返回刷新后的 recent list。
- [ ] Step 7: 新增 `src/app/api/music/account/recent-tracks/route.ts`，复用现有 session cookie 与 route-support 模式。
- [ ] Step 8: 重跑同一组测试，期望 PASS。

### Task 2: 新增统一 recent-tracks 服务并让 library store / player root 账号感知

**Files:**

- Create: `src/features/music/services/music-recent-tracks.ts`
- Create: `src/features/music/tests/music-recent-tracks.test.ts`
- Modify: `src/features/music/tests/music-library-store.test.ts`
- Modify: `src/features/music/tests/music-player-root.test.tsx`
- Modify: `src/features/music/state/music-library-store.ts`
- Modify: `src/features/music/components/MusicPlayerRoot.tsx`

**Interfaces:**

- Produces:
  - `listMusicRecentTracks()`
  - `reportMusicTrackPlayed()`
  - `useMusicLibraryStore().reportRecentTrack(...)`
  - `useMusicLibraryStore().recentTracks` 按账号态切换数据源

- [ ] Step 1: 在 `music-recent-tracks.test.ts` 先写失败测试，覆盖远端 route 封装、`401` 透传、返回列表归一化。
- [ ] Step 2: 在 `music-library-store.test.ts` 先写失败测试，覆盖：
  - 已登录时 hydrate 读取远端 recent tracks
  - 未登录时 hydrate 读取本地 recent tracks
  - `reportRecentTrack()` 按账号态走远端 / 本地分支
  - `resumeTracks` 不受影响
- [ ] Step 3: 在 `music-player-root.test.tsx` 先写失败测试，覆盖：
  - 已登录时播放曲目触发远端最近播放上报
  - 未登录时继续写本地 recent service
- [ ] Step 4: Run `pnpm jest src/features/music/tests/music-recent-tracks.test.ts src/features/music/tests/music-library-store.test.ts src/features/music/tests/music-player-root.test.tsx --runInBand`
- [ ] Step 5: 实现 `music-recent-tracks.ts`，把 account recent-tracks route 包成前端服务。
- [ ] Step 6: 修改 `music-library-store.ts`：
  - hydrate 时按 `musicAccount.authenticated` 选择远端 / 本地 recent tracks
  - 新增 `reportRecentTrack(track)` 统一入口
  - 远端错误时保留旧的 `recentTracks`
- [ ] Step 7: 修改 `MusicPlayerRoot.tsx`，把当前 recent 记录逻辑切到 `reportRecentTrack()`。
- [ ] Step 8: 重跑同一组测试，期望 PASS。

### Task 3: 调整账号摘要 / 设置页的最近播放语义

**Files:**

- Modify: `src/features/music/components/MusicAccountCard.tsx`
- Modify: `src/features/music/components/MusicSettingsView.tsx`
- Modify: `src/features/music/components/MusicTopBar.tsx`
- Modify: `src/features/music/tests/music-sidebar.test.tsx`
- Modify: `src/features/music/tests/music-phase2-ui.test.tsx`

**Interfaces:**

- Produces:
  - 已登录时账号摘要说明 recent plays 也会同步
  - 已登录时设置页 `Recent plays` 保留数量，但不再出现本地清空动作
  - 退出登录后恢复本地 clear 语义

- [ ] Step 1: 在 `music-sidebar.test.tsx` 与 `music-phase2-ui.test.tsx` 先写失败测试，覆盖：
  - 账号卡详情文案包含 recent plays sync
  - 设置页登录态下不再出现 `Clear recent plays`
  - 退出登录后恢复本地 clear 语义
- [ ] Step 2: Run `pnpm jest src/features/music/tests/music-sidebar.test.tsx src/features/music/tests/music-phase2-ui.test.tsx --runInBand`
- [ ] Step 3: 最小实现 UI 文案与动作边界，不新开页面。
- [ ] Step 4: 重跑同一组测试，期望 PASS。

### Task 4: 跑整体验证

**Files:**

- Test only

**Interfaces:**

- Consumes: Task 1-3 完整实现
- Produces: 最近播放同步纵切通过定向与完整音乐回归

- [ ] Step 1: Run

```bash
pnpm jest \
  src/features/music/tests/netease-repository.test.ts \
  src/features/music/tests/music-account-routes.test.ts \
  src/features/music/tests/music-recent-tracks.test.ts \
  src/features/music/tests/music-library-store.test.ts \
  src/features/music/tests/music-player-root.test.tsx \
  src/features/music/tests/music-sidebar.test.tsx \
  src/features/music/tests/music-phase2-ui.test.tsx \
  --runInBand
```

- [ ] Step 2: Run `pnpm jest src/features/music/tests src/app/music/page.test.tsx --runInBand`
- [ ] Step 3: Run `pnpm typecheck`
- [ ] Step 4: 若输出与预期不一致，按失败点修正；全部通过后再考虑提交。
