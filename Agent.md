# LunaTV Agent Guide

本文件面向在本仓库内工作的自动化 Agent 或开发者，目标是让改动尽快落到正确位置，并避免破坏在线播放、离线下载和配置管理。

新功能开发记录不要继续堆在这里，统一写入根目录的 `FeatureLog.md`。`Agent.md` 只保留相对稳定的项目指引、约束和回归要求。

## Working language

- Use English for project communication, documentation, code comments, and commit messages unless the user explicitly requests Chinese.

## 项目概览

- 技术栈：Next.js 14 App Router、React 18、TypeScript、Tailwind CSS、Zustand、ArtPlayer、HLS.js、next-pwa。
- 项目定位：影视聚合播放应用，包含搜索、详情、在线播放、收藏/播放记录、管理后台，以及离线下载与离线播放。
- 部署形态：生产环境默认 `standalone` 输出；本地生产预览使用 `.next-build`，避免污染 `next dev` 的 `.next` 目录。

## 关键目录

- `src/app`: 页面与 API 路由。重点关注 `/play`、`/downloads`、`/api/proxy/vod/*`。
- `src/components`: UI 组件。下载入口与下载管理主要在 `CurrentEpisodeDownloadControl.tsx`、`DownloadsClient.tsx`。
- `src/lib/download`: 离线下载链路核心，包括缓存、manifest 解析、资源索引、任务调度、播放辅助、Service Worker 适配。
- `src/stores/downloadStore.ts`: 下载任务和离线资源库的 Zustand 持久化状态。
- `worker/index.ts`: 自定义 Service Worker，负责命中离线缓存并拦截 `/api/proxy/vod/*`。
- `scripts/start-standalone-preview.sh`: 本地离线播放验证使用的生产预览启动脚本。
- `dev-plan/cache-and-download`: 离线下载方案和实施清单，涉及架构取舍时优先参考这里。

## 高风险改动点

- VOD 播放链路必须维持 same-origin 代理 URL。不要让 `/play`、优选测速、换源、离线播放直接回退到原始上游 m3u8。
- 涉及播放地址归一化时，优先检查 `normalizeVodDetailForPlayback()` 和相关 helper，保证在线与离线都走同一套 URL 规范。
- 离线播放依赖三层联动：Cache Storage、资源索引（IndexedDB）、Service Worker。只改其中一层通常会留下隐性故障。
- `src/app/play/page.tsx` 耦合度高，包含在线/离线模式、播放器生命周期、集数切换、进度恢复、HLS 初始化。改动后必须做真实播放验证。
- `next.config.js` 里明确把 `/api/proxy/vod/*` 排除在 next-pwa 的通用 API runtime caching 外，这条链路由自定义 worker 接管，不要随意改回去。
- 视频源配置结构变更不是单点改动。若增加字段或修改行为，至少同步检查：
  - `src/lib/config.ts`
  - `src/lib/admin.types.ts`
  - `src/lib/downstream.ts`
  - `src/app/api/admin/source/route.ts`
  - `src/app/admin/page.tsx`

## 本地开发与验证

- 包管理器统一使用 `pnpm`。
- 常规页面开发：`pnpm dev`
- 类型检查：`pnpm typecheck`
- 格式/静态检查：`pnpm lint`、`pnpm lint:strict`、`pnpm format:check`
- 单元测试：`pnpm test`
- 离线下载/离线播放验证：`pnpm preview:offline`

重要说明：

- `pnpm dev` 默认不会提供完整的离线缓存链路，验证下载、Service Worker、离线播放时不要只看开发模式。
- 本地若使用 Redis/Kvrocks 存储，先确保对应服务已启动，并且 `.env.local` 配置有效。
- `preview:offline` 会先构建再启动 standalone 预览，真实行为更接近生产环境。

## 离线下载改动的最低回归清单

- 在线播放正常：打开影片、起播、切换集数、切换源。
- 下载正常：下载当前集、批量下载、暂停、继续、重试、取消、删除。
- 下载页正常：进行中的任务顺序稳定，已下载内容不会因任务刷新而误操作或失去可点击状态。
- 离线播放正常：从 `/downloads` 点击“离线播放”进入播放页并起播。
- 断网验证正常：离线播放开始后切断网络，已缓存内容仍能继续播放。
- 播放进度正常：离线模式切换选集后可恢复对应分集进度。
- 异常恢复正常：资源缺失、缓存损坏、下载中断后重试，不应长期卡在“排队中”或“加载中”。

## 测试与产物约束

- `src/lib/download/*.test.ts` 下已有一些下载链路的 Jest 测试；改动解析、URL 重写、排序、range 处理时优先补在这里。
- 浏览器自动化对离线链路很有价值，但不要把临时截图、日志和 `test-results/` 一起提交。
- 若只做文档或说明性改动，可以不跑完整测试；若动到播放或下载逻辑，至少做一轮真实页面验证。

## 提交前建议

- 先确认改动是否破坏了 `/play` 和 `/downloads` 的基本链路。
- 若新增了环境变量、配置字段或后台表单项，顺手更新 README 或 `dev-plan` 中对应说明。
- 对下载页这类高频状态页面，优先保持订阅粒度稳定，避免整个页面随着任务进度频繁重建。
