# 音乐模块与全局播放器实施方案

## 目标

在 LunaTV 中新增与“电影 / 剧集 / 动漫 / 综艺”同级的 `音乐` 模块，并提供一套接近网易云 / QQ 音乐体验的全局播放器。

本方案同时满足两个前提：

1. Web 版可以先落地音乐发现页与播放器交互。
2. 桌面版必须遵守现有 Rust 化路线，不新增新的桌面业务级散点 `fetch`，并为本地 Rust 服务接管数据面预留清晰边界。

当前文档同时约束方案与第一批 MVP 的实现边界，后续代码继续以本文的接口和平台分层为准。

## 相关前提

音乐模块不是一个普通页面功能，它会同时触及：

- 新一级导航与页面结构
- 全局播放器常驻布局
- 跨平台音乐源适配
- 歌词、队列、播放记录、收藏等本地数据
- 桌面版 local service 数据面

与本方案直接相关的现有文件：

- [dev-plan/desktop-foundation/desktop-rustification-roadmap.md](/Users/jay-workstation/AI-CODE/LunaTV/dev-plan/desktop-foundation/desktop-rustification-roadmap.md:1)
- [dev-plan/desktop-foundation/desktop-local-service-protocol-v1.md](/Users/jay-workstation/AI-CODE/LunaTV/dev-plan/desktop-foundation/desktop-local-service-protocol-v1.md:1)
- [src/app/layout.tsx](/Users/jay-workstation/AI-CODE/LunaTV/src/app/layout.tsx:1)
- [src/components/PageLayout.tsx](/Users/jay-workstation/AI-CODE/LunaTV/src/components/PageLayout.tsx:1)
- [src/components/Sidebar.tsx](/Users/jay-workstation/AI-CODE/LunaTV/src/components/Sidebar.tsx:143)
- [src/components/MobileBottomNav.tsx](/Users/jay-workstation/AI-CODE/LunaTV/src/components/MobileBottomNav.tsx:43)
- [src/lib/transport/endpoint.ts](/Users/jay-workstation/AI-CODE/LunaTV/src/lib/transport/endpoint.ts:1)
- [src/lib/runtime-config.ts](/Users/jay-workstation/AI-CODE/LunaTV/src/lib/runtime-config.ts:1)
- [src/lib/runtime/public-config.ts](/Users/jay-workstation/AI-CODE/LunaTV/src/lib/runtime/public-config.ts:149)
- [src/lib/admin.types.ts](/Users/jay-workstation/AI-CODE/LunaTV/src/lib/admin.types.ts:6)
- [src/lib/config.ts](/Users/jay-workstation/AI-CODE/LunaTV/src/lib/config.ts:368)
- [src/lib/desktop/tauri-client.ts](/Users/jay-workstation/AI-CODE/LunaTV/src/lib/desktop/tauri-client.ts:1)

## 结论先行

### 1. 音乐模块要拆成“页面发现能力”和“全局播放器能力”

- `/music` 页面负责平台切换、榜单、热门、歌单、专辑、曲库、搜索。
- 全局播放器负责迷你播放条、全屏播放器、歌词、播放队列、播放模式和系统媒体控制。

### 2. 播放器 UI 留在 TypeScript，数据面必须为 Rust 接管预留边界

根据桌面 Rust 化路线图，桌面版最终应由：

- Rust local service 承担数据面
- Tauri 承担控制面
- TypeScript 只保留 UI、播放器编排和轻量状态展示

所以音乐模块不能按“前端直接直连平台接口”的方式设计。

### 3. 桌面端不应通过 Tauri command 拉流

音乐播放链路和 VOD / Live 一样，本质上仍然是浏览器播放器消费 URL。

因此：

- 播放器必须继续消费可直接访问的 HTTP URL
- 音频流应由本地服务提供稳定的媒体 URL
- 不把音频数据改成 IPC 分块传输

### 4. 桌面首版不做音乐离线下载执行器

桌面 Rust 化路线图已经明确把下载器 Rust 化作为第一优先级。音乐下载如果后续要做，应直接复用 Rust 下载器能力，不再单独新增一套 TS 下载执行链。

## 范围

### 本方案覆盖

- 一级菜单 `音乐`
- `/music` 页面
- 全局常驻迷你播放器
- 全屏播放器
- 平台切换
- 榜单 / 热门 / 歌单 / 专辑 / 曲库 / 搜索
- 歌词展示
- 播放队列
- 最近播放 / 收藏的接口边界
- 桌面 local service 预留协议

### 本方案暂不覆盖

- 音乐下载执行器
- 音乐缓存离线播放
- MV / 视频化音乐内容
- 桌面原生系统托盘播放器
- Windows / macOS 原生音频会话深度定制
- 社交功能、评论、动态

## 设计原则

1. 音乐平台差异收敛在 provider / adapter 层，前端不依赖具体平台返回结构。
2. 前端始终通过统一 `music client` 访问数据，不直接拼平台请求。
3. 桌面端新增后台能力优先走 local service / desktop SDK，不新增新的 `src/app/api/*` 桌面散点依赖。
4. 播放器只维护一个全局音频实例，不允许每个页面各管一套播放状态。
5. 真实音频地址不持久化，只持久化 `source + trackId + metadata`，避免平台直链过期后导致恢复失败。
6. 歌词、收藏、最近播放、播放记录都要独立建模，不绑死在某一个平台字段上。

## 总体架构

```text
Music UI
  - /music 页面
  - 迷你播放器
  - 全屏播放器
  - 歌词 / 队列 / 收藏按钮

Music Client
  - 统一前端请求入口
  - 不关心 Web / Desktop 后端差异

Music Data Plane
  - Web: Next route / Node service
  - Desktop: Rust local service over loopback HTTP

Music Providers
  - netease
  - qq
  - kugou
  - 后续扩展 provider
```

## 页面与导航设计

### 一级入口

新增与电影等同级的 `音乐` 菜单：

- 桌面侧边栏：加入 [Sidebar.tsx](/Users/jay-workstation/AI-CODE/LunaTV/src/components/Sidebar.tsx:143) 的发现菜单区
- 移动底部导航：加入 [MobileBottomNav.tsx](/Users/jay-workstation/AI-CODE/LunaTV/src/components/MobileBottomNav.tsx:43)

建议导航 href 固定为：

```text
/music
```

不把默认平台写入导航 href，避免：

- 桌面侧边栏激活态判断变复杂
- 平台默认值散落在多个入口
- 后续切换默认平台时需要改多处

### `/music` 页面结构

页面由三层区域构成：

1. 顶部平台切换条
2. 二级内容切换区
3. 主内容区

推荐的 query 结构：

```text
/music?source=netease&tab=home
/music?source=qq&tab=rank
/music?source=kugou&tab=playlist&id=12345
```

说明：

- `source` 表示当前音乐平台
- `tab` 表示当前内容分区
- `id` 用于歌单 / 专辑 / 榜单详情
- 页面内部状态允许使用 URL 驱动，保证分享与刷新可恢复

### 推荐一级内容标签

- `home`
- `rank`
- `hot`
- `playlist`
- `album`
- `library`
- `search`

首版建议先实现：

- `rank`
- `hot`
- `playlist`
- `search`

`album / library` 可作为第二批补齐。

## 全局播放器设计

### 放置位置

播放器不能放在 `/music` 页面内部，必须挂在 [src/app/layout.tsx](/Users/jay-workstation/AI-CODE/LunaTV/src/app/layout.tsx:1) 的全局层。

原因：

- 切换路由时播放器不能销毁
- 迷你播放器需要在非音乐页仍然可见
- 系统级播放状态与媒体键也要求全局唯一实例

建议新增：

- `src/components/music/MusicPlayerRoot.tsx`
- `src/components/music/MusicMiniPlayer.tsx`
- `src/components/music/MusicFullscreenPlayer.tsx`

### 播放器形态

#### 迷你播放器

固定在页面底部，展示：

- 封面
- 歌名 / 歌手
- 上一首
- 播放 / 暂停
- 下一首
- 播放进度
- 展开按钮

#### 全屏播放器

移动端：

- 全屏覆盖层

桌面端：

- 居中大面板或右侧抽屉

展示内容：

- 大封面
- 大号标题与歌手信息
- 当前播放进度
- 音量控制
- 播放模式
- 歌词 / 队列切换
- 收藏与跳转入口

### 与当前布局的兼容要求

当前 [PageLayout.tsx](/Users/jay-workstation/AI-CODE/LunaTV/src/components/PageLayout.tsx:57) 底部间距主要服务移动底部导航，后续需要改成统一的 CSS 变量布局：

- `--mobile-bottom-nav-height`
- `--music-mini-player-height`
- `--safe-area-bottom`

桌面端播放器停靠条还要避开侧边栏宽度变化：

- 侧边栏展开时 `w-64`
- 折叠时 `w-16`

建议复用 `Sidebar` 已同步到 `<html>` 的折叠态，而不是在播放器内再维护一套侧边栏宽度判断。

## 前端分层

### 1. `music client`

前端所有音乐请求都只经过一个 client：

- `src/lib/transport/music-client.ts`

职责：

- 封装请求路径
- 屏蔽 Web / Desktop 的 base URL 差异
- 统一参数与返回结构
- 成为未来 local service 接口切换的唯一入口

前端页面和播放器禁止直接：

- `fetch('https://music.xxx/...')`
- 新增散点 `/api/music/...` 手写调用

### 2. `player controller`

新增：

- `src/lib/music/player-controller.ts`

职责：

- 持有唯一 `HTMLAudioElement`
- 绑定媒体事件
- 接收 store 下发的播放命令
- 维护播放状态回写
- 对接 `Media Session API`

它不负责：

- 平台解析
- 业务查询
- 队列持久化策略

### 3. `player store`

新增：

- `src/stores/musicPlayerStore.ts`

实现风格参考 [downloadStore.ts](/Users/jay-workstation/AI-CODE/LunaTV/src/stores/downloadStore.ts:1)，采用 `zustand + persist`。

它只存：

- 当前播放条目
- 队列
- 播放模式
- 音量 / 静音
- 当前进度快照
- 展开态
- 最近播放

它不存：

- 第三方平台直链
- 一次性播放 token
- 临时签名 URL

## 统一数据模型

### 平台源

```ts
type MusicPlatformKey = 'netease' | 'qq' | 'kugou';

interface MusicSource {
  key: MusicPlatformKey;
  name: string;
  provider: MusicPlatformKey;
  enabled: boolean;
  tabs: string[];
}
```

### 歌曲与列表

```ts
interface MusicArtist {
  id?: string;
  name: string;
}

interface MusicAlbum {
  id?: string;
  title: string;
  cover?: string;
}

interface MusicTrack {
  id: string;
  source: MusicPlatformKey;
  title: string;
  artists: MusicArtist[];
  album?: MusicAlbum;
  cover?: string;
  durationMs?: number;
  playable: boolean;
  subtitle?: string;
}

interface MusicCollection {
  id: string;
  source: MusicPlatformKey;
  kind: 'playlist' | 'album' | 'rank' | 'artist-toplist';
  title: string;
  cover?: string;
  description?: string;
  trackCount?: number;
  tracks?: MusicTrack[];
}
```

### 歌词

```ts
interface MusicLyricLine {
  timeMs: number;
  text: string;
  translation?: string;
}

interface MusicLyricPayload {
  trackId: string;
  source: MusicPlatformKey;
  lines: MusicLyricLine[];
  offsetMs?: number;
}
```

### 播放队列

```ts
type MusicPlayMode = 'list-loop' | 'single-loop' | 'shuffle';

interface PlayerQueueItem {
  trackId: string;
  source: MusicPlatformKey;
  title: string;
  artistsText: string;
  cover?: string;
  durationMs?: number;
}
```

## API 与协议设计

### 前端对外契约

前端只认以下音乐接口：

- `GET /api/music/sources`
- `GET /api/music/home`
- `GET /api/music/search`
- `GET /api/music/collection`
- `GET /api/music/track`
- `GET /api/music/lyric`
- `GET /media/audio/stream`

注意：

- 前端实际调用统一经过 `music-client`
- 前端不依赖这些接口背后是 Next route 还是 local service
- 桌面 local service 应提供兼容路径 `/api/music/*`，以适配现有 [buildApiUrl](/Users/jay-workstation/AI-CODE/LunaTV/src/lib/transport/endpoint.ts:65) 的前缀规则

### `GET /api/music/sources`

返回可用音乐平台列表。

示例：

```json
{
  "sources": [
    {
      "key": "netease",
      "name": "网易云音乐",
      "provider": "netease",
      "enabled": true,
      "tabs": ["home", "rank", "hot", "playlist", "search"]
    }
  ]
}
```

### `GET /api/music/home`

参数：

- `source`

返回：

- 当前平台首页推荐块
- 榜单入口
- 热门歌单
- 推荐曲目

### `GET /api/music/search`

参数：

- `source`
- `q`
- `page`

返回：

- 曲目结果
- 歌单结果
- 专辑结果

### `GET /api/music/collection`

参数：

- `source`
- `kind`
- `id`

返回：

- 榜单 / 歌单 / 专辑详情
- 统一的 `MusicCollection`

### `GET /api/music/track`

参数：

- `source`
- `id`
- `quality`

返回：

- 曲目元数据
- 可播放状态
- 内部稳定流地址

示例：

```json
{
  "track": {
    "id": "12345",
    "source": "netease",
    "title": "示例歌曲",
    "artists": [{ "name": "示例歌手" }],
    "album": { "title": "示例专辑" },
    "cover": "https://example.com/cover.jpg",
    "durationMs": 203000,
    "playable": true
  },
  "streamUrl": "/media/audio/stream?source=netease&id=12345&quality=standard"
}
```

### `GET /api/music/lyric`

参数：

- `source`
- `id`

返回统一歌词结构。

### `GET /media/audio/stream`

参数：

- `source`
- `id`
- `quality`

要求：

- 返回浏览器音频元素可直接消费的稳定 URL
- 保留 `Range` 语义
- 桌面版后续由 local service 提供
- 前端只把它当作普通媒体地址，不关心背后是平台直链、重定向还是中转代理

## 桌面 Rust 化兼容策略

### 关键原则

桌面版音乐功能必须满足以下边界：

1. UI 保留在 TypeScript。
2. 平台抓取、解析、歌词、播放地址解析、图片代理后续都能下沉到 Rust。
3. 播放器继续消费 HTTP URL，不改成 Tauri IPC 拉流。
4. 桌面路径上的新增后台能力优先走 local service。

### 桌面与 Web 的责任划分

#### Web 版

- 可以先由 `src/app/api/music/*` 承载音乐元数据接口
- 可以先在 Node 端做 provider 适配
- 用于快速验证页面结构和播放器交互

#### 桌面版

- 前端仍然通过 `music-client` 发起请求
- `API_BASE_URL` 指向本地 loopback service
- local service 逐步补齐 `/api/music/*` 与 `/media/audio/stream`
- 前端不新增桌面专用散点业务请求

### 桌面 local service 建议新增的协议

当前 [desktop-local-service-protocol-v1.md](/Users/jay-workstation/AI-CODE/LunaTV/dev-plan/desktop-foundation/desktop-local-service-protocol-v1.md:63) 尚未定义音乐接口，建议扩展：

- `GET /api/music/sources`
- `GET /api/music/home`
- `GET /api/music/search`
- `GET /api/music/collection`
- `GET /api/music/track`
- `GET /api/music/lyric`
- `GET /media/audio/stream`

这些接口应属于桌面数据面，而不是 Tauri command。

### 不建议的桌面实现方式

- 不直接让前端在桌面模式下访问远端音乐平台
- 不新增 `invoke('play_music_track')` 这种把业务能力塞进 `src-tauri` 的 command
- 不让播放器通过 IPC 一段段读取音频流

## 配置模型设计

### 运行时开关

建议新增：

- `SiteConfig.EnableWebMusic`
- `RuntimeConfig.ENABLE_WEB_MUSIC`

用途：

- Web 版灰度开关
- 桌面版在 local service 未补齐前可隐藏入口
- 保持与 `ENABLE_WEB_LIVE` 一致的运行时投影模式

### 管理配置

建议在 [AdminConfig](/Users/jay-workstation/AI-CODE/LunaTV/src/lib/admin.types.ts:6) 中新增：

```ts
MusicConfig?: {
  key: 'netease' | 'qq' | 'kugou' | string;
  name: string;
  provider: 'netease' | 'qq' | 'kugou' | string;
  cookie?: string;
  ua?: string;
  referer?: string;
  enabledTabs?: string[];
  from: 'config' | 'custom';
  disabled?: boolean;
}[];
```

说明：

- 这里是 provider 驱动，不是直播那种 URL 驱动
- 不建议让用户随意填一个音乐 URL 作为数据源
- `cookie / ua / referer` 用于平台兼容和鉴权

### 配置文件结构

建议在 `config.example.json` 对应的文件配置里新增：

```json
{
  "music_sites": {
    "netease": {
      "name": "网易云音乐",
      "provider": "netease",
      "ua": "",
      "referer": "",
      "cookie": "",
      "enabled_tabs": ["home", "rank", "hot", "playlist", "search"]
    }
  }
}
```

与 `lives` 一样，最终在 `refineConfig` 中被合并进 `MusicConfig`。

## 播放状态与持久化

### 需要持久化

- 当前歌曲基础信息
- 当前队列
- 播放模式
- 音量 / 静音
- 最近播放列表

### 不建议持久化

- 当前音频流直链
- 当前歌词全文缓存
- 临时签名
- 临时请求头

### 恢复策略

应用重启后：

1. 从 store 恢复 `currentTrack`
2. 重新请求 `/api/music/track`
3. 重新获取 `streamUrl`
4. 恢复到最近一次保存的播放进度附近

如果曲目已经不可播：

- 展示错误提示
- 保留队列
- 不让播放器进入坏状态死循环重试

## 播放记录、收藏与最近播放

### 首版建议

- 队列、播放状态先存在前端 store
- 收藏、最近播放、播放记录保留独立 SDK 边界
- 不把这些长期真源直接绑死在前端 localStorage 上

### 桌面长期目标

根据 Rust 化路线图，这些本地 profile 数据后续应以 Rust 存储层为真源，前端只通过统一 profile SDK 访问。

因此音乐相关本地数据建议预留：

- `music_favorites`
- `music_recent_tracks`
- `music_play_records`

但首版不要求全部实现。

## 目录建议

建议新增以下结构：

```text
src/app/music/page.tsx

src/components/music/
  MusicPageClient.tsx
  MusicSourceTabs.tsx
  MusicSectionTabs.tsx
  MusicCollectionGrid.tsx
  MusicTrackList.tsx
  MusicPlayerRoot.tsx
  MusicMiniPlayer.tsx
  MusicFullscreenPlayer.tsx
  MusicLyricsPanel.tsx
  MusicQueuePanel.tsx

src/lib/music/
  types.ts
  player-controller.ts
  media-session.ts
  provider-registry.ts

src/lib/transport/
  music-client.ts

src/stores/
  musicPlayerStore.ts

src/app/api/music/
  sources/route.ts
  home/route.ts
  search/route.ts
  collection/route.ts
  track/route.ts
  lyric/route.ts

src/app/media/audio/stream/route.ts
```

桌面数据面成熟后，对应能力逐步迁入：

```text
crates/moontv-core
  music domain models

crates/moontv-network
  music providers / upstream adapters

crates/moontv-profile
  music favorites / recent plays / records

crates/moontv-local-service
  /api/music/*
  /media/audio/stream
```

## 分阶段实施

### Phase A：统一前端入口并落地 Web MVP

目标：

- 新增 `/music`
- 新增全局播放器骨架
- 前端只通过 `music-client` 访问音乐数据

范围：

- 一级导航入口
- 网易云 provider
- 榜单 / 热门 / 歌单 / 搜索
- 迷你播放器
- 全屏播放器基础形态
- 歌词面板

桌面处理：

- 桌面模式默认可通过 `ENABLE_WEB_MUSIC` 控制隐藏
- 即使显示，也不允许绕过统一 `music-client`

### Phase B：桌面数据面协议补齐

目标：

- local service 补齐 `/api/music/*` 与 `/media/audio/stream`
- 桌面前端不再依赖 `src/app/api/music/*` 作为后台主入口

范围：

- provider 解析下沉到 Rust
- 桌面音频流代理下沉到 Rust
- 桌面图片 / 歌词等必要音乐元数据同步迁移

完成后，音乐模块应符合路线图的 M2 方向：

- 桌面播放链路不再依赖 TS 业务级联网

### Phase C：profile 与配置真源收口

目标：

- 桌面音乐收藏 / 最近播放 / 播放记录改由 Rust 真源托管
- 前端只保留 UI 和状态展示

范围：

- profile SDK
- music favorites
- music recent tracks
- playback records

### Phase D：下载与离线能力

目标：

- 在 Rust 下载器稳定后，再评估音乐下载

说明：

- 不单独为音乐实现新的 TS 下载执行器
- 优先复用桌面 Rust 下载器的任务、缓存和恢复能力

## 风险与注意事项

### 1. 平台源稳定性

音乐平台经常存在：

- 播放地址时效性
- cookie 依赖
- UA / referer 校验
- 歌词 / 搜索接口变动

因此平台适配必须集中在 provider 层，不得散落到页面组件。

### 2. 桌面与 Web 入口发散

如果前端一开始就分裂成：

- Web 走 `src/app/api/music/*`
- Desktop 走另一套手写请求

后续 Rust 化会非常痛苦。

必须先统一前端入口，再替换底层实现。

### 3. 布局冲突

全局播放器与移动底部导航会竞争底部空间。

上线前必须统一：

- safe area
- player height
- mobile nav height
- fullscreen overlay 层级

### 4. 播放状态与临时资源耦合

如果把真实播放 URL 持久化，应用恢复后极易失败。

必须坚持：

- store 只存 `track identity`
- 重新播放前再向后端解析可用音频流

## 验收标准

### 功能验收

1. 可以从一级导航进入 `音乐` 页面。
2. 可以切换音乐平台与二级内容区。
3. 可以从列表发起播放。
4. 切换页面后音乐不中断。
5. 迷你播放器与全屏播放器状态一致。
6. 歌词可按时间滚动高亮。
7. 播放结束后可自动按播放模式进入下一首。

### 桌面架构验收

1. 桌面音乐功能不新增绕过 `music-client` 的散点请求。
2. 桌面模式新增后台能力不要求前端直连第三方平台。
3. 音频流仍然通过 HTTP URL 被播放器直接消费。
4. 后续 local service 能在不改页面协议的情况下接管 `/api/music/*`。

### 后续代码验收命令

实现阶段至少应通过：

```bash
cargo check --workspace
cargo test --workspace
pnpm typecheck
pnpm desktop:check
pnpm exec jest --runInBand
```

如果阶段涉及播放器和桌面代理链路，还应补手工回归：

1. Web 模式音乐可正常播放
2. 桌面模式音乐可正常播放
3. 切歌、暂停、继续、拖动进度正常
4. 应用重启后队列和当前曲目可恢复
5. 桌面音频流 `Range` 行为不回退

## 最终建议

最稳妥的落地顺序不是“先把所有平台和所有桌面能力一次做完”，而是：

1. 先统一前端入口与全局播放器结构
2. 先用一个平台跑通 MVP
3. 再补桌面 local service 数据面
4. 最后再接收藏、最近播放、下载与离线

这样既能尽快交付可见的音乐功能，又不会和桌面 Rust 化路线产生结构性冲突。
