# LunaTV 桌面 Rust 化第一阶段执行清单（下载系统）

配套文档：

- `dev-plan/desktop-foundation/desktop-rustification-roadmap.md`
- `dev-plan/desktop-foundation/desktop-local-service-protocol-v1.md`
- `dev-plan/desktop-foundation/desktop-rust-evolution-execution-plan.md`

> 说明：
>
> - 这份文档对应 `desktop-rustification-roadmap.md` 中的 Phase 1。
> - 它不是历史上的 `phase-1-repo-refactor-checklist.md`。后者解决的是仓库解耦与 Next route 抽离，这份文档解决的是“桌面视频下载执行链路从 TS 迁到 Rust”。

## 第一阶段目标

把桌面版的视频下载系统收口到 Rust 执行，形成下面的职责边界：

- Rust 本地服务负责下载任务模型、调度、续传、持久化和后台执行
- TypeScript 前端只负责发起命令、订阅状态、渲染下载界面
- `src-tauri` 继续只负责桌面壳、服务生命周期和原生能力，不接手下载业务编排

第一阶段完成后，桌面下载主执行路径不应再由 `src/lib/download/manager.ts` 负责网络抓取与任务推进。

## 为什么先做下载系统

- 下载是最典型的桌面后台任务，天然需要长生命周期、并发、重试、暂停、恢复和断点续传
- 当前桌面本地服务已经有缓存、资源索引、快照存储能力，具备继续下沉的基础
- 这块业务从 TS 迁到 Rust 的收益最大，也最能拉开桌面版与 Web 版的架构边界

## 范围

### 本阶段纳入

- 桌面模式下的视频下载任务执行链路
- 单集下载、批量下载、下载页批量控制
- 暂停、继续、取消、重试
- 断点续传与应用重启后的任务恢复
- 下载状态、进度、错误信息、速度统计的统一事件通道
- 桌面下载 UI 对 Rust 本地服务的统一 SDK 适配

### 本阶段不纳入

- 应用更新下载器
- 搜索、详情、代理的全面 Rust 化
- Web 版下载实现改造
- 播放器内核迁移
- 为了拆 crate 而做的大规模重命名或 packaging 改造

## 当前基线

### 已经在 Rust 侧存在的能力

- `crates/moontv-local-service/src/lib.rs` 已经承接桌面下载运行时存储接口：
  - `/api/download-runtime/cache`
  - `/api/download-runtime/cache/meta`
  - `/api/download-runtime/cache/response`
  - `/api/download-runtime/storage-info`
  - `/api/download-runtime/resource-index`
  - `/api/download-runtime/resource-index/all`
  - `/api/download-runtime/store`
- 本地服务已经具备 `text/event-stream` 输出能力，后续下载事件优先复用 SSE 技术路线，而不是先上 WebSocket
- `src-tauri/src/lib.rs` 中的应用更新下载已支持暂停、取消和断点续传，但这是另一条业务链路，不应在本阶段强行与视频下载器合并

### 仍在 TypeScript 侧承担执行的能力

- 下载执行器：`src/lib/download/manager.ts`
- 当前集下载控件：`src/components/CurrentEpisodeDownloadControl.tsx`
- 下载管理页：`src/components/DownloadsClient.tsx`
- 批量下载入口：`src/components/BatchEpisodeDownloadDialog.tsx`
- 会话和快照辅助：`src/lib/download/session.ts`、`src/lib/download/desktop-runtime.ts`

## 架构决策

### 1. 主链路继续保持 HTTP 与文件语义

播放器和下载器天然消费 URL、`Range`、文件片段和缓存文件。桌面版下载系统 Rust 化后，仍应保持：

- manifest、segment、key 拉取语义不变
- 本地缓存文件可直接被本地服务读取与响应
- `Range` / `Content-Range` 行为不回退

不建议把视频下载主链路改成大量 Tauri command 或 IPC 数据流。

### 2. 前端只保留一个桌面下载访问边界

桌面前端不再直接依赖具体执行器，而是统一通过一个桌面下载 SDK 或 adapter 层访问：

- 发起任务
- 控制任务
- 查询任务列表
- 订阅任务事件

推荐把这个入口收敛到 `src/lib/download/desktop-runtime.ts`，必要时继续拆分，但不要让页面和组件直连本地服务细节。

### 3. 状态同步优先使用 SSE，轮询只做兜底

当前已落地的下载事件流接口：

- `GET /api/download-runtime/tasks/stream`

当前事件负载采用“全量 snapshot + `lastEvent` 增量提示”模型，`lastEvent` 当前至少覆盖：

- `taskUpserted`
- `taskStatusChanged`
- `taskRemoved`
- `maxConcurrentTasksChanged`

桌面 SDK 需要同时支持：

- 首选 SSE 订阅
- SSE 不可用时回退到轻量轮询

### 4. 迁移期允许双执行器并存，但同一时刻只启用一个主执行器

迁移窗口内可以同时保留：

- TS 下载执行器
- Rust 下载执行器

但单个桌面 profile 在任一时刻只能选一个主执行器，避免双写同一任务状态、双下同一资源或相互覆盖快照。

### 5. 不把下载业务继续堆回 `src-tauri`

下载执行、状态机、任务存储、事件流都应落在本地服务或后续 Rust crate 中。`src-tauri` 仅保留：

- 启停本地服务
- 打开目录等桌面原生能力
- 必要的诊断和更新控制

## 目标接口面

第一阶段建议继续沿用 `/api/download-runtime/*` 前缀，并在现有 cache/index/store 接口之外补齐任务协议。

### 建议新增的查询接口

- `GET /api/download-runtime/tasks`
- `GET /api/download-runtime/tasks/:taskId`
- `GET /api/download-runtime/stats`
- `GET /api/download-runtime/tasks/stream`

### 建议新增的命令接口

- `POST /api/download-runtime/tasks`
- `POST /api/download-runtime/tasks/:taskId/pause`
- `POST /api/download-runtime/tasks/:taskId/resume`
- `POST /api/download-runtime/tasks/:taskId/cancel`
- `POST /api/download-runtime/tasks/:taskId/retry`
- `POST /api/download-runtime/tasks/bulk`

### 建议的 Rust 领域对象

- `DownloadTask`
- `DownloadTaskStatus`
- `DownloadCommand`
- `DownloadEvent`
- `DownloadProgressSnapshot`
- `DownloadFailureInfo`
- `DownloadRuntimeStats`

这些类型先不要求一步到位拆成独立 crate；第一阶段可以先在 `moontv-local-service` 内模块化落地，稳定后再抽 `moontv-download`。

## 执行清单

### A. 冻结前端访问边界

- [x] 明确桌面下载页、当前集下载控件、批量下载弹窗只能通过统一下载 SDK 访问运行时
- [x] 停止新增直接依赖 `downloadManager` 的桌面 UI 调用点
- [x] 为桌面模式保留“执行器选择开关”，便于 pre 阶段灰度切换（现已收口为 runtime config + 构建脚本 override；默认 Rust，`pnpm desktop:dev:legacy-download` / `pnpm desktop:build:legacy-download` 可显式切回 TS 兼容执行器）
- [x] 保证 Web 版路径不被桌面下载器迁移误伤（桌面 runtime / 非 runtime 分流仍由 `manager.runtime.test.ts` 与 `manifest.runtime.test.ts` 覆盖，Web 版继续走原有 TS 下载实现）

当前进展（2026-06-25）：

- `src/lib/download/client.ts` 已落地为统一 facade，`DownloadsClient`、`CurrentEpisodeDownloadControl`、`BatchEpisodeDownloadDialog` 与 `src/lib/download/session.ts` 均改为通过这层访问下载执行能力。
- ESLint 现已禁止 `src/app/*` 与 `src/components/*` 的非测试代码直接 import `@/lib/download/manager`，避免桌面 UI 新增绕过 facade 的调用点。

### B. 定义 Rust 下载任务模型与持久化边界

- [x] 定义任务主模型、状态枚举、命令模型、事件模型
- [x] 定义任务快照、资源进度、失败原因、断点续传元数据
- [x] 复用现有 cache/resource-index/store 结构，补齐缺少的任务仓储抽象
- [x] 明确哪些状态是内存态，哪些状态必须落盘

### C. 在本地服务补齐任务 CRUD 与控制接口

- [x] 提供任务创建、列表、详情、暂停、继续、取消、重试接口
- [x] 提供批量控制接口，覆盖下载页的全部暂停、全部继续 / 重试、全部停止
- [ ] 统一错误码和错误消息，避免前端依赖字符串猜测
- [x] 保持旧有 cache/index/store 接口兼容

当前进展（2026-06-25）：

- `crates/moontv-local-service/src/download_runtime.rs` 已接手 download runtime 的 cache / resource-index / store / tasks 路由、SSE 事件流与缓存响应辅助；`lib.rs` 主要保留 `AppState` 持久化方法与路由装配，避免继续把下载逻辑堆回单文件 facade。
- [x] task 控制面现已补齐 `GET /api/download-runtime/tasks/:taskId`、`POST /api/download-runtime/tasks/:taskId/retry` 与 `POST /api/download-runtime/tasks/bulk`；现有 `create/list/settings/pause/resume/cancel/delete` 路由也已继续保留。
- [x] 桌面 manifest 的 fallback、抓取、playlist 解析、资源展开与缓存已新增 Rust runtime 主路径：`/api/download-runtime/manifest/resolve`，桌面 `src/lib/download/manifest.ts` 仅保留 Web / 非 runtime fallback。
- [x] 桌面资源抓取新增 Rust runtime 主路径：`/api/download-runtime/cache/fetch` 会直接解析 `/media/vod/*` / `/api/proxy/vod/*` URL、在 local service 内抓取资源并写入 runtime cache；桌面 `src/lib/download/manager.ts` 在 runtime 开启时不再自己执行资源 `fetch + putDownloadResponse`。
- `crates/moontv-local-service/src/download_runtime.rs` 现已新增 runtime scheduler/worker，负责 queued 任务并发调度、manifest candidate fallback、resource-index 写入、资源 cache 抓取，以及进度 / `done` / `error` 状态持久化，并会在路由启动与任务变更后自动触发调度。
- `src/lib/download/manager.ts` 在桌面 runtime 开启时不再启动浏览器侧任务 runner，主要保留任务创建 / 控制、Web / 非 runtime fallback 与兼容层；其中单任务 `error -> retry` 与 `pauseAll / resumeAll / cancelAll` 已显式切到 runtime `retry` / `bulk` 接口。
- `src/components/DesktopDownloadStoreSync.tsx` 现在会把 runtime `done` 任务回填到 `library`，并把自身进一步收缩成“启动修复 + sidecar snapshot 持久化”角色。

### D. 建立下载事件流

- [x] 为任务进度和状态变化提供 SSE 输出
- [x] 为 UI 提供初始快照 + 增量事件的订阅模型
- [x] 约定事件幂等字段，避免前端重复消费时状态错乱
- [x] 在 SDK 中保留轮询兜底路径

### E. 实现 Rust 执行引擎

- [x] 把资源下载、并发调度、任务推进与最终执行器切换迁入 Rust（桌面 runtime 模式下，manifest candidate fallback、资源抓取、resource-index 写入、进度推进与最终 `done / error` 持久化都已由 local service 接手）
- [x] 支持暂停、继续、取消、重试
- [x] 继续支持断点续传，不因执行器迁移丢失部分已下载文件
- [x] 应用退出或重启后可恢复任务状态
- [x] 避免对代理链路和缓存文件协议造成回退

### F. 完成桌面 UI 切换

- [x] `DownloadsClient` 改为消费下载 SDK，不再直接驱动 TS 执行器
- [x] `CurrentEpisodeDownloadControl` 改为只发命令和订阅状态
- [x] `BatchEpisodeDownloadDialog` 改为消费统一任务视图
- [x] 保持现有页面文案、批量操作和状态展示的一致性（下载设置页已显式展示当前执行器模式；批量控制、状态回填与离线片库展示继续由 `DownloadsClient.test.tsx`、`manager.runtime.test.ts` 等回归覆盖）

### G. 清理旧路径

- [x] 桌面默认执行器切到 Rust
- [x] 保留一个可回退窗口，用于 pre 验证期快速切回 TS 执行器
- [x] 确认桌面 runtime 模式下的下载网络抓取不再由 `src/lib/download/manager.ts` 承担
- [ ] 迁移稳定后，删除桌面专用的 TS 下载执行逻辑

## 建议按 PR 拆分

### PR 1：前端边界冻结

目标：

- 收敛桌面下载入口
- 引入执行器开关
- 不改变当前下载执行结果

### PR 2：Rust 模型与仓储骨架

目标：

- 定义任务、事件、命令、快照模型
- 为 store/index/cache 建立更明确的仓储边界

### PR 3：本地服务任务接口

目标：

- 先打通命令、查询、列表和详情
- 暂时不切主执行路径

### PR 4：下载事件流

目标：

- 用 SSE 把任务状态推送给桌面前端
- 保留前端轮询兜底

### PR 5：Rust 执行引擎最小闭环

目标：

- 先打通单任务创建、下载、暂停、继续、取消、完成
- 先覆盖最关键链路，再扩展批量与全局控制

### PR 6：桌面 UI 切换到 Rust 执行器

目标：

- 下载页、当前集控件、批量下载入口全部切换
- 保留 TS 执行器回退开关（已落地为 `NEXT_PUBLIC_DESKTOP_LOCAL_DOWNLOAD_RUNTIME` + `pnpm desktop:dev:legacy-download` / `pnpm desktop:build:legacy-download`）

### PR 7：迁移收尾

目标：

- 去掉桌面路径上的 TS 下载执行
- 补齐恢复、重试、批量控制和异常场景

## 文件落点建议

### TypeScript 侧收缩重点

- `src/lib/download/manager.ts`
- `src/lib/download/desktop-runtime.ts`
- `src/lib/download/session.ts`
- `src/components/DownloadsClient.tsx`
- `src/components/CurrentEpisodeDownloadControl.tsx`
- `src/components/BatchEpisodeDownloadDialog.tsx`

### Rust 侧扩展重点

- `crates/moontv-local-service/src/lib.rs`
- `crates/moontv-local-service/src/*` 内部模块
- `crates/moontv-storage/*`
- 后续独立为 `crates/moontv-download/*` 的下载领域代码

### `src-tauri` 侧保持克制

- `src-tauri/src/lib.rs` 只补桌面壳需要的配套能力
- 不新增下载业务状态机
- 不新增媒体主链路 command

## 风险与红线

### 1. 不把应用更新下载器和视频下载器强行合并

两者都可能复用 Rust 底层的文件与断点续传工具，但业务模型、交互节奏和验收标准不同，本阶段不做“同一套下载系统”的强绑定。

### 2. 不允许出现双执行器双写同一任务

迁移期只允许“双执行器并存”，不允许“同一 profile 下两个执行器同时接管同一组任务”。

### 3. 不允许为迁移牺牲协议兼容

以下行为不能回退：

- 缓存文件读取
- 资源索引读取
- 断点续传
- `Range` 语义
- 已有下载页主要交互

### 4. 不允许把本地服务再次做成新的大单文件黑洞

如果第一阶段无法一步拆 crate，也至少要在 `moontv-local-service` 内部先完成模块化，避免继续把下载逻辑堆进单个 `lib.rs`。

## 第一阶段完成标准

- 桌面视频下载执行不再由 `src/lib/download/manager.ts` 承担网络抓取
- 桌面下载页、当前集控件、批量下载入口全部走统一桌面下载 SDK
- 暂停、继续、取消、重试功能与当前版本能力对齐
- 断点续传稳定可用
- 应用重启后任务状态可恢复
- cache/resource-index/store 现有能力不回退
- Web 路径可继续保留自己的下载实现，不被桌面迁移破坏

## 验证清单

### 自动检查

```bash
cargo check --workspace
cargo test --workspace
pnpm typecheck
pnpm desktop:check
pnpm exec jest --runInBand
```

### 手工验收

1. 从播放页发起单集下载，任务能进入下载页并持续推进。
2. 从批量下载入口创建多任务，批量开始、暂停、停止可用。
3. 下载进行中退出应用，再次启动后任务状态可恢复。
4. 暂停后继续应走断点续传，不重复下载已完成字节。
5. 下载失败后重试可恢复到合理状态，不出现永久卡死。
6. 下载缓存、资源索引、已完成文件读取行为不回退。
7. Web 版下载与桌面版下载不会互相污染实现路径。

## 一句话结论

桌面 Rust 化的第一阶段，最值得先落地的是“把桌面视频下载系统从 TS 执行器迁到 Rust 本地服务”，并且要以“统一前端边界 + 本地服务任务协议 + SSE 事件流 + 可回退灰度切换”为主线推进。
