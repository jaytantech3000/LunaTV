# LunaTV Feature Log

本文件用于记录本项目“新功能”的开发轨迹，避免把阶段性实现细节、回归记录和后续待办堆进 `Agent.md`。

## 使用约定

- 新纪录按时间倒序追加，最新的放在最上面。
- 只记录“功能级”变更，不记录琐碎的重命名、格式化或纯注释修改。
- 每条记录尽量包含：目标、核心改动、验证结果、后续待办。
- 若功能有详细方案文档，优先链接到 `dev-plan/` 下的对应文件。

---

## 2026-06-09 - 桌面 dev 下载链路修复

- 分支：`desktop-foundation`
- 相关文件：
  - `src/lib/download/manager.ts`
  - `src/lib/download/normalize.ts`
  - `src/lib/download/proxy-url.ts`
  - `src/app/api/proxy/vod/*`
  - `package.json`

### 目标

- 修复桌面开发模式下“在线播放正常，但下载链路不可用/不稳定”的问题。
- 让桌面 dev 继续复用现有浏览器下载实现，而不要求每次验证都重新打包桌面产物。

### 核心实现

- 下载器不再直接复用桌面播放链路的 `127.0.0.1:8787` 绝对 VOD 代理地址。
- 在桌面 dev 下，下载专用 manifest URL 改为同源 `/api/proxy/vod/*`，以便 Service Worker 能接管缓存命中。
- Next dev 的 VOD 代理路由在桌面 dev 下改为转发到本地 `8787`，并对 m3u8 返回内容做同源重写，保证后续 manifest / segment / key URL 都留在同源空间。
- `desktop:dev:frontend` 同时开启 `ENABLE_PWA_DEV=true`，让桌面 dev 环境具备离线缓存验证所需的 Service Worker。

### 当前约束

- 这次修复针对桌面 dev 验证链路。
- 桌面打包态若要稳定支持下载/离线播放，后续仍应补一套真正的本地下载运行时，而不是继续长期依赖浏览器缓存模型。

## 2026-06-09 - 桌面开发启动链路稳定化

- 分支：`desktop-foundation`
- 相关文件：
  - `scripts/desktop-dev-launcher.mjs`
  - `scripts/desktop-dev-bootstrap.mjs`
  - `package.json`
  - `src-tauri/tauri.conf.json`

### 目标

- 把桌面开发环境收敛成一条稳定的本地启动命令，避免 `tauri dev` 先起壳层、前端 `3000` 未就绪时出现白屏。
- 在不进入完整打包流程的前提下，自动处理本地残留的桌面开发进程。

### 核心实现

- `pnpm desktop:dev` 改为先执行 `scripts/desktop-dev-launcher.mjs`，先把桌面前置条件准备好，再拉起 `tauri dev`。
- `beforeDevCommand` 保留为 `scripts/desktop-dev-bootstrap.mjs`，但在顶层启动器已完成预检时会自动短路，不再与壳层启动抢时序。
- 启动脚本会先同步桌面 sidecar，再检查并处理两个已知问题：
  - `127.0.0.1:3000` 没有可用的 LunaTV 前端 dev server 时自动拉起；
  - `127.0.0.1:8787` 被仓库内残留 `moontv-local-service` 占用时自动清理。
- 如果 `3000` 已有健康的仓库内前端 dev server，则直接复用，不重复再起一份。
- 如果端口被非本项目进程占用，会直接失败并输出明确提示，避免误杀其它程序。

### 使用约定

- 桌面开发统一入口保持为 `pnpm desktop:dev`。
- `3000` 只用于桌面开发时的 Next 前端热更新服务，不属于桌面应用发布态。
- `8787` 仍然由桌面壳层启动的 Rust 本地服务占用，前端只通过本地服务访问数据面。

## 2026-06-09 - 桌面版产品方向纠偏：以 Web 功能复刻为主线

- 分支：`desktop-foundation`
- 方案文档：
  - `dev-plan/desktop-foundation/desktop-first-platform-blueprint.md`
  - `dev-plan/desktop-foundation/desktop-local-service-protocol-v1.md`

### 目标

- 明确桌面版不是 Luna / Nova Web 部署的轻量客户端，而是独立部署形态。
- 桌面版后续以“尽量复刻 Web 版全部功能”为目标推进，本地多用户和本地管理能力纳入主线。
- 多端帐号互通与用户数据同步不再作为当前主线，记录后延后到桌面功能完善之后。

### 结论更新

- 之前“桌面 v1 只保留本地运行主链路、后台降级、只同步帐号/用户数据”的结论失效。
- 正确方向改为：
  - 复用现有 Web 前端页面和交互，优先避免再维护一套桌面专用管理界面。
  - 本地 Rust 服务逐步补齐 `/api/admin/*`，让桌面直接承载与 Web 接近的后台能力。
  - 本地配置需要覆盖站点设置、视频源、直播源、分类、用户组、儿童帐号等能力。
- `profile_sync.api_base_url` 仍保留，但退回为后续可选扩展，不再决定桌面版边界。

### 后续落点

- 先打通桌面端对现有 `/admin` 页面的复用。
- 再把本地多用户认证、用户配置和其它 Web 后台能力逐步接回。
- 多端帐号同步单独记录，待桌面版能力完整后再进入实现阶段。

## 2026-06-09 - 桌面帐号与用户数据同步链路

- 分支：`desktop-foundation`
- 方案文档：
  - `dev-plan/desktop-foundation/desktop-first-platform-blueprint.md`
  - `dev-plan/desktop-foundation/desktop-local-service-protocol-v1.md`

### 目标

- 保持桌面端搜索、播放、代理、下载完全本地化。
- 仅把帐号认证和用户资料同步到 Web 后端，打通桌面版与网页版帐号互通。
- 避免桌面前端直接访问远端 Web 接口，统一收口到本地 Rust 服务代理。

### 核心实现

- Rust 本地服务新增账号同步代理接口：
  - `GET /api/profile-sync/status`
  - `GET /api/server-config`
  - `POST /api/login`
  - `POST /api/logout`
  - `POST /api/change-password`
  - `GET/POST/DELETE /api/playrecords`
  - `GET/POST/DELETE /api/favorites`
  - `GET/POST/DELETE /api/searchhistory`
  - `GET/POST/DELETE /api/skipconfigs`
- 本地服务通过 `reqwest` cookie store 代持远端登录态，桌面前端始终只请求本地 `127.0.0.1:8787`。
- 桌面运行时配置新增 `PROFILE_SYNC_*` 投影，启动后先同步本地运行时配置，再同步账号同步状态。
- 桌面登录页、用户菜单和管理面板改为识别两种模式：
  - 未配置 `profile_sync.api_base_url`：本地桌面认证回退
  - 已配置 `profile_sync.api_base_url`：云端帐号同步模式
- 用户数据客户端存储策略改为动态判断：
  - Web 远端存储模式继续走原有 API
  - 桌面启用账号同步时也走本地服务代理 API
  - 桌面未启用账号同步时保持本地存储
- 本地配置示例和桌面文档补充 `profile_sync.api_base_url` 说明。

### 验证结论

- `cargo check --workspace` 已通过。
- `pnpm typecheck` 已通过。
- 当前验证以 `tauri dev` 为主，不重复进入完整打包流程。

### 当前约束

- 远端会话目前由本地服务内存持有，重启桌面应用后需要重新登录。
- 仅同步帐号与用户资料；离线下载、媒体缓存、资源站配置仍然完全本地。
- 管理面板继续以本地服务与本地配置运维为主，不等同于 Web 版完整后台。

## 2026-06-09 - 桌面应用 v1 首版闭环

- 分支：`desktop-foundation`
- 方案文档：
  - `dev-plan/desktop-foundation/desktop-first-platform-blueprint.md`
  - `dev-plan/desktop-foundation/desktop-local-service-protocol-v1.md`

### 目标

- 让桌面版从“桌面基础设施可构建”推进到“桌面主链路可用”。
- 补齐静态前端在桌面壳中的运行时配置同步。
- 打通直播播放所需的本地服务接口与媒体代理链路。

### 核心实现

- Rust 本地服务新增桌面运行时配置投影接口：
  - `GET /runtime/public-config`
  - `GET /api/runtime/public-config`
- Rust 本地服务补齐直播数据面：
  - `GET /live/sources`
  - `GET /live/channels`
  - `GET /live/epg`
  - `GET /live/precheck`
  - `GET /media/live/m3u8`
  - `GET /media/live/segment`
  - `GET /media/live/key`
  - `GET /media/live/logo`
  - 以及对应 `/api/*` 兼容路径
- 本地服务增加 M3U 解析、EPG 解析、直播源内存缓存、直播 manifest 重写与 Range 透传能力。
- 前端增加桌面运行时同步层：
  - `src/components/DesktopRuntimeSync.tsx`
  - `src/lib/desktop/runtime-config.ts`
  - 启动时从本地服务同步 `ENABLE_WEB_LIVE`、`CUSTOM_CATEGORIES`、豆瓣代理配置和站点展示信息。
- 设置面板保存/重启本地服务后会主动刷新桌面运行时配置，导航和相关页面可跟随更新。

### 验证结论

- `cargo test -p moontv-local-service` 已通过。
- `pnpm typecheck` 已通过。
- `pnpm desktop:check` 已通过。
- `pnpm desktop:build:frontend` 已通过。
- `pnpm desktop:build` 已通过。
- 当前产物：
  - `target/release/bundle/macos/LunaTV Desktop.app`
  - `target/release/bundle/dmg/LunaTV Desktop_0.1.0_x64.dmg`

### 当前约束

- Web 完整管理后台仍然不是桌面 v1 的主目标；桌面端只保留本地管理面板。
- 多用户、远程共享存储、配置订阅自动更新仍未纳入桌面 v1。
- 本地配置修改后，发现页与导航会刷新；若用户正在播放或停留在复杂页面，建议按桌面应用常规重新进入相关页面完成重建。

## 2026-06-04 - 离线下载与离线播放 v1

- 分支：`cache-and-download`
- 里程碑提交：`a95a673`
- 方案文档：
  - `dev-plan/cache-and-download/plan-d-recommended-offline-download.md`
  - `dev-plan/cache-and-download/plan-d-implementation-checklist.md`

### 目标

- 提供剧集离线下载能力。
- 在 `/downloads` 页面集中管理下载任务和已下载内容。
- 支持从已下载内容直接进入离线播放。
- 在断网场景下尽可能维持已缓存内容可播放。

### 核心实现

- 新增 VOD same-origin 代理链路：
  - `src/app/api/proxy/vod/m3u8/route.ts`
  - `src/app/api/proxy/vod/segment/route.ts`
  - `src/app/api/proxy/vod/key/route.ts`
- 新增离线下载核心模块：
  - `src/lib/download/*`
  - `src/stores/downloadStore.ts`
  - `worker/index.ts`
- 新增下载相关页面与组件：
  - `src/app/downloads/page.tsx`
  - `src/components/CurrentEpisodeDownloadControl.tsx`
  - `src/components/DownloadsClient.tsx`
  - `src/components/DownloadSessionSync.tsx`
- 播放页接入在线/离线双模式：
  - `src/app/play/page.tsx`
  - 离线模式支持缓存读取、播放进度恢复、选集切换、缺失资源校验。
- 本地生产预览链路补齐：
  - `scripts/start-standalone-preview.sh`
  - `package.json` 中新增 `pnpm preview:offline`

### 本阶段已处理的问题

- 下载过程中任务顺序和状态显示异常。
- 批量下载交互重做为弹窗选集模式，支持全选、单选、反选、从当前集开始选。
- 下载失败后“重试/取消”状态不一致的问题。
- 离线播放切断网络后无法继续播放的问题。
- 离线模式切换选集会丢失播放进度的问题。
- 下载页存在活动下载任务时，从 `/downloads` 点击“离线播放”无响应/不稳定的问题。
- 桌面版 `pnpm desktop:dev` 下，下载链路误用 `127.0.0.1:8787` 绝对代理地址，导致 Service Worker/Cache Storage 无法稳定接管的问题。
- 下载任务报错只显示浏览器原始 `Load failed`，难以定位具体失败 manifest 的问题。
- 下载中“总大小”实际为动态估算值，但界面未明确提示，容易被误解为固定文件大小的问题。

### 验证结论

- `pnpm build` 已通过。
- 本地离线链路需使用 `pnpm preview:offline` 验证，不能只看 `pnpm dev`。
- 桌面版开发模式下，VOD 下载入口现在会统一改写到同源 `/api/proxy/vod/*`，并兼容把已播放代理 URL 再归一化为下载地址。
- 当前机器上《铁拳教育》至少 `bfzy/dbzy/feifan/hhzy/jyzy` 的第 1 集 manifest 代理链路可达；其中 `ikun/jszy` 上游仍存在源站侧失败。
- 下载中的大小展示已改为显式区分“已下载 / 预估大小”，并在估算值前显示“约”。
- 已做过的关键回归：
  - 在线播放正常起播。
  - 单集下载后可从 `/downloads` 进入离线播放。
  - 同页在线播放切换到离线播放可正常重建播放器。
  - 离线播放开始后切断网络，播放时间仍能继续推进。
  - 有活动下载任务时，从 `/downloads` 点击已下载条目的“离线播放”可进入播放页并起播。

### 当前约束

- Web 版离线资源仍基于浏览器缓存，不支持选择系统目录或直接打开系统文件夹。
- 离线能力依赖浏览器支持 Cache Storage、IndexedDB、Service Worker。
- `next dev` 默认不是完整离线验证环境。

### 后续建议

- 把下载目录设置、桌面端文件系统接入放到独立能力设计中，不要与当前浏览器缓存方案混用。
- 对下载任务恢复、失败分类、资源清理策略补更多自动化测试。
- 若后续加入 Background Fetch，应保持现有缓存结构和播放入口不变，在 v1 架构上增强。
