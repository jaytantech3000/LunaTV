# LunaTV YesPlayMusic 音乐模块重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 LunaTV 内交付一个按 YesPlayMusic 交互语义重构后的完整音乐播放器系统。

**Architecture:** 保留现有 `audio + MusicPlayerRoot + provider` 核心链路，只重构播放器状态模型、底部控制条、展开态播放器和音乐页信息架构。所有行为变化先由 Jest 用例固定，再做最小实现与视觉收口。

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand, Jest, Testing Library, Tailwind CSS

## Global Constraints

- 不重写现有 `audio` 元素播放链路
- 不直接复制 YesPlayMusic 源代码
- 保留多来源 provider 架构和现有错误降级
- TypeScript 继续保持 `strict: true`
- 不使用 `any`
- 文档保持中英双语

---

### Task 1: 固定 YesPlayMusic 风格播放器行为

**Files:**

- Modify: `src/components/music/MusicMiniPlayer.test.tsx`
- Modify: `src/components/music/MusicFullscreenPlayer.test.tsx`
- Modify: `src/components/music/MusicPlayerRoot.test.tsx`
- Modify: `src/stores/musicPlayerStore.test.ts`

- [ ] 增加底栏按钮行为测试：队列、歌词、重复、随机、音量
- [ ] 增加展开态默认面板切换测试
- [ ] 增加音频结束时在不同重复 / 随机场景下的切歌测试
- [ ] 运行：`pnpm jest src/components/music/MusicMiniPlayer.test.tsx src/components/music/MusicFullscreenPlayer.test.tsx src/components/music/MusicPlayerRoot.test.tsx src/stores/musicPlayerStore.test.ts --runInBand`

### Task 2: 重构播放器状态模型

**Files:**

- Modify: `src/lib/music/types.ts`
- Modify: `src/lib/music/format.ts`
- Modify: `src/stores/musicPlayerStore.ts`
- Modify: `src/stores/musicPlayerStore.test.ts`

- [ ] 把 `playMode` 拆为 `repeatMode` 与 `shuffleEnabled`
- [ ] 实现新的 `playNext` / `playPrevious` / `cycleRepeatMode` / `toggleShuffle`
- [ ] 保持持久化兼容，处理旧状态迁移
- [ ] 运行：`pnpm jest src/stores/musicPlayerStore.test.ts --runInBand`

### Task 3: 重构底部控制条与展开态播放器

**Files:**

- Modify: `src/components/music/MusicMiniPlayer.tsx`
- Modify: `src/components/music/MusicFullscreenPlayer.tsx`
- Modify: `src/components/music/MusicQueuePanel.tsx`
- Modify: `src/components/music/MusicLyricsPanel.tsx`
- Modify: `src/components/music/MusicMiniPlayer.test.tsx`
- Modify: `src/components/music/MusicFullscreenPlayer.test.tsx`

- [ ] 让底栏改为三段式 YesPlayMusic 结构
- [ ] 增加队列按钮、歌词按钮、重复按钮、随机按钮、收藏入口
- [ ] 让展开态支持从 mini player 指定默认打开歌词或队列
- [ ] 统一歌词空态与队列空态样式
- [ ] 运行：`pnpm jest src/components/music/MusicMiniPlayer.test.tsx src/components/music/MusicFullscreenPlayer.test.tsx --runInBand`

### Task 4: 调整 MusicPlayerRoot 装配逻辑

**Files:**

- Modify: `src/components/music/MusicPlayerRoot.tsx`
- Modify: `src/components/music/MusicPlayerRoot.test.tsx`

- [ ] 接入新的重复 / 随机状态与按钮回调
- [ ] 增加展开态默认面板控制
- [ ] 保持收藏、最近播放、播放记录逻辑稳定
- [ ] 运行：`pnpm jest src/components/music/MusicPlayerRoot.test.tsx --runInBand`

### Task 5: 重构音乐页信息架构

**Files:**

- Modify: `src/components/music/MusicPageClient.tsx`
- Modify: `src/components/music/MusicCollectionGrid.tsx`
- Modify: `src/components/music/MusicTrackList.tsx`
- Modify: `src/components/music/MusicSourceTabs.tsx`
- Modify: `src/components/music/MusicSectionTabs.tsx`
- Modify: `src/components/music/MusicPageClient.test.tsx`

- [ ] 去掉营销型 Hero，改成播放器产品布局
- [ ] 统一来源导航、分区导航、集合详情头部和曲目列表
- [ ] 保持来源切换、搜索、曲库、合集播放都走统一队列入口
- [ ] 运行：`pnpm jest src/components/music/MusicPageClient.test.tsx --runInBand`

### Task 6: 集成验证、提交与 beta 构建

**Files:**

- Modify: `docs/superpowers/specs/2026-06-28-yesplaymusic-music-refactor-design.zh.md`
- Modify: `docs/superpowers/specs/2026-06-28-yesplaymusic-music-refactor-design.en.md`
- Modify: `docs/superpowers/plans/2026-06-28-yesplaymusic-music-refactor.zh.md`
- Modify: `docs/superpowers/plans/2026-06-28-yesplaymusic-music-refactor.en.md`

- [ ] 运行：`pnpm jest src/components/music src/stores/musicPlayerStore.test.ts src/app/api/music/routes.test.ts --runInBand`
- [ ] 运行：`pnpm typecheck`
- [ ] 运行：`pnpm build`
- [ ] 运行 beta 构建命令并确认产物
- [ ] 提交：`git commit -m "feat(music): refactor player to yesplaymusic layout"`
- [ ] 推送当前分支
