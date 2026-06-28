# LunaTV 音乐系统从零复刻 Phase 2 Netease 纵切设计

**目标**

在已完成 Phase 1 壳层与播放核心重建的基础上，用 `Netease` 作为第一个真实数据源，重建新的真实数据域、真实 `/api/music/*` 路由和真实播放数据链路，让正式 `/music` 不再依赖 `fixture-repository` 承担主流程。

**完整目标中的位置**

完整复刻仍然是 5 个子项目：

1. 应用壳层
2. 播放核心
3. 数据域
4. 账号能力
5. 桌面集成

Phase 1 已完成子项目 1 + 2 的最小闭环。  
本设计文档覆盖 **Phase 2 = 子项目 3 的第一段纵切**：先只接 `Netease`，把真实搜索、真实首页、真实歌单、真实歌词和真实音频流在新架构内跑通。

**为什么选单源纵切**

推荐先做 `Netease` 单源纵切，而不是多源并行重建：

1. 当前 `src/features/music/` 已经证明新壳层和新播放器能工作，但真实数据域仍然是空白
2. 旧 `desktop` 分支里的 `netease` 实现是最完整、测试最全、接口最稳定的一条
3. 先打通单源可以尽快验证新 `repository + adapter + route + UI` 是否成立，避免在架构未稳定前重复迁移 `Audius` / `Jamendo`
4. 音频流代理、歌词解析、歌单详情、搜索分页这些 hardest path（最难路径）都已经在 `Netease` 上具备旧实现证据

**范围**

- 新建 `Netease` 专属 provider 层，但挂在新的 `src/features/music/` 命名空间下
- 扩展新的统一领域模型，让它可以承载真实首页、搜索、歌单、歌词和流地址
- 重建新的 `/api/music/*` 路由，替换当前已删除的旧实现
- 重建新的音频流代理，但归并到新的音乐数据域命名下
- 用真实数据接管：
  - `MusicTopBar` 搜索入口
  - `MusicHero` 首屏推荐与播放入口
  - `MusicShell` 主内容区的首页 section、搜索结果、歌单详情
  - `MusicMiniPlayer` / `MusicFullPlayer` 的真实曲目加载与歌词同步
- 保持桌面模式优先，不为了 Web 兼容退回旧实现

**不做**

- 本阶段不并行接入 `Audius`、`Jamendo`、`QQ`、`Kugou`
- 不在本阶段恢复登录、收藏、历史、每日推荐、FM、设置
- 不在本阶段恢复托盘、下载、缓存管理等完整桌面能力
- 不恢复旧 `lib/music/*`、旧 `music-client`、旧 `musicPlayerStore`
- 不把旧 `netease.ts` 直接搬回原路径

**现状结论**

当前 `codex/music` 分支已经完成：

- 删除旧 `src/components/music/*`
- 删除旧 `src/lib/music/*`
- 删除旧 `src/app/api/music/*`
- 删除旧 `src/app/media/audio/stream/*`
- 删除旧 `src/stores/musicPlayerStore*`
- 在 `src/features/music/` 下建立新壳层、播放器、store、service 和 smoke test

但现在仍有 3 个关键缺口：

1. `/music` 主内容还是 `fixture-repository`，没有真实搜索和真实首页
2. 播放器只证明了新壳层可工作，没有新的真实 `track -> stream -> lyric` 数据装配链
3. 新系统虽然不再依赖旧音乐目录，但也还没有完成“真实数据域”的替代

**旧实现给出的关键证据**

来自 `desktop` 分支的旧实现说明了 3 件事：

1. 旧 `Netease` 首页已经打通了：
   - `/api/toplist`
   - `/api/personalized/playlist`
   - `/api/playlist/detail`
2. 旧搜索已经打通了：
   - `/api/search/get/web` 的曲目搜索 `type=1`
   - `/api/search/get/web` 的歌单搜索 `type=1000`
3. 旧音频流不能直接把远端 URL 塞给前端，而是要先请求：
   - `/song/media/outer/url`
   - 再跟随 302
   - 再代理 range / content-range / accept-ranges 等 header

结论：

- 新架构仍然需要 `streamRepository`
- 新 `stream` 路由仍然要做服务端代理，而不是把最终 URL 直接暴露给播放器

**核心方案**

1. 保持 `src/features/music/` 作为唯一音乐实现命名空间
2. 在 `services/providers/netease/` 下新建：
   - `client`
   - `mappers`
   - `repository`
3. 扩展新的 `domain/repositories.ts`，把真实数据域拆成：
   - `MusicSourceRepository`
   - `MusicDiscoveryRepository`
   - `MusicCollectionRepository`
   - `MusicTrackRepository`
   - `MusicLyricRepository`
   - `MusicStreamRepository`
4. 重建新的 `/api/music/*` 读路径，并把音频流代理迁到 `/api/music/stream`
5. 前端不直接 `fetch` Netease，不直接吃上游 payload，只调用新的内部 API 或 repository client
6. `fixture-repository` 不再承担正式主链路，只保留为测试或离线 fallback

**新的领域模型**

在 Phase 1 基础上扩展统一实体：

- `MusicSourceEntity`
  - `key`
  - `name`
  - `enabled`
  - `tabs`
  - `description`
- `MusicTrackEntity`
  - 保留现有字段
  - 继续禁止 provider 原始字段泄漏到 UI
- `MusicCollectionSummaryEntity`
  - `id`
  - `source`
  - `kind`
  - `title`
  - `coverUrl`
  - `description`
  - `trackCount`
  - `accentColor`
- `MusicCollectionEntity`
  - `summary`
  - `curator`
  - `updatedAtLabel`
  - `tracks`
- `MusicHomeSectionEntity`
  - `id`
  - `title`
  - `tab`
  - `kind`
  - `description`
  - `collections`
  - `tracks`
- `MusicSearchResultEntity`
  - `query`
  - `tracks`
  - `collections`
- `MusicTrackPlaybackEntity`
  - `track`
  - `streamUrl`
  - `quality`

**新的 repository 边界**

新接口按职责拆分，而不是继续保留一个过宽的 `MusicRepository`：

- `MusicSourceRepository`
  - `getSources(): Promise<MusicSourceEntity[]>`
- `MusicDiscoveryRepository`
  - `getHomeView(source: MusicSourceKey): Promise<MusicHomeView>`
  - `search(source: MusicSourceKey, query: string, page?: number): Promise<MusicSearchResultEntity>`
- `MusicCollectionRepository`
  - `getCollection(source: MusicSourceKey, id: string): Promise<MusicCollectionEntity>`
- `MusicTrackRepository`
  - `getTrackPlayback(source: MusicSourceKey, id: string, quality?: MusicPlaybackQuality): Promise<MusicTrackPlaybackEntity>`
- `MusicLyricRepository`
  - `getLyrics(source: MusicSourceKey, trackId: string): Promise<LyricDocumentEntity>`
- `MusicStreamRepository`
  - `buildStreamPath(source: MusicSourceKey, trackId: string, quality?: MusicPlaybackQuality): string`
  - `createStreamResponse(request: Request): Promise<Response>`

**新的 API 形状**

Phase 2 重建的新读路径统一放回 `/api/music/*`：

- `GET /api/music/sources`
- `GET /api/music/home?source=netease`
- `GET /api/music/search?source=netease&q=<query>&page=<page>`
- `GET /api/music/collection?source=netease&id=<playlistId>`
- `GET /api/music/track?source=netease&id=<trackId>&quality=standard|high`
- `GET /api/music/lyric?source=netease&id=<trackId>`
- `GET /api/music/stream?source=netease&id=<trackId>&quality=standard|high`

关键约束：

- 新路由只能调用 `src/features/music/services/providers/netease/*`
- 路由不能再 import 已删除的 `src/lib/music/*`
- 统一错误结构继续返回 `{ error: string }`
- `stream` 路由必须保留 range / content-range / accept-ranges / content-type 转发能力

**客户端数据流**

前端新增一个新的数据装配层，不把 HTTP 细节散进组件：

- `music-api-client`
  - 只负责调用 `/api/music/*`
- `music-data-store`
  - 管当前 source、首页数据、搜索态、已打开的合集详情、加载态和错误态
- `MusicShell`
  - 页面挂载时 bootstrap `sources + home`
- `MusicTopBar`
  - 驱动 `search`
- `MusicHero`
  - 不再只播 fixture 队列，而是从真实 `spotlight` 或 section 派生播放入口
- `MusicCollectionView`
  - 展示真实歌单详情与曲目列表

**播放器接线调整**

播放器需要从“已有 queue 就播”升级成“拿到真实 track payload 再播”：

- 点击首页曲目 / 搜索曲目 / 歌单曲目时：
  1. 调 `trackRepository.getTrackPlayback`
  2. 将 `streamUrl` 与统一 `track` 写入 `playbackStore`
  3. 调 `lyricRepository.getLyrics`
  4. 再让 `audio-engine` 加载并播放
- `MusicMiniPlayer` 和 `MusicFullPlayer` 不再依赖 fixture 先验
- `MusicPlayerRoot` 需要监听当前曲目切换并触发 `audio-engine.load`

**错误处理**

- 搜索空结果：
  - 返回空数组，不报错
  - UI 显示 “No results”
- 版权或会员受限曲目：
  - `track` 路由返回 403
  - UI 给出可恢复提示，不清空当前队列
- 歌词缺失：
  - 返回空 `lines`
  - 歌词面板显示 empty state
- 上游超时：
  - route 返回 502
  - `music-data-store.error` 写入面向用户的提示
- 桌面模式：
  - middleware 已在 `APP_TARGET=desktop` 时跳过 Web 认证
  - 新 `/api/music/*` 不额外发明第二套桌面鉴权逻辑

**测试策略**

Phase 2 至少补 4 层测试：

1. provider / mapper 测试
   - `Netease` 首页、搜索、歌单、歌词、stream URL 映射
2. route 测试
   - `/api/music/*` 的 query、错误和响应结构
   - `/api/music/stream` 的代理行为
3. store / UI 测试
   - 搜索触发
   - 首页加载
   - 打开歌单
   - 点曲播放
4. smoke 测试
   - 打开 `/music`
   - 加载真实首页
   - 搜索真实关键字
   - 点播真实曲目
   - 展示歌词与队列

**验收标准**

- 正式 `/music` 默认不再依赖 `fixture-repository` 驱动主流程
- 新 `/api/music/*` 已恢复，但实现完全位于 `src/features/music/`
- `Netease` 首页、搜索、歌单、歌词、stream 在新架构下工作
- 新播放器可以从真实曲目装配 queue、stream 和 lyric
- 新实现里没有重新引回 `src/lib/music/*`、`music-client`、`musicPlayerStore`
- 自动化测试覆盖 provider、route、store、UI 和 smoke 关键路径

**后续阶段**

- **Phase 3**
  - 多 provider 扩展：`Audius` / `Jamendo`
  - 账号能力：收藏、历史、我的歌单、每日推荐、FM、设置
- **Phase 4**
  - 桌面能力：媒体键、托盘、缓存、下载、离线资源管理

**里程碑**

1. 扩展新的统一领域模型和 repository 接口
2. 建立新的 `Netease` provider 层
3. 重建新的 `/api/music/*` 和 `/api/music/stream`
4. 用真实首页 / 搜索 / 歌单接管 `/music`
5. 用真实 track / lyric / stream 接管播放器
6. 跑通 Phase 2 smoke 验证
