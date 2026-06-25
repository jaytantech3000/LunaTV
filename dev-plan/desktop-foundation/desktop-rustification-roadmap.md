# LunaTV 桌面版 Rust 化改造路线图

配套文档：

- `dev-plan/desktop-foundation/desktop-first-platform-blueprint.md`
- `dev-plan/desktop-foundation/desktop-local-service-protocol-v1.md`
- `dev-plan/desktop-foundation/desktop-rust-evolution-execution-plan.md`
- `dev-plan/desktop-foundation/desktop-profile-sync-execution-plan.md`

> 最新进展（2026-06-25）：
>
> - Phase 3 中最关键的 profile 资料域收口已经基本打通：`moontv-profile`、`moontv-sync`、local-service profile facade 与桌面前端 profile SDK 都已落地。
> - 桌面本地五个 profile 域已经从浏览器 `localStorage` 真源切到 Rust 本地 store，并带有旧数据兼容迁移。
> - `src/lib/db.client.ts` 已退化为 `src/lib/profile/client.ts` 的兼容出口，桌面 profile 读写主路径不再依赖旧 Web 存储实现。
> - profile sync 状态接口现已带稳定错误分类与同步域元数据，桌面诊断报告也能直接展示这部分状态。
> - Phase 4 已开始收口一块可落地的桌面后台能力：桌面模式下的版本检查与 release history 拉取现已优先走 Tauri / Rust 命令，浏览器侧只保留 Web / 预览态 fallback。
> - 当前 Rust 化主线的后续重点重新回到 Phase 1、Phase 2 与 Phase 4：下载执行器、内容发现 / 媒体网络层，以及桌面后台能力继续收口。

## 目标

这份文档聚焦一个明确方向：

> 桌面版尽量由 Rust 承担网络、后台任务、存储与系统能力，TypeScript 收缩到前端界面、播放器编排和轻量状态展示。

这里的“Rust 化”不是把整个项目翻译成 Rust，而是把桌面版演进为下面这种结构：

- Rust 本地服务负责数据面
- Rust Tauri 壳负责控制面
- TypeScript 只做 UI 与交互

## 结论先行

可以做，但要分阶段落地，不能一次性硬迁。

当前最合理的最终形态不是“很多 Tauri command + 很多前端 fetch 并存”，而是：

- `src-tauri` 只做桌面壳、窗口、系统集成、更新、服务生命周期
- `crates/moontv-local-service` 作为桌面本地 HTTP 服务
- 业务能力逐步沉到 Rust crates
- 前端通过统一的桌面 SDK 访问本地服务

不建议的方向：

- 把媒体主链路改成 IPC 流式传输
- 让前端同时维护 Web API、桌面本地服务、Tauri command 三套业务入口
- 在下载器还没 Rust 化之前，先大规模删除 TS 实现

## 当前现状

### 已经 Rust 化的部分

- Tauri 壳已经负责本地服务启停、配置读写、诊断、认证和更新入口，见 `src-tauri/src/lib.rs`
- 桌面本地下载运行时已经存在，提供缓存、资源索引、快照存储接口，见 `crates/moontv-local-service/src/lib.rs`
- 应用更新下载已经走桌面 Rust 链路，并支持断点续传

### 仍在 TypeScript 的关键后台逻辑

- 视频下载任务调度、暂停/继续、并发与重试：`src/lib/download/manager.ts`
- 播放源搜索与详情聚合：`src/lib/playback-source-prefetch.ts`
- 版本比较与少量 release 元数据归一化仍在 TypeScript；桌面模式下的远程版本检查与 release history 抓取已切到 Tauri / Rust：`src/lib/version_check.ts`、`src/lib/desktop-release-history.ts`
- 桌面前端仍然大量依赖 `fetch` 与 `src/app/api/*`
- 媒体代理在桌面版虽然已能通过本地服务承接，但协议和适配仍有 TS/Next 历史包袱

### 当前的根问题

桌面版已经不是“没有 Rust 后端”，而是“Rust 后端和 TS 后台逻辑并存，边界还没有收口”。

所以目标不是从零开始补 Rust，而是逐步把桌面业务的主执行路径收敛到 Rust。

## 改造目标形态

### 目标分层

```text
Desktop UI
  - React / Next 静态前端
  - 页面、组件、表单、播放器 UI
  - 极薄的 desktop SDK

Desktop Control Plane
  - Tauri commands
  - 本地服务生命周期
  - 窗口、文件对话框、系统集成、更新安装

Desktop Data Plane
  - Rust local service over loopback HTTP
  - 搜索、详情、代理、下载、缓存、配置、鉴权、同步

Rust Shared Crates
  - core / storage / network / profile / download / sync
```

### 设计原则

#### 1. 媒体与下载主链路保持 HTTP 语义

以下能力仍应优先走本地 HTTP，而不是 IPC：

- HLS `m3u8`
- `segment`
- `key`
- `Range` / `Content-Range`
- 下载器拉取 manifest 和资源

原因很简单：播放器和下载器天然消费 URL，不应该被迫重写成 IPC 数据流。

#### 2. UI 与业务执行分离

桌面前端最终只做：

- 调命令
- 订阅状态
- 渲染界面

桌面前端最终不再做：

- 业务级联网
- 下载调度
- 长生命周期后台任务
- 本地存储真源

#### 3. 先收口边界，再迁移实现

每迁一个模块，都要先把前端入口统一成 SDK 或 adapter，再替换底层实现。不要一边迁一边让调用路径继续发散。

## 非目标

当前路线图不做这些事：

- 不把播放器内核迁到 Rust
- 不把 Web 版立刻改成同一套 Rust 后端
- 不要求一次性删除所有 `src/app/api/*`
- 不把所有能力都塞进 Tauri command
- 不在第一阶段重做整个桌面 UI

## 桌面版的目标边界

### 最终应由 Rust 主导的能力

- 搜索与详情聚合
- 直播源与 EPG 拉取
- VOD / Live 代理
- 图片代理
- 下载任务管理
- 下载缓存和资源索引
- 本地 profile 数据
- 本地配置
- 远程 profile sync 代理
- 版本检查与 release 元数据读取
- 诊断、日志、导入导出

### 保留在 TypeScript 的能力

- 页面与组件
- 菜单、弹窗、表单交互
- 前端状态展示
- 播放器 UI 编排
- 桌面本地服务 SDK

## 分阶段路线

## Phase 0：冻结桌面边界

目标：

- 明确桌面版只允许通过两类通道访问后台能力
- 停止新增新的业务级 `fetch` 散点

执行项：

- 统一桌面前端访问入口为：
  - `desktop SDK`
  - 本地服务 HTTP
  - 必要的 Tauri command
- 为桌面模式新增约束：
  - 新增后台能力优先落到 Rust
  - 不再在桌面路径上直接新增 `src/app/api/*` 依赖

验收标准：

- 新增桌面能力没有绕开 SDK 或本地服务
- 文档中明确每个能力的归属层

## Phase 1：先完成下载系统 Rust 化

这是收益最高、最应该先做的一阶段。

### 原因

- 桌面下载是最典型的后台任务
- 它涉及并发、重试、暂停、恢复、断点续传、缓存、资源生命周期
- 这些都更适合 Rust，而不适合长期留在前端状态机里

### 当前 TS 负责的关键能力

- 任务编排：`src/lib/download/manager.ts`
- UI 调用：`src/components/DownloadsClient.tsx`
- 当前集下载控件：`src/components/CurrentEpisodeDownloadControl.tsx`

### 目标改造

- Rust `download engine` 成为桌面下载的唯一执行器
- TS 改成：
  - 发起下载命令
  - 暂停/继续/取消命令
  - 订阅任务状态和进度
  - 渲染下载页

### 建议落地顺序

1. 在 Rust 中定义下载任务模型、命令、事件和持久化边界
2. 先做“命令 + 状态查询”骨架，不切主流程
3. 支持 Rust 下载器与 TS 下载器并行存在一段时间
4. 桌面版切到 Rust 下载器
5. 删除桌面路径中的 TS 下载执行逻辑

### 验收标准

- 桌面下载不再由 `src/lib/download/manager.ts` 执行网络抓取
- 暂停/继续/取消/重试行为与当前版本对齐
- 断点续传稳定
- 下载状态在应用重启后可恢复

## Phase 2：迁移内容发现与媒体网络层

这一阶段把“桌面业务级联网”大头从 TS 拉走。

### 涉及模块

- 播放源搜索：`src/lib/playback-source-prefetch.ts`
- 详情聚合
- 站点下游抓取
- 直播与 EPG
- 图片代理
- VOD / Live 代理

### 目标改造

- 桌面版的搜索、详情、代理逻辑全部由本地 Rust 服务提供
- TS 前端不再自己拼业务请求、容错、重试和资源聚合

### 建议拆分

#### Phase 2A：搜索与详情

- 先把搜索、建议词、详情聚合下沉
- 前端改为统一走本地服务接口

#### Phase 2B：媒体代理

- 再把 VOD、Live、image proxy 完全收口到本地服务
- 清理桌面构建里对 Next route 的历史兼容逻辑

### 验收标准

- 桌面前端不再直接依赖 `playback-source-prefetch` 做业务级联网
- 桌面模式下，主要播放链路完全可脱离 `src/app/api/*`

## Phase 3：本地 profile、配置与同步链路收口

> 执行关系：
>
> - 这一阶段的 profile sync 细化执行方案见 `dev-plan/desktop-foundation/desktop-profile-sync-execution-plan.md`
> - 两份计划并行推进，不需要等待整份 Rust 化路线图全部完成后再启动
> - 建议先落地 profile sync 计划中的 Phase 0-3，再把 `moontv-profile` / `moontv-sync` 的 crate 收口纳入本阶段后半段

### 涉及能力

- 收藏
- 播放记录
- 搜索历史
- 跳过片头片尾
- 本地账户
- 配置文件
- 远程 profile sync 代理

### 当前问题

- 桌面上这些能力已经有一部分在 Rust，一部分还沿用 TS/Web 设计
- 真源不够统一

### 目标改造

- 桌面本地 profile 数据以 Rust 存储层为真源
- TypeScript 通过统一的 profile SDK 访问
- 远程同步是可选 adapter，而不是本地业务的中心

### 验收标准

- 桌面 profile 数据读写不依赖 Web 端存储实现
- 同步开启或关闭不影响本地基本能力

## Phase 4：桌面版后台能力完整收口

目标：

- 桌面模式不再依赖 Next route 作为后台能力入口
- 桌面专用后台能力主要通过：
  - 本地服务 HTTP
  - Tauri command

### 涉及收口项

- 版本检查与 release 列表
- 桌面诊断
- 本地导入导出
- 配置订阅与远程配置拉取
- 管理后台中真正需要留在桌面的部分

当前进展（2026-06-25）：

- 这一阶段已经落下第一刀：桌面模式下的远程 `VERSION.txt` 检查与 GitHub desktop release history 获取，不再优先依赖前端 `fetch`，而是通过 Tauri 命令转到 Rust 执行。
- Web 路径、浏览器预览态与桌面代理地址仍保留兼容 fallback，因此这一步是“收口主路径”而不是“一次性删除全部 TS/Next 兼容层”。

### 验收标准

- 桌面前端主要通过本地 SDK 与本地服务工作
- 桌面构建对 `src/app/api/*` 的依赖降到可控范围

## Phase 5：为 Web/移动端保留复用边界

这一阶段不一定马上做，但现在就要避免把路堵死。

目标：

- Rust 侧沉淀出的领域模型、存储模型、下载模型具备持续复用价值
- TS 前端层的契约尽量与平台解耦

注意：

- Web 版短期内仍可继续使用 TS 后端
- 但桌面端已经不应再以 Web route 为主干

## 代码映射建议

### 优先保留在 Tauri 壳的内容

- `src-tauri/src/lib.rs`
  - 服务启停
  - 系统能力
  - 更新安装
  - 文件系统对话框
  - 诊断和桌面壳能力

### 优先下沉到本地服务 / Rust crates 的内容

- `src/lib/download/manager.ts`
- `src/lib/playback-source-prefetch.ts`
- `src/lib/version_check.ts`
- `src/lib/downstream.ts`
- `src/lib/live.ts`
- `src/lib/download/vod-proxy.ts`
- 桌面模式下真正仍在消费 `src/app/api/*` 的链路

### TS 侧最终应保留的接口形态

- `src/lib/desktop/*`
- `src/lib/download/desktop-runtime.ts`
- 面向页面和组件的轻量 SDK

## 建议的 crate 演进方向

如果继续按 workspace 演进，建议目标边界如下：

- `moontv-core`
  - 领域模型、DTO、错误模型、任务状态
- `moontv-storage`
  - SQLite、文件缓存、路径规则、快照与索引
- `moontv-network`
  - 搜索、详情、代理、上游拉取、manifest 重写
- `moontv-profile`
  - 收藏、播放记录、搜索历史、跳过配置、本地账号
- `moontv-download`
  - 下载任务、调度、续传、重试、资源生命周期
- `moontv-sync`
  - 可选的远程同步代理
- `moontv-local-service`
  - HTTP facade、handler、协议适配

## 风险与注意事项

### 1. 下载器迁移是高风险改造

它最有收益，但也最容易出回归。必须允许新旧执行器并存一段时间，不能一步替换。

### 2. 媒体代理不能为“Rust 化”牺牲协议兼容

只要播放器还在浏览器里，就必须优先保证：

- URL 可直接消费
- `Range` 语义正确
- CORS 正确
- `m3u8` 重写稳定

### 3. 桌面 SDK 必须先统一

如果不先统一入口，Rust 迁一块、TS 留一块，前端最后只会越来越乱。

### 4. 不要让 `src-tauri` 再次长成业务黑洞

Tauri 壳应该越来越薄，而不是把所有桌面逻辑重新堆回 `src-tauri/src/lib.rs`。

## 推荐实施顺序

按执行优先级排序：

1. 冻结桌面边界，新增能力优先走 Rust
2. 下载系统 Rust 化
3. 搜索与详情聚合 Rust 化
4. 媒体代理与图片代理 Rust 化
5. profile / config / sync Rust 化
6. 版本检查、诊断、导入导出等桌面后台能力收口
7. 清理桌面路径对 `src/app/api/*` 的依赖

## 里程碑定义

### M1：Rust 下载器接管桌面下载

完成标志：

- 桌面下载主执行路径从 TS 迁到 Rust
- TS 仅保留 UI 与命令发起

### M2：桌面播放链路不再依赖 TS 业务级联网

完成标志：

- 搜索、详情、代理由本地服务提供
- 桌面前端不再自己聚合远程资源

### M3：桌面 profile 与配置以 Rust 为真源

完成标志：

- 收藏、播放记录、搜索历史、配置等桌面本地数据读写全部收口

### M4：桌面版形成“Rust 后端 + TS 纯前端”主架构

完成标志：

- 桌面主要后台能力由 Rust 承担
- TS 主要承担 UI 和播放器交互

## 验收命令

每个阶段结束后至少要通过：

```bash
cargo check --workspace
cargo test --workspace
pnpm typecheck
pnpm desktop:check
pnpm exec jest --runInBand
```

如果阶段涉及播放器、下载器、代理链路，还应补手工验收：

1. VOD 播放正常
2. Live 播放正常
3. 下载可暂停、继续、取消、恢复
4. 应用重启后状态可恢复
5. 代理的 `Range` 行为不回退

## 最终判断

桌面版全面采用 Rust 承担网络和后台服务，是合理且值得做的方向。

但最重要的不是“写更多 Rust”，而是：

- 给桌面版建立清晰的后端边界
- 让 TS 退出后台执行层
- 让 Rust 成为桌面模式的主业务底座

如果后续正式启动实施，建议第一批工作直接围绕下载器和内容发现链路展开，因为这两块最能快速拉开“桌面版”和“Web 版”的架构差异，也最能体现 Rust 化的实际收益。
