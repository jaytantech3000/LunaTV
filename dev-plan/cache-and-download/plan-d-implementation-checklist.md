# LunaTV 离线下载实施 Checklist

> 配套主方案：`dev-plan/cache-and-download/plan-d-recommended-offline-download.md`

## 使用方式

- 按阶段顺序推进，不要并行跳阶段。
- 每个阶段结束都要跑一轮最小回归：在线 VOD 播放、换源、直播播放、登录/登出。
- 任何会改动播放链路的 PR，都必须保证 `/play` 仍能在线正常播放后再合并。
- 任何会改动登录态的 PR，都必须覆盖主动登出和 401 自动注销。

## v1 完成标准

1. 在线 VOD 播放统一走 `/api/proxy/vod/*`，不再直连原始 `.m3u8`
2. 单集下载支持创建、暂停、恢复、取消、删除
3. 刷新页面后任务状态能恢复，`downloading` 自动回落到 `paused`
4. `/play?offline=1` 在断网下可播放已下载内容
5. 登出、401 自动注销、用户切换都会清理离线数据
6. `/downloads` 能管理任务、进入离线播放、删除单集
7. `next-pwa`、custom worker、middleware 放行规则全部打通

## 建议 PR 切分

1. PR 1：视频源模型扩展 + `ua/referer` 透传
2. PR 2：VOD 代理路由 + `/play` URL 归一化
3. PR 3：下载基础设施 + 账号边界
4. PR 4：manifest 解析器 + 下载管理器
5. PR 5：离线播放模式
6. PR 6：`/downloads` 页面 + 下载入口 + 导航
7. PR 7：SW/PWA/middleware + `/_offline`
8. PR 8：自动预取 + 测试补齐 + 手工回归
9. PR 9：Background Fetch 二期增强，可选

## Phase 0：基线准备

**目标**

- 先把回归样本和验收口径固定下来，避免后面每个阶段重复猜。

**涉及文件**

- `src/app/play/page.tsx`
- `src/app/live/page.tsx`
- `dev-plan/cache-and-download/plan-d-recommended-offline-download.md`
- 测试夹具目录，可新建 `src/lib/download/__fixtures__/`

**任务**

- [ ] 准备 3 份合成 HLS fixture：普通 media playlist、master playlist、AES-128 + `EXT-X-MAP`
- [ ] 写一份最小手工回归清单：在线播放、换源、直播、登出、401、移动端导航
- [ ] 明确 v1 不覆盖的能力：DRM、cookie 源、离线清晰度切换

**完成标志**

1. 后续各阶段都能复用同一批 fixture 和同一套手工回归项

## Phase 1：视频源模型和头部透传

**目标**

- 让 `ApiSite`、管理后台、配置文件、下游请求都真正理解 `ua/referer`

**涉及文件**

- `src/lib/config.ts`
- `src/lib/admin.types.ts`
- `src/lib/downstream.ts`
- `src/app/api/admin/source/route.ts`
- `src/app/admin/page.tsx`
- `config.example.json`

**任务**

- [ ] 给 `ApiSite` 和 `AdminConfig.SourceConfig` 增加 `ua`、`referer`
- [ ] 更新配置文件读取、合并、保存逻辑
- [ ] 更新 `getAvailableApiSites()` 返回结构，确保 headers 信息不会丢
- [ ] 更新 `searchFromApi()`、`getDetailFromApi()`，按源透传 `ua/referer`
- [ ] 给 `/api/admin/source` 增加 `edit` 动作，仅允许编辑 `custom` 源
- [ ] 更新管理后台 UI：`custom` 源可编辑，`config` 源只读展示
- [ ] 保持 `localstorage` 部署下后台只读约束不变

**完成标志**

1. `custom` 源能在后台新增和编辑 `ua/referer`
2. 搜索和详情请求都能按源带上正确 headers
3. `config` 源不会被后台 UI 误改

## Phase 2：VOD 代理路由和 `/play` URL 归一化

**目标**

- 把 VOD 在线播放入口全部收敛到 same-origin 代理 URL

**涉及文件**

- `src/app/api/proxy/vod/m3u8/route.ts`
- `src/app/api/proxy/vod/segment/route.ts`
- `src/app/api/proxy/vod/key/route.ts`
- `src/lib/download/proxy-url.ts`
- `src/lib/download/normalize.ts` 或同类新文件
- `src/app/play/page.tsx`
- `src/components/EpisodeSelector.tsx`
- `src/lib/utils.ts`

**任务**

- [ ] 新增 VOD 专用代理路由，和直播代理彻底分开
- [ ] `m3u8` 重写时确保所有资源 URL 都显式带 `source`
- [ ] 代理上游请求统一带 `ua/referer`
- [ ] 新增 URL helper，禁止业务侧继续手写代理字符串
- [ ] 新增 `normalizeVodDetailForPlayback()`，统一改写 `detail.episodes`
- [ ] 在 `/play` 初始化、优选测速、换源、离线入口前全部接入归一化层
- [ ] 确保 `EpisodeSelector` 和测速逻辑不再直接消费原始上游 URL
- [ ] 确认直播页仍继续使用旧 `/api/proxy/*` 路由，不被这次改造影响

**完成标志**

1. 在线 VOD 播放时，Network 面板里只出现 `/api/proxy/vod/*`
2. 切换源、优选测速、直接进入 `/play` 都走统一代理 URL
3. 直播链路无回归

## Phase 3：下载基础设施和账号边界

**目标**

- 先把 store、缓存、索引、登录态清理这几层地基打稳

**涉及文件**

- `src/lib/download/types.ts`
- `src/stores/downloadStore.ts`
- `src/lib/download/cache.ts`
- `src/lib/download/resource-index.ts`
- `src/lib/download/session.ts`
- `src/components/DownloadSessionSync.tsx`
- `src/components/PageLayout.tsx`
- `src/components/UserMenu.tsx`
- `src/lib/db.client.ts`
- `src/lib/auth.ts`

**任务**

- [ ] 建立下载任务和离线库的数据模型
- [ ] 新建 Zustand `downloadStore`，只 `persist` 轻量元数据
- [ ] 新建 Cache Storage 封装，固定缓存名
- [ ] 新建 IndexedDB 资源索引层，保存逐片 same-origin URL 列表
- [ ] 实现 `syncDownloadOwner()` 和 `purgeOfflineDownloads()`
- [ ] 新增 `DownloadSessionSync`，挂到 `PageLayout`
- [ ] 在 `UserMenu.handleLogout` 里接入清理逻辑，并保证发生在跳转前
- [ ] 在 `fetchWithAuth()` 的 401 分支里接入清理逻辑
- [ ] 用户切换时自动清空旧用户的离线数据

**完成标志**

1. `localStorage` 中不再保存逐片 URL 数组
2. 主动登出、401 自动注销、切换用户都会清理 Cache Storage、IndexedDB、downloadStore
3. 页面初始化时能基于 cookie 正确判断当前离线数据归属

## Phase 4：manifest 解析器和下载管理器

**目标**

- 打通真正的单集下载、恢复和删除闭环

**涉及文件**

- `src/lib/download/manifest.ts`
- `src/lib/download/manager.ts`
- `src/lib/download/cache.ts`
- `src/lib/download/resource-index.ts`
- `src/lib/download/proxy-url.ts`

**任务**

- [ ] 解析顶层 manifest、递归处理 master playlist
- [ ] 检测 DRM，命中后直接返回不支持错误
- [ ] 选定单一 media playlist 作为离线播放目标
- [ ] 产出 `rootManifestUrl`、`playbackManifestUrl`、资源列表
- [ ] 下载 key、segment、子 manifest、`EXT-X-MAP`
- [ ] 并发固定为 `3`
- [ ] 下载前调用 `navigator.storage.estimate()` 和 `navigator.storage.persist()`
- [ ] 实现 `pause`、`resume`、`cancel`、`delete`
- [ ] `resume` 通过已缓存 URL 和 IndexedDB 资源索引跳过已完成资源
- [ ] 页面刷新后把 `downloading` 任务重置为 `paused`
- [ ] 下载完成时写入 `playbackManifestUrl`、`cacheIndexId`、`resourceCount`

**完成标志**

1. 一集内容可完整下载到 Cache Storage
2. 刷新页面后任务状态正确恢复
3. `cancel` 和 `delete` 都能清干净对应缓存和索引
4. master playlist 下载后不会把离线播放重新带回顶层 master

## Phase 5：离线播放模式

**目标**

- 在不新增播放器页面的前提下，打通 `/play?offline=1`

**涉及文件**

- `src/app/play/page.tsx`
- `src/stores/downloadStore.ts`
- `src/lib/download/session.ts`
- `src/lib/download/cache.ts`
- `src/lib/download/resource-index.ts`

**任务**

- [ ] 识别 `offline=1`、`contentId`、`episode`
- [ ] 离线模式下跳过 `/api/detail` 和 `/api/search`
- [ ] 从 `downloadStore.library` 本地拼装 `SearchResult`
- [ ] `detail.episodes` 使用 `playbackManifestUrl`
- [ ] 进入播放前校验 manifest 缓存和资源索引是否存在
- [ ] 缓存缺失时跳回 `/downloads` 并提示重新下载
- [ ] 离线模式下隐藏在线换源结果
- [ ] 保持现有 ArtPlayer + Hls.js 方案不变

**完成标志**

1. 断网访问 `/play?offline=1` 能直接播放已下载内容
2. 离线模式下不会发出 `/api/detail` 或 `/api/search` 请求
3. master playlist 离线播放不会请求未缓存的其他清晰度

## Phase 6：下载入口、管理页和导航

**目标**

- 把引擎能力接到用户可见 UI

**涉及文件**

- `src/app/downloads/page.tsx`
- `src/components/EpisodeSelector.tsx`
- `src/app/play/page.tsx`
- `src/components/Sidebar.tsx`
- `src/components/MobileBottomNav.tsx`
- `src/components/UserMenu.tsx`

**任务**

- [ ] 新增 `/downloads` 页面，展示任务列表和离线库
- [ ] 支持暂停、恢复、取消、删除、进入离线播放
- [ ] 在播放页选集区增加下载按钮和状态展示
- [ ] 已下载、下载中、未下载三种状态统一映射到 store
- [ ] 增加桌面侧边栏“下载”入口
- [ ] 增加移动端底部导航“下载”入口
- [ ] 在 `UserMenu` 新增自动预取和离线缓存软上限设置

**完成标志**

1. 用户能从播放页发起下载
2. 用户能从 `/downloads` 管理所有任务和内容
3. 桌面和移动端都能进入下载页

## Phase 7：SW、PWA、middleware 和离线页

**目标**

- 让缓存资源真正被 SW 命中，并保证 PWA 资源不会被鉴权误拦截

**涉及文件**

- `worker/index.ts`
- `next.config.js`
- `src/middleware.ts`
- `src/app/_offline/page.tsx`

**任务**

- [ ] 新增 custom worker，只处理 `/api/proxy/vod/*`
- [ ] 命中专用缓存时直接返回，未命中再走网络
- [ ] 改写 `next-pwa` `runtimeCaching`，排除默认 `/api/*` 规则对 VOD 代理的接管
- [ ] 放行 `/sw.js`、`/workbox-*.js`、`/worker-*.js`
- [ ] 新增 `/_offline` 页面
- [ ] 确认 `next build` 后生成的 SW 资源路径和 middleware 白名单一致

**完成标志**

1. `/sw.js` 和 `workbox` 资源在未登录态也能访问
2. 已下载内容断网后由 SW 命中缓存播放
3. 非下载页面在离线且无缓存时能落到 `/_offline`

## Phase 8：自动预取、测试和验收

**目标**

- 在功能闭环已经稳定后，再加自动预取和测试收尾

**涉及文件**

- `src/app/play/page.tsx`
- `src/lib/download/manager.ts`
- `src/lib/download/manifest.ts`
- `src/lib/download/proxy-url.ts`
- `src/lib/download/resource-index.ts`
- 对应测试文件

**任务**

- [ ] 加入下一集自动预取逻辑，阈值固定为播放进度 `85%`
- [ ] 为 `proxy-url.ts` 写单测
- [ ] 为 `manifest.ts` 写单测
- [ ] 为 `resource-index.ts` 写单测
- [ ] 为下载管理器纯逻辑部分写单测
- [ ] 跑完整手工回归：下载、刷新、断网播放、删除、重新下载、登出、切用户、直播
- [ ] 记录已知浏览器差异，特别是 Safari 存储清理行为

**完成标志**

1. 自动预取只会对未下载且不在队列中的下一集生效
2. v1 验收项全部通过
3. 已知风险和不支持项都有明确文档说明

## Phase 9：Background Fetch 二期增强

**前提**

- v1 已稳定上线
- Chromium 路径不影响 Firefox、Safari 的前台下载回退

**涉及文件**

- `src/lib/download/bg-fetch-manager.ts`
- `worker/index.ts`
- `src/lib/download/manager.ts`
- `src/stores/downloadStore.ts`

**任务**

- [ ] 增加能力检测和统一入口分发
- [ ] 接入 `backgroundfetchsuccess`、`backgroundfetchfail`、`backgroundfetchabort`
- [ ] 页面重开后恢复后台任务状态
- [ ] 增加系统通知和取消处理

**完成标志**

1. Chromium 可在关闭标签页后继续下载
2. 非 Chromium 自动回退到 v1 前台下载路径

## 最终验收

1. 在线 VOD 播放、换源、直播播放均无回归
2. 单集下载、刷新恢复、断网播放、删除、再次下载全部正常
3. 登出、401 自动注销、用户切换均不会残留旧离线数据
4. `sw.js`、`workbox-*`、custom worker 资源不会被 middleware 拦截
5. v1 明确不支持项没有被 UI 或文档误承诺
