# LunaTV 离线下载推荐实施方案

> **推荐实施路径** · 修正版 A 为主 · 预估 3-5 周  
> **二期增强** · Background Fetch（Chromium） · 追加 1-2 周

## 背景

LunaTV 当前已经具备 PWA、HLS.js、ArtPlayer、Zustand 和基础本地缓存能力，但离线下载能力仍为空白。结合现有代码结构，最稳妥的方向不是重做播放器，也不是直接押注 Background Fetch，而是：

1. 先把 VOD 播放链路统一到 same-origin 代理 URL
2. 再通过页面侧下载管理器把 HLS 资源主动写入 Cache Storage
3. 播放时由 Service Worker 命中缓存并返回

该方案可以最大化复用现有架构，降低改造风险，并为二期 Chromium 后台下载预留扩展点。

## 方案结论

### v1 采用

- Cache Storage + Service Worker + 前台分片下载
- 保留现有 ArtPlayer + HLS.js
- 保留 next-pwa，但改为自定义 runtime caching 和 custom worker
- 下载元数据存 Zustand + localStorage，媒体二进制存 Cache Storage

### v1 不采用

- 不采用 IndexedDB + MSE + LocalPlayer 重构
- 不采用纯 Background Fetch 作为主路径
- 不做字节级断点续传
- 不做自动 LRU 回收
- 不支持 DRM / 需要登录态 / 依赖 cookie 的源

### v2 增强

- 对 Chromium 浏览器增加 Background Fetch
- 不改变 v1 的缓存结构、元数据结构和播放入口
- 不支持 Background Fetch 的浏览器自动回退到 v1 前台下载

## 为什么选这个方案

### 相对方案 A 原版

- 保留其低侵入优点
- 修正其对 SW 工作量和 VOD 代理链路改造量的低估
- 明确下载写缓存发生在页面侧，不在 SW 里做自动缓存写入

### 相对方案 B

- 不需要新增一套 LocalPlayer / MSE 播放架构
- 不需要把 HLS 数据流完全迁移到 IndexedDB
- 不引入 iOS Safari / MSE / TS transmux 兼容性主风险

### 相对方案 C

- 先完成所有浏览器都能用的基础能力
- 再把 Background Fetch 当作 Chromium 增强，而不是主方案
- 避免在第一阶段就承担 SW 后台事件恢复和兼容性调试成本

## 关键前置改造

### 1. 扩展视频源配置模型

当前视频源只有：

- `key`
- `name`
- `api`
- `detail`

为了让 VOD 代理和离线下载稳定工作，需要补充：

```ts
interface ApiSite {
  key: string
  api: string
  name: string
  detail?: string
  ua?: string
  referer?: string
}
```

需要同步修改：

- `src/lib/config.ts`
- `src/lib/admin.types.ts`
- `src/app/api/admin/source/route.ts`
- `src/app/admin/page.tsx`
- 配置文件解析与保存逻辑

说明：

- `v1` 仅支持 `ua` 和 `referer`
- 不支持任意自定义 headers
- 不支持依赖 cookie / token 的站点

管理策略固定为：

- `custom` 视频源支持在后台新增、编辑、删除 `api/detail/ua/referer`
- `config` 视频源在后台只展示，不支持在 UI 中修改 `name/api/detail/ua/referer`
- 非 `localstorage` 部署通过 `/api/admin/source` 新增 `edit` 动作支持 `custom` 源编辑
- `localstorage` 部署不增加后台编辑能力，视频源的 `ua/referer` 仅通过 `config.example.json` 或订阅配置维护

### 2. VOD 播放链路统一到代理 URL

当前直播已经使用 `/api/proxy/*` 链路，但 VOD 仍主要直接加载原始 `.m3u8`。  
`v1` 必须新增一套 VOD 专用代理路由：

- `/api/proxy/vod/m3u8`
- `/api/proxy/vod/segment`
- `/api/proxy/vod/key`

规则：

- `m3u8` 路由负责重写 manifest
- 所有重写后的 `segment/key/嵌套 m3u8` URL 必须显式带 `source`
- 上游请求统一带源配置中的 `ua/referer`
- VOD 播放页统一走代理入口
- 直播页维持现状，不参与这次离线下载改造

## v1 架构

```text
Play Page
  ├─ Hls.js 加载 /api/proxy/vod/m3u8
  ├─ 用户点击下载
  ▼
DownloadManager
  ├─ 获取并解析 manifest
  ├─ 下载 key / segment / 子 manifest
  ├─ 写入专用 Cache Storage
  └─ 更新 Zustand downloadStore

Service Worker
  ├─ 拦截 /api/proxy/vod/*
  ├─ 命中专用 Cache 则直接返回
  └─ 未命中则走网络

Downloads Page
  ├─ 展示任务进度
  ├─ 展示已下载内容
  └─ 删除缓存内容
```

## 核心模块设计

### `src/lib/download/types.ts`

```ts
export interface DownloadTask {
  id: string
  contentId: string
  source: string
  vodId: string
  episodeIndex: number
  title: string
  episodeTitle: string
  originalM3u8Url: string
  proxiedM3u8Url: string
  status: 'queued' | 'downloading' | 'paused' | 'done' | 'error'
  progress: number
  totalResources: number
  downloadedResources: number
  sizeBytes: number
  createdAt: number
  updatedAt: number
  errorMessage?: string
}

export interface DownloadedEpisodeMeta {
  episodeIndex: number
  episodeTitle: string
  proxiedM3u8Url: string
  cachedRequestUrls: string[]
  sizeBytes: number
  downloadedAt: number
}

export interface DownloadedContentMeta {
  contentId: string
  source: string
  vodId: string
  sourceName: string
  title: string
  poster: string
  year: string
  desc?: string
  typeName?: string
  doubanId?: number
  episodeTitles: string[]
  ownerUsername: string
  episodes: DownloadedEpisodeMeta[]
  totalSizeBytes: number
}

export interface DownloadSettings {
  autoPrefetchNextEpisode: boolean
  storageSoftLimitBytes: number
}
```

### `src/stores/downloadStore.ts`

固定状态结构：

```ts
interface DownloadStore {
  hasHydrated: boolean
  ownerUsername: string | null
  tasks: DownloadTask[]
  library: DownloadedContentMeta[]
  settings: DownloadSettings
  setHasHydrated: (value: boolean) => void
  setOwnerUsername: (username: string | null) => void
  addTask: (task: DownloadTask) => void
  patchTask: (id: string, updater: (task: DownloadTask) => DownloadTask) => void
  removeTask: (id: string) => void
  upsertContent: (content: DownloadedContentMeta) => void
  removeEpisode: (contentId: string, episodeIndex: number) => void
  clearAll: () => void
  updateSettings: (partial: Partial<DownloadSettings>) => void
}
```

持久化策略：

- `persist + localStorage`
- 只保存任务和元数据
- 不保存二进制媒体
- `contentId` 固定为 `${source}:${vodId}`
- `task.id` 固定为 `${contentId}:${episodeIndex}`

### `src/lib/download/cache.ts`

专门封装 Cache Storage：

- `openManifestCache()`
- `openMediaCache()`
- `putResponse(url, response, kind)`
- `matchResponse(url, kind)`
- `deleteByUrls(urls)`
- `estimateStorageUsage()`
- `clearOfflineCaches()`

缓存名固定为：

- `lunatv-vod-manifest-v1`
- `lunatv-vod-media-v1`

### `src/lib/download/proxy-url.ts`

统一生成所有可缓存的 VOD 代理 URL，禁止业务代码手写字符串拼接。

固定 helper：

- `buildVodManifestProxyUrl(source, upstreamUrl)`
- `buildVodSegmentProxyUrl(source, upstreamUrl)`
- `buildVodKeyProxyUrl(source, upstreamUrl)`

固定 URL 形状：

```text
/api/proxy/vod/m3u8?source=<source>&url=<encoded-upstream-url>
/api/proxy/vod/segment?source=<source>&url=<encoded-upstream-url>
/api/proxy/vod/key?source=<source>&url=<encoded-upstream-url>
```

规范：

- VOD 新代理统一使用 `source` 参数，不复用直播链路中的 `moontv-source`
- query 参数顺序固定为 `source` 在前、`url` 在后
- 不允许在可缓存 URL 上附加时间戳、调试标记、随机参数
- manifest 重写、播放器入口、下载器、删除逻辑都必须调用同一组 helper
- `cachedRequestUrls` 只保存 helper 生成后的 same-origin URL，不保存原始上游 URL

### `src/lib/download/manifest.ts`

负责：

- 拉取代理后的顶层 m3u8
- 递归处理 master playlist
- `v1` 固定选择第一个 media playlist
- 收集：
  - 顶层 manifest URL
  - 目标 media playlist URL
  - key URL
  - segment URL
  - `EXT-X-MAP` 对应资源

规则：

- 遇到 DRM 直接返回不支持错误
- 仅支持标准 HLS VOD
- 忽略广告过滤开关，始终按原始资源图谱缓存
- 顶层 manifest、选中的 media playlist、key、segment、`EXT-X-MAP` 都要写入待缓存资源集合
- master playlist 只选择第一个 media playlist，不保留多清晰度分支

### `src/lib/download/manager.ts`

职责：

- 创建任务
- 下载 manifest / key / segment
- 并发数固定 `3`
- 写入缓存
- 更新进度
- 支持 pause / resume / cancel / delete

行为约束：

- `pause` 只停止后续调度，不做字节级断点
- `resume` 重新解析 manifest，并跳过已缓存 URL
- 页面刷新后，所有 `downloading` 任务重置为 `paused`
- `cancel` 删除未完成任务及已写入的本任务缓存
- `delete` 删除已完成集对应缓存和元数据
- 下载创建时同步保存当前影片的离线播放快照：`source/sourceName/title/poster/year/desc/typeName/doubanId/episodeTitles`
- `manager` 写入 `cachedRequestUrls` 时必须使用 `proxy-url.ts` 生成的 URL

### 离线播放启动闭环

不新增独立播放器页面，固定复用现有 `/play` 页面并增加离线启动模式。

离线播放入口固定为：

```text
/play?offline=1&contentId=<contentId>&episode=<episodeIndex>
```

行为固定为：

- `/downloads` 的“播放”按钮统一跳转到上述 URL
- `/play` 检测到 `offline=1` 后，不再请求 `/api/detail` 或 `/api/search`
- `/play` 直接从 `downloadStore.library` 读取 `DownloadedContentMeta`
- 页面本地合成 `SearchResult` 风格的 `detail`
- `detail.episodes` 由 `DownloadedContentMeta.episodes[].proxiedM3u8Url` 生成
- 初始 `videoUrl` 直接使用对应集的 `proxiedM3u8Url`
- 离线模式下 `availableSources` 固定为空，不显示在线换源结果
- 若 `contentId` 不存在、该集不存在或缓存校验失败，跳回 `/downloads` 并提示重新下载

### `worker/index.js` 或 `worker/index.ts`

新增 custom worker，只处理 `/api/proxy/vod/*`：

- 先查专用缓存
- 命中则返回缓存
- 未命中则走网络
- 不在 SW 中自动写缓存

同时需要自定义 `runtimeCaching`，显式排除默认 `/api/*` 规则对 `/api/proxy/vod/*` 的接管，避免默认 `NetworkFirst + maxEntries=16` 干扰媒体缓存。

### `src/lib/download/session.ts`

负责账号边界：

- 获取当前登录用户
- 校验 `downloadStore.ownerUsername`
- 用户切换时清空离线缓存
- 对外提供：
  - `syncDownloadOwner()`
  - `purgeOfflineDownloads()`

挂钩点固定为：

- 新增轻量客户端组件 `DownloadSessionSync`，挂在 `PageLayout` 内部；不把 `PageLayout` 整体改成 client component
- `syncDownloadOwner()` 在 `DownloadSessionSync` 的 `useEffect` 中执行，用于页面初始化时同步当前 cookie 用户
- `purgeOfflineDownloads()` 在 `UserMenu.handleLogout` 中调用，且必须发生在页面跳转前
- `purgeOfflineDownloads()` 在 `fetchWithAuth()` 捕获 401 时调用，再执行 `/api/logout` 和重定向
- `syncDownloadOwner()` 发现当前 cookie 用户为空或与 `ownerUsername` 不一致时，立即触发 `purgeOfflineDownloads()`

## 页面与交互改造

### 播放页

在选集区域增加下载入口：

- 未下载：显示下载按钮
- 下载中：显示进度
- 已下载：显示已下载状态
- 点击已下载项可跳转到下载管理页或删除

自动预取规则：

- 当前集播放进度超过 `85%`
- 已开启自动预取
- 下一集未下载
- 下一集当前不在任务队列

则以低优先级加入下载队列。

### `/downloads`

新增下载管理页，包含：

- 当前任务列表
- 已下载内容库
- 单集删除
- 离线播放入口
- 存储占用显示
- 异常状态提示

### Sidebar

新增：

- “下载”导航项 -> `/downloads`

### 本地设置

在现有 `UserMenu` 本地设置中新增：

- 自动预取下一集
- 离线缓存软上限

默认值：

- `autoPrefetchNextEpisode = false`
- `storageSoftLimitBytes = 10 * 1024 * 1024 * 1024`

## 安全与账号边界

离线媒体必须和当前登录用户绑定。

新增规则：

- `downloadStore.ownerUsername` 记录创建离线数据的用户名
- 用户主动登出时，清空离线媒体缓存和下载元数据
- 遇到 401 自动注销时，同样清空
- 新登录用户与 `ownerUsername` 不一致时，先清空旧离线数据

清理范围：

- `lunatv-vod-manifest-v1`
- `lunatv-vod-media-v1`
- `downloadStore`

`v1` 不支持多用户共享离线媒体。

注意：

- `/api/logout` 只负责清 cookie，不能替代客户端的 Cache Storage 清理
- 离线媒体删除必须在客户端完成，不能依赖服务端路由

## PWA 与中间件改造

### next-pwa

需要：

- 自定义 `runtimeCaching`
- 接入 custom worker

### 存储持久化

首次发起下载前，固定执行：

- `navigator.storage.estimate()`
- `navigator.storage.persist()`

规则：

- `persist()` 成功：继续下载
- `persist()` 失败：仍允许下载，但弹出非阻塞提示，明确说明浏览器可能在存储压力下清理离线视频
- 存储软上限检查发生在 `persist()` 之后

### middleware

确保以下资源不被认证链路误拦截：

- `/sw.js`
- `/workbox-*.js`
- custom worker 产物

### 离线页

新增：

- `/_offline`

职责：

- 提示当前离线
- 引导用户进入 `/downloads`
- 说明只有已下载内容可离线观看

## 实施顺序

### Phase 1：基础能力

- 扩展视频源配置模型：`ua/referer`
- 后台管理页支持 `custom` 视频源填写和编辑 `ua/referer`
- `config` 视频源只展示 `ua/referer`
- 新增 `/api/proxy/vod/*`
- 新增 `proxy-url.ts`，统一代理 URL 生成规则
- 播放页 VOD 统一切到代理入口

### Phase 2：下载引擎

- 实现 `types.ts`
- 实现 `downloadStore.ts`
- 实现 `cache.ts`
- 实现 `session.ts`
- 实现 `manifest.ts`
- 实现 `manager.ts`
- 打通 `/play?offline=1` 离线启动模式
- 完成单集下载与删除闭环

### Phase 3：SW 与 PWA

- 接入自定义 worker
- 改写 next-pwa runtime caching
- 增加 `/_offline`
- 修正 middleware 放行规则

### Phase 4：UI 与体验

- 播放页下载按钮与状态
- `/downloads` 管理页
- Sidebar 下载入口
- UserMenu 新设置项
- 自动预取下一集

### Phase 5：账号边界

- 登出清理离线缓存
- 401 自动注销清理离线缓存
- 用户切换清理旧离线缓存

### Phase 6：二期增强（可选）

- Chromium Background Fetch
- 关闭标签页继续下载
- 系统级通知和状态恢复

## 测试计划

### 单元 / 逻辑测试

- manifest 解析：
  - 普通 media playlist
  - master playlist -> 选首个 media playlist
  - AES-128 key
  - `EXT-X-MAP`
- URL helper：
  - 同一 `source + upstreamUrl` 始终生成同一代理 URL
  - 所有缓存键均为 same-origin VOD 代理 URL
- 下载器：
  - 创建任务
  - pause / resume
  - cancel / delete
  - 刷新后任务从 `downloading` 回到 `paused`
- 账号边界：
  - 登出清理
  - 401 清理
  - 切换用户清理

### 集成测试

- `/api/proxy/vod/m3u8` 重写后的所有 URL 都带 `source`
- `ua/referer` 能传到上游请求
- 下载完成后断网可播放
- `/play?offline=1` 在断网下不请求 `/api/detail`
- 删除单集只删除该集缓存
- 自动预取能正确加入下一集任务

### 手工验收

1. 下载一集
2. 刷新页面
3. 打开 `/downloads` 查看任务和内容
4. 断网播放已下载内容
5. 删除该集
6. 再次下载
7. 登出，确认离线内容被清空
8. 重新登录其他用户，确认旧离线内容不可见

## 风险与边界

### 明确支持

- 标准 HLS VOD
- AES-128 key
- Chrome / Edge / Firefox / Safari 的基础前台下载

### 明确不支持

- DRM
- 依赖登录态的源
- 任意自定义 headers
- 字节级断点续传
- 自动 LRU 清理
- 质量切换离线缓存
- `config` 视频源在后台 UI 中直接编辑

### 已知风险

- Safari 仍可能在存储压力下清理 Cache Storage
- 部分源站仅靠 `ua/referer` 仍可能不够
- 通过代理下载会放大服务端流量压力

## 工期评估

### v1

- 中高难度
- 预估 `3-5 周`

### v2 Background Fetch

- 在 v1 稳定后追加
- 预估 `1-2 周`

## 最终建议

按以下顺序推进：

1. 修正版 A 作为正式实施方案
2. C 作为二期 Chromium 增强
3. B 不按原案实施，仅保留为未来“强控制离线播放”储备方向

这是当前最符合 LunaTV 代码现状、实现成本和风险控制的路径。
