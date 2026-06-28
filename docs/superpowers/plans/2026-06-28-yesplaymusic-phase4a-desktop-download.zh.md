# YesPlayMusic Phase 4a 桌面下载 / 离线缓存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前 `/music` 重写线上补齐桌面优先的手动下载 MVP，让单曲和合集可下载到应用托管目录，并在播放时优先使用本地文件。

**Architecture:** 新增独立 `music-download` 资料域和前端 store，桌面文件下载与记录持久化全部交给 Tauri IPC。播放器只负责在“本地文件”和“远端 stream”之间做优先级解析，不引入新的播放内核。

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Zustand, Jest, Tauri 2, Rust, reqwest, serde

## Global Constraints

- 只在当前 `React + Next.js + Tauri` 重写线上补能力，不回接旧音乐系统。
- 默认 ASCII，禁止 `any`，保持现有 music store / desktop IPC / Tauri helper 模式。
- 第一刀只做手动下载、应用托管目录、本地优先播放，不做自定义目录、自动缓存、断点续传。
- 先写失败测试，再写最小实现，再跑定向测试与音乐回归。
- 下载记录持久化时禁止写入 `track.stream`。

---

### Task 1: 定义下载 contract 与前端 store

**Files:**

- Create: `src/features/music/services/music-download-records.ts`
- Create: `src/features/music/state/music-download-store.ts`
- Create: `src/features/music/tests/music-download-records.test.ts`
- Create: `src/features/music/tests/music-download-store.test.ts`
- Modify: `src/features/music/domain/entities.ts`

**Interfaces:**

- Produces:
  - `interface MusicDownloadRecord`
  - `createEmptyMusicDownloadState()`
  - `sanitizeMusicDownloadRecord()`
  - `buildMusicDownloadId(source, trackId, quality)`
  - `useMusicDownloadStore`

- [ ] Step 1: 写 `music-download-records.test.ts` 失败测试，覆盖 `stream` 清空、非法状态回退、缺失路径回退。
- [ ] Step 2: Run `pnpm jest src/features/music/tests/music-download-records.test.ts src/features/music/tests/music-download-store.test.ts --runInBand`
- [ ] Step 3: 最小实现 contract 和 store，保证下载记录可被稳定 hydrate / upsert / remove。
- [ ] Step 4: 再次运行同一组测试，期望 PASS。

### Task 2: 补齐 Tauri IPC 与桌面桥接

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/desktop/tauri-client.ts`
- Create: `src/features/music/services/music-downloads.ts`
- Create: `src/features/music/tests/music-downloads.desktop.test.ts`

**Interfaces:**

- Produces:
  - `listMusicDownloads()`
  - `downloadMusicTrack()`
  - `deleteMusicDownload()`
  - `resolveMusicDownloadPlayback()`
  - Tauri commands:
    - `list_music_downloads`
    - `download_music_track`
    - `delete_music_download`
    - `resolve_music_download_playback`

- [ ] Step 1: 写 `music-downloads.desktop.test.ts` 失败测试，覆盖桌面调用路径、非桌面拒绝、返回记录归一化。
- [ ] Step 2: Run `pnpm jest src/features/music/tests/music-downloads.desktop.test.ts --runInBand`
- [ ] Step 3: 在 Rust 侧新增 `music/downloads/records.json` 读写、文件下载、删除、路径解析辅助函数。
- [ ] Step 4: 在 `tauri-client.ts` 加 IPC wrapper，在 `music-downloads.ts` 加前端封装。
- [ ] Step 5: 再跑桌面桥接测试，期望 PASS。

### Task 3: 接入播放器本地优先解析

**Files:**

- Modify: `src/features/music/components/MusicPlayerRoot.tsx`
- Modify: `src/features/music/tests/music-player-root.test.tsx`

**Interfaces:**

- Consumes:
  - `resolveMusicDownloadPlayback()`
  - `hydrateMusicDownloads()`
- Produces:
  - 已下载曲目优先本地播放
  - 本地缺失时回退远端 `streamUrl`

- [ ] Step 1: 在 `music-player-root.test.tsx` 先写两个失败用例：
  - 已下载曲目会加载本地 `asset` URL
  - 本地解析失败时继续请求 `/api/music/track`
- [ ] Step 2: Run `pnpm jest src/features/music/tests/music-player-root.test.tsx --runInBand`
- [ ] Step 3: 最小修改 `MusicPlayerRoot` 的 hydrate 逻辑，把本地解析放在远端 track hydrate 之前。
- [ ] Step 4: 重跑播放器测试，期望 PASS。

### Task 4: 补 UI 入口与交互回归

**Files:**

- Modify: `src/features/music/components/MusicCollectionView.tsx`
- Modify: `src/features/music/components/MusicFullPlayer.tsx`
- Modify: `src/features/music/components/MusicLibraryView.tsx`
- Modify: `src/features/music/components/MusicSettingsView.tsx`
- Modify: `src/features/music/tests/music-phase2-ui.test.tsx`
- Modify: `src/features/music/tests/music-big-bang-smoke.test.tsx`

**Interfaces:**

- Produces:
  - 合集页 `Download all`
  - 单曲 `Download` / `Delete download`
  - 资料库 `Offline downloads`

- [ ] Step 1: 先写 UI 失败测试，验证下载按钮、下载后状态文案、资料库离线分区。
- [ ] Step 2: Run `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx src/features/music/tests/music-big-bang-smoke.test.tsx --runInBand`
- [ ] Step 3: 最小实现 UI 入口和调用逻辑，不新增独立页面。
- [ ] Step 4: 重跑 UI 测试，期望 PASS。

### Task 5: 跑整体验证

**Files:**

- Modify: `docs/superpowers/specs/2026-06-28-yesplaymusic-phase4a-desktop-download-design.zh.md`
- Modify: `docs/superpowers/specs/2026-06-28-yesplaymusic-phase4a-desktop-download-design.en.md`
- Modify: `docs/superpowers/plans/2026-06-28-yesplaymusic-phase4a-desktop-download.zh.md`
- Modify: `docs/superpowers/plans/2026-06-28-yesplaymusic-phase4a-desktop-download.en.md`

- [ ] Step 1: Run `pnpm jest src/features/music/tests/music-download-records.test.ts src/features/music/tests/music-download-store.test.ts src/features/music/tests/music-downloads.desktop.test.ts src/features/music/tests/music-player-root.test.tsx src/features/music/tests/music-phase2-ui.test.tsx src/features/music/tests/music-big-bang-smoke.test.tsx --runInBand`
- [ ] Step 2: Run `pnpm typecheck`
- [ ] Step 3: Run `pnpm desktop:test`
- [ ] Step 4: 若命令输出与预期不一致，按失败点修正；全部通过后再考虑提交。
