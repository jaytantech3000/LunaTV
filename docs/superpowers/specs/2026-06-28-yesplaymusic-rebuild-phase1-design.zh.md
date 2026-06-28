# LunaTV 音乐系统从零复刻 Phase 1 Big-Bang 设计

**目标**

以 `YesPlayMusic` 的信息架构、播放器交互和页面组织为参考，在当前 `React + Next.js + Tauri` 宿主内从零重建音乐子系统，并直接替换现有 `/music` 正式入口。Phase 1 采用 `big-bang` 路径：先删除旧音乐系统，再在同一路径上重建新的应用壳层与播放核心。

**完整项目拆分**

完整复刻拆成 5 个可独立推进的子项目：

1. 应用壳层：`/music` 布局、导航、主题、响应式结构
2. 播放核心：mini player、全屏播放器、歌词、队列、快捷键、媒体会话
3. 数据域：搜索、歌单、专辑、歌手、歌词、流地址、统一 provider 协议
4. 账号能力：登录、我的歌单、收藏、历史、每日推荐、FM、设置
5. 桌面集成：Tauri 媒体键、托盘、缓存、下载、本地桌面能力

本设计文档只覆盖 **Phase 1 = 子项目 1 + 2**。完整目标仍然是后续把数据域、账号能力和桌面能力全部补齐，但当前阶段先完成“删旧 + 重建新壳层和播放内核”。

**范围**

- 直接删除旧 `components/music`、`lib/music`、`musicPlayerStore`、旧 `/api/music/*` 和旧音频流路由
- 在正式 `/music` 路径上重建新的页面壳层，不创建 `/music-v2` 或其他并行回退入口
- 新建独立 `src/features/music/` 目录，承载新的组件、状态、服务和领域模型
- 重建播放器内核相关状态层，包括队列、播放状态、surface 展现状态、歌词同步状态
- 重建 mini player、expanded player、lyrics panel、queue panel、快捷键和媒体会话绑定
- 允许在 Phase 1 使用 fixture / mock 数据，只要新边界已经独立跑通
- 为后续 Phase 2 数据域接入预留统一 repository / adapter 边界

**不做**

- 不保留旧 `/music` 作为回退面
- 不复用旧 `MusicPlayerRoot`、旧 `musicPlayerStore`、旧 `music-client` 或旧 provider 实现
- 不在 Phase 1 接入登录、每日推荐、评论、FM、设置页或托盘等完整产品面
- 不在 Phase 1 同时完成全部真实数据来源联通
- 不为了兼容旧实现而保留双轨组件或双轨状态层

**现状结论**

- 当前音乐能力已经分散挂接在布局、侧边栏、移动底栏、`/music` 路由、`/api/music/*`、`lib/music/*` 和 `musicPlayerStore`
- 旧系统的 UI、播放状态和 provider 数据边界耦合过紧，不适合作为“从零复刻”的基础
- 用户已明确接受 `big-bang` 路径，即开发期间 `/music` 可以短时间处于重建状态，不需要并行回退版本

**核心方案**

1. 采用 `Big Bang Rewrite`：先清空旧音乐系统，再在原路径重建新系统
2. 采用 `Repository Pattern + Adapter Pattern`：先定义稳定音乐领域接口，再让来源实现适配
3. 播放器状态拆成“播放内核”和“UI 壳层”两层，避免 provider 字段渗透到全局状态
4. Phase 1 在正式 `/music` 路径上交付新的应用壳层与播放核心，后续 Phase 2/3 继续补齐数据和账号能力

**目标目录结构**

```text
src/features/music/
  app/
  components/
  domain/
  hooks/
  services/
  state/
  styles/
  utils/
  tests/
```

建议职责如下：

- `app/`
  - 页面装配、路由级容器、布局组装
- `components/`
  - `MusicShell`
  - `MusicSidebar`
  - `MusicTopBar`
  - `MusicHero`
  - `MusicMiniPlayer`
  - `MusicFullPlayer`
  - `MusicQueueDrawer`
  - `MusicLyricsPanel`
- `domain/`
  - `track`
  - `playlist`
  - `queue`
  - `lyric`
  - `playback`
  - 统一 interface、normalizer、mapper
- `services/`
  - `audio-engine`
  - `media-session`
  - `keyboard-shortcuts`
  - `theme-palette`
  - `fixture-repository`
- `state/`
  - 4 个独立 zustand store
- `tests/`
  - store、service、component、integration 测试

**状态模型**

Phase 1 新状态只保留稳定领域状态，不允许出现来源专属字段。

- `musicShellStore`
  - 管页面壳层
  - 主要字段：
    - `activeSection`
    - `sidebarCollapsed`
    - `mobileDrawerOpen`
    - `layoutMode`
    - `themeVariant`
- `playbackStore`
  - 管播放器内核
  - 主要字段：
    - `queue`
    - `currentTrackId`
    - `playState`
    - `playMode`
    - `volume`
    - `muted`
    - `positionMs`
    - `durationMs`
    - `bufferedMs`
    - `error`
- `playerSurfaceStore`
  - 管 UI 壳层
  - 主要字段：
    - `miniVisible`
    - `fullPlayerOpen`
    - `lyricsPanelOpen`
    - `queuePanelOpen`
    - `transitionState`
- `lyricsStore`
  - 管歌词时间轴
  - 主要字段：
    - `lines`
    - `activeLineIndex`
    - `offsetMs`
    - `followMode`
    - `manualSeekLock`

**统一领域模型**

队列项、播放对象和歌词对象都使用新的统一模型：

- `MusicTrackEntity`
  - `id`
  - `source`
  - `title`
  - `artists`
  - `album`
  - `coverUrl`
  - `durationMs`
  - `stream`
  - `playable`
- `QueueItemEntity`
  - `queueId`
  - `track`
  - `addedAt`
  - `fromContext`
- `LyricDocumentEntity`
  - `trackId`
  - `source`
  - `lines`
  - `offsetMs`

显式约束：

- 禁止把 `neteaseSong`、`audiusTrack`、`jamendoTrack` 这类上游原始字段直接塞进 store
- 组件只能消费统一实体和 selector，不能直接操作 provider payload
- provider 层发生变化时，只允许改 `adapter` / `repository`，不允许反向污染 UI 组件

**信息架构与 UI 壳层**

Phase 1 的正式 `/music` 页面直接切成新的壳层结构：

- 左侧：
  - `Home`
  - `Explore`
  - `Library`
  - 静态账号区卡片
- 顶部：
  - 搜索框壳
  - 当前 section 标题
  - 视图切换和主题动作位
- 主内容区：
  - hero 区
  - 推荐卡片网格
  - 最近播放区
  - 当前队列摘要
- 底部：
  - 新 mini player 常驻壳层
- 全屏层：
  - 新 full player
  - 内部可切歌词 / 队列

视觉与交互原则：

- 保留 `YesPlayMusic` 风格的左右分栏和底部播放器语义，但不照搬 Vue/Electron 实现
- 视觉语言统一到同一套颜色、圆角、描边、按钮层级和动效节奏
- 移动端允许折叠为抽屉和纵向堆叠，不强行复刻桌面布局

**播放器内核与服务边界**

Phase 1 播放核心由 `audio-engine` 服务负责，UI 只通过 action 调用它：

- `audio-engine`
  - 驱动 `HTMLAudioElement`
  - 同步 `playbackStore`
  - 负责 `play / pause / seek / next / previous / setVolume`
- `media-session`
  - 绑定系统媒体会话
  - 映射封面、歌名、暂停/切歌动作
- `keyboard-shortcuts`
  - 绑定空格播放暂停、左右切歌、上下音量、展开/收起播放器等快捷键
- `theme-palette`
  - 负责从封面派生播放器背景和强调色

约束：

- 组件不直接持有底层 `audio` 实例
- store 不直接发 HTTP
- service 不直接操作 JSX 组件内部 state

**数据边界**

Phase 1 直接切断与旧数据层的依赖：

- 删除：
  - `src/lib/music/service.ts`
  - `src/lib/transport/music-client.ts`
  - `src/stores/musicPlayerStore.ts`
  - 现有 `/api/music/*`
  - 旧 `/media/audio/stream`
- 新命名空间：
  - `src/features/music/domain/*`
  - `src/features/music/services/*`
  - `src/features/music/state/*`

为后续 Phase 2 预留的新接口：

- `searchRepository`
- `playlistRepository`
- `trackRepository`
- `lyricRepository`
- `streamRepository`
- `authRepository`

Phase 1 先用 `fixture-repository` 提供假数据，但必须通过这些接口走完整链路，不能借旧 API 过桥。

**Big-Bang 迁移策略**

采用“先删旧，再补最小可运行骨架”的迁移方式：

1. 切出 `codex/music` 分支
2. 删除旧音乐目录、旧 store、旧 API 路由和旧音频流实现
3. 同步创建新的 `src/features/music/` 目录和最小 `/music` 页面骨架
4. 让 `/music` 尽快恢复为“可打开、可交互、可播放 fixture 数据”的新页面
5. 在同一分支内继续补壳层、播放器、歌词、队列和快捷键

约束：

- 删除动作必须和新骨架同一批落地，避免主分支出现无法编译的中间态
- 正式 `/music` 路径不允许再挂旧组件或旧 store

**删除清单**

旧系统在本阶段一开始直接删除：

- `src/components/music/*`
- `src/lib/music/*`
- `src/stores/musicPlayerStore.ts`
- `src/stores/musicPlayerStore.test.ts`
- `src/app/api/music/*`
- `src/app/media/audio/stream/route.ts`
- `src/app/media/audio/stream/route.test.ts`

同时需要立即替换或修补的接线点：

- `src/app/music/page.tsx`
- `src/app/layout.tsx`
- `src/components/Sidebar.tsx`
- `src/components/MobileBottomNav.tsx`

说明：

- `Sidebar` 和 `MobileBottomNav` 继续保留 `/music` 导航语义
- `layout.tsx` 里的旧 `MusicPlayerRoot` 必须在删除阶段一起移除，并替换成新的 player root

**错误处理与边界**

- 播放器无曲目时：
  - mini player 隐藏
  - full player 不自动展开
- 当前曲目缺封面或歌词时：
  - 使用占位封面和空歌词提示
  - 不让布局塌陷
- 快捷键、媒体会话或浏览器能力不可用时：
  - 记录明确错误
  - 自动降级，不阻断基础播放
- 音频加载失败时：
  - 保留当前队列
  - 将错误写入 `playbackStore.error`
  - UI 展示可恢复的错误提示

**测试策略**

Phase 1 先补 4 类测试：

1. 领域 / store 测试
   - 队列推进
   - 播放模式切换
   - 歌词高亮同步
   - player surface 展开 / 收起 / 切换
2. service 测试
   - `audio-engine`
   - `media-session`
   - `keyboard-shortcuts`
3. 组件交互测试
   - `MusicMiniPlayer`
   - `MusicFullPlayer`
   - `MusicQueueDrawer`
   - `MusicLyricsPanel`
4. big-bang 烟测
   - 打开正式 `/music`
   - 渲染新壳层
   - 播放 fixture 曲目
   - 展开播放器
   - 切歌
   - 歌词高亮
   - 收起回 mini player

优先级：

- 首选新增 `Playwright` 做页面级烟测
- 如果当前轮次不引入 `Playwright`，则至少用 `RTL + Jest` 覆盖关键整链路
- 不接受只靠手工验收

**验收标准**

- 旧 `music` 前端实现、旧 store、旧 API 路由和旧音频流实现已从分支内删除
- 正式 `/music` 路径已经由新 `src/features/music/` 接管
- 新系统不依赖旧 `musicPlayerStore`、旧 `/api/music/*` 或旧 `lib/music/*`
- mini player、full player、lyrics、queue、快捷键和媒体会话由新系统接管
- 自动化测试覆盖新增关键状态和交互路径

**后续阶段**

- **Phase 2**
  - 接入真实搜索、歌单、专辑、歌手、歌词、stream provider
  - 重建新的 `/api/music/*`
- **Phase 3**
  - 接入登录、我的歌单、收藏、历史、每日推荐、FM、设置
  - 接入桌面媒体键、托盘、缓存、下载等桌面能力

**里程碑**

1. 删除旧音乐系统并恢复最小可运行 `/music` 骨架
2. 建立 4 个新 store 与 `audio-engine`
3. 落 mini player / full player / lyrics / queue
4. 打通 fixture 数据链路与 big-bang smoke test
5. 接入真实数据域
6. 接入账号能力与桌面能力
