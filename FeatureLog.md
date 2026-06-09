# LunaTV Feature Log

本文件用于记录本项目“新功能”的开发轨迹，避免把阶段性实现细节、回归记录和后续待办堆进 `Agent.md`。

## 使用约定

- 新纪录按时间倒序追加，最新的放在最上面。
- 只记录“功能级”变更，不记录琐碎的重命名、格式化或纯注释修改。
- 每条记录尽量包含：目标、核心改动、验证结果、后续待办。
- 若功能有详细方案文档，优先链接到 `dev-plan/` 下的对应文件。

---

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

- 管理后台仍然不是桌面 v1 的主目标，入口继续保持关闭。
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

### 验证结论

- `pnpm build` 已通过。
- 本地离线链路需使用 `pnpm preview:offline` 验证，不能只看 `pnpm dev`。
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
