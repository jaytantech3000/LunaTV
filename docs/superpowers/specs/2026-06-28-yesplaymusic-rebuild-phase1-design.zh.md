# LunaTV 音乐系统从零复刻 Phase 1 设计

**目标**

以 `YesPlayMusic` 的信息架构、播放器交互和页面组织为参考，在当前 `React + Next.js + Tauri` 宿主内从零重建新的音乐子系统，并为后续完整替换旧音乐系统建立稳定边界。Phase 1 只交付新的应用壳层与播放核心，不复用旧音乐前端实现。

**完整项目拆分**

完整复刻拆成 5 个可独立推进的子项目：

1. 应用壳层：`/music` 布局、导航、主题、响应式结构
2. 播放核心：mini player、全屏播放器、歌词、队列、快捷键、媒体会话
3. 数据域：搜索、歌单、专辑、歌手、歌词、流地址、统一 provider 协议
4. 账号能力：登录、我的歌单、收藏、历史、每日推荐、FM、设置
5. 桌面集成：Tauri 媒体键、托盘、缓存、下载、本地桌面能力

本设计文档只覆盖 **Phase 1 = 子项目 1 + 2**。后续 Phase 2/3 会在本阶段稳定后分别立 spec。

**范围**

- 新建独立 `music-v2` feature，先以并行方式挂载到临时入口 `/music-v2`
- 重做音乐页面的整体信息架构、导航区域、主内容布局和响应式壳层
- 重做播放器内核相关状态层，包括队列、播放状态、surface 展现状态、歌词同步状态
- 重做 mini player、expanded player、lyrics panel、queue panel、快捷键和媒体会话绑定
- 为新的状态模型、组件交互和切换链路补齐自动化测试
- 为后续 Phase 2 数据域接入预留统一的 repository / adapter 边界

**不做**

- 不复用旧 `components/music` 里的播放器壳层、页面组件和交互状态
- 不复用旧 `musicPlayerStore`、旧 `MusicPlayerRoot` 和旧 `/api/music/*` 作为过桥实现
- 不在 Phase 1 接入登录、每日推荐、评论、FM、设置页或托盘等完整产品面
- 不在 Phase 1 追求全部数据真实联通；允许先用 fixture / mock 打通新边界
- 不在实现初期直接删掉旧 `/music`，切换前保留旧入口作为回退面

**现状结论**

- 当前音乐能力已经分散挂接在布局、侧边栏、移动底栏、`/music` 路由、`/api/music/*`、`lib/music/*` 和 `musicPlayerStore`，不是单页替换
- 旧系统的 UI、播放状态和 provider 数据边界耦合过紧，不适合作为“从零复刻”的基础
- 直接 `big-bang` 删除旧系统再写，会让 `/music` 在开发期长时间不可用，回滚成本高

**核心方案**

1. 采用 `Strangler Fig Pattern`：并行构建 `music-v2`，完成后再切换正式 `/music`
2. 采用 `Repository Pattern + Adapter Pattern`：先定义稳定音乐领域接口，再让来源实现适配
3. 播放器状态拆成“播放内核”和“UI 壳层”两层，避免 provider 字段渗透到全局状态
4. Phase 1 只交付新壳层和新播放核心，后续数据域和账号能力按阶段叠加

**目标目录结构**

```text
src/features/music-v2/
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
  - `MusicMiniPlayer`
  - `MusicFullPlayer`
  - `MusicQueueDrawer`
  - `MusicLyricsPanel`
  - `MusicTopBar`
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
  - 未来可扩展 `music-repository`
- `state/`
  - 4 个独立 zustand store
- `tests/`
  - store、service、component、integration 测试

**状态模型**

Phase 1 新状态只保留稳定领域状态，不允许出现来源专属字段。

- `musicShellStore`
  - 管页面壳层
  - 主要字段：
    - `activeView`
    - `sidebarCollapsed`
    - `mobileDrawerOpen`
    - `activeTab`
    - `layoutMode`
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
    - `quality`
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

Phase 1 的 `music-v2` 页面采用新的壳层结构，但不要求一次性复刻完整业务内容：

- 左侧：
  - 音乐主导航
  - 一级栏目占位
  - 未来账号区占位
- 顶部：
  - 搜索入口壳
  - 当前上下文标题
  - 未来用户动作区占位
- 主内容区：
  - 默认展示新的视觉壳层
  - 首轮可以使用 mock 数据验证列表、封面、切换和响应式
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

`music-v2` 与旧数据层彻底隔离：

- 不依赖：
  - `src/lib/music/service.ts`
  - `src/lib/transport/music-client.ts`
  - `src/stores/musicPlayerStore.ts`
  - 现有 `/api/music/*`
- 新命名空间：
  - `src/features/music-v2/domain/*`
  - `src/features/music-v2/services/*`
  - `src/features/music-v2/state/*`
  - 新路由 `/api/music-v2/*`

为后续 Phase 2 预留的新接口：

- `searchRepository`
- `playlistRepository`
- `trackRepository`
- `lyricRepository`
- `streamRepository`
- `authRepository`

Phase 1 即使先用 mock / fixture，也必须通过这些接口走完整链路，不能借旧 API 过桥。

**切换与迁移策略**

采用并行重建 + 最终切换：

1. 新建 `/music-v2`
2. 完成新壳层、新 store、新播放器服务和基础交互
3. 通过自动化测试和烟测稳定 `music-v2`
4. 把正式 `/music` 入口切到 `music-v2`
5. 删除旧音乐系统

这样既满足“全部推倒重写”，也避免在开发期让正式 `/music` 入口长期失效。

**删除清单**

在正式切换到 `music-v2` 后，旧系统整批删除：

- `src/components/music/*`
- `src/lib/music/*`
- `src/stores/musicPlayerStore.ts`
- `src/stores/musicPlayerStore.test.ts`
- `src/app/api/music/*`
- `src/app/media/audio/stream/route.ts`
- `src/app/media/audio/stream/route.test.ts`

替换点：

- `src/app/music/page.tsx`
- `src/app/layout.tsx`
- `src/components/Sidebar.tsx`
- `src/components/MobileBottomNav.tsx`

说明：

- `Sidebar` 和 `MobileBottomNav` 仍然保留 `/music` 导航语义，只在最终切换时改为新实现
- 删除旧系统应独立成 purge 阶段，避免新旧代码交叉删改带来不可控回归

**错误处理与边界**

- 播放器无曲目时：
  - mini player 隐藏
  - full player 不自动展开
- 当前曲目缺封面或歌词时：
  - 使用占位能力
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
4. 切换前烟测
   - 进入 `music-v2`
   - 点播一首歌
   - 展开播放器
   - 切歌
   - 歌词高亮
   - 收起回 mini player

优先级：

- 首选新增 `Playwright` 做页面级烟测
- 如果当前轮次不引入 `Playwright`，则至少用 `RTL + Jest` 覆盖关键整链路
- 不接受只靠手工验收

**验收标准**

- `music-v2` 已形成独立目录、独立状态层和独立服务边界
- `music-v2` 可以在不依赖旧 `musicPlayerStore` 和旧 `/api/music/*` 的前提下运行
- mini player、full player、lyrics、queue、快捷键和媒体会话由新系统接管
- 正式切换前，旧 `/music` 仍可作为回退入口
- 切换后，旧音乐目录与旧音频流实现可被整批删除
- 自动化测试覆盖新增关键状态和交互路径

**后续阶段**

- **Phase 2**
  - 接入真实搜索、歌单、专辑、歌手、歌词、stream provider
  - 完成新的 `/api/music-v2/*`
- **Phase 3**
  - 接入登录、我的歌单、收藏、历史、每日推荐、FM、设置
  - 接入桌面媒体键、托盘、缓存、下载等桌面能力

**里程碑**

1. 建立 `music-v2` 壳层与基础目录
2. 建立 4 个新 store 与 `audio-engine`
3. 落 mini player / full player / lyrics / queue
4. 打通 mock 数据链路与基础 smoke test
5. 切换 `/music`
6. purge 旧音乐系统
