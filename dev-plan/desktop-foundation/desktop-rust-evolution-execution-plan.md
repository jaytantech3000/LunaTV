# LunaTV Desktop Rust 演进执行方案

配套文档：

- `dev-plan/desktop-foundation/desktop-first-platform-blueprint.md`
- `dev-plan/desktop-foundation/desktop-local-service-protocol-v1.md`
- `dev-plan/desktop-foundation/phase-1-repo-refactor-checklist.md`

## 目标

这份文档用于把桌面版后续的 Rust 演进方向细化到可执行级别。

核心思想不是“把 TS 全部翻译成 Rust”，而是把桌面版逐步演进成：

> Rust 应用内核 + TS UI 壳

目标收益：

- 用 Rust 增强桌面版性能
- 用 Rust 提高下载、存储、网络代理等后台能力的自由度
- 为后续提取独立 Rust 库打基础
- 让桌面版逐步摆脱对 Web route handler 和 TS 服务实现的依赖

## 红线约束

### 第一阶段不能改的东西

- 不能改 sidecar 二进制名 `moontv-local-service`
- 不能改 Tauri 当前寻找和拉起 sidecar 的方式
- 不能改现有桌面主链路 HTTP 协议
- 不能把媒体链路改成 IPC
- 不能为了拆 crate 破坏 `pnpm desktop:check` 和 `pnpm desktop:test`

### 当前被写死的绑定点

- `src-tauri/tauri.conf.json`
- `src-tauri/src/lib.rs`
- `scripts/sync-desktop-sidecar.mjs`
- `.github/workflows/desktop-build.yml`
- `package.json` 中的 `desktop:*` 脚本

这意味着：

- 第一阶段只能在保持 `moontv-local-service` crate 和 sidecar 产物名不变的前提下演进
- 真正的“bin crate / facade crate”进一步重命名，必须放到后续 packaging 链路稳定之后

## 目标形态

建议将 Rust 侧逐步演进到下面的 workspace 结构：

```text
Cargo.toml
src-tauri/
crates/
  moontv-local-service/
  moontv-core/
  moontv-storage/
  moontv-network/
  moontv-profile/
  moontv-download/
  moontv-sync/
```

说明：

- `moontv-local-service` 第一阶段继续保留原名，承担 sidecar HTTP facade + bin 入口
- 其他 crate 逐步承接领域能力
- `src-tauri` 继续只承担桌面壳职责

## Crate 边界

### `moontv-core`

职责：

- 领域模型
- 共享 DTO
- 错误模型
- 任务状态与 ID 规则
- 配置领域模型

原则：

- 不依赖 `axum`
- 不依赖 `tauri`
- 不依赖 HTTP response 类型
- 不依赖文件系统

### `moontv-storage`

职责：

- SQLite 连接与迁移
- 文件缓存
- 下载资源索引
- 下载状态 snapshot
- admin persistence
- 路径规则与文件布局

原则：

- 成为桌面本地状态真源
- 尽量将“文件路径 + 序列化 + 读写”从 service 层剥离

### `moontv-network`

职责：

- 搜索与详情下游抓取
- 直播抓取
- media proxy 上游访问
- m3u8/segment/key 重写
- Douban/Bangumi 拉取
- manifest 解析

原则：

- 输入输出使用领域模型
- 不直接依赖 Axum handler

### `moontv-profile`

职责：

- favorites
- playrecords
- searchhistory
- skipconfigs
- 本地账号相关数据模型

原则：

- 桌面优先走本地存储
- 远端同步作为可选 adapter，而不是主路径

### `moontv-download`

职责：

- 下载任务状态机
- 并发调度
- 重试/取消/暂停/恢复
- 断点续传
- 资源生命周期管理
- 进度与速度统计

原则：

- 这是桌面版后续最大的 Rust 化收益点
- TS 端最终只保留 UI 展示和命令触发

### `moontv-sync`

职责：

- profile sync 远端代理
- 远端账号会话
- 本地 profile 与远端服务之间的同步 adapter

原则：

- 后期引入
- 不能阻塞桌面本地优先能力

### `moontv-local-service`

职责：

- CLI 入口
- sidecar 启动
- router 装配
- HTTP handler
- 请求参数校验
- response 映射
- SSE / Range / CORS 这种协议层逻辑

原则：

- 不再成为业务黑洞
- 只做 facade，不做核心能力沉积

## 依赖方向

只允许下面这个方向：

```text
moontv-core
moontv-storage -> moontv-core
moontv-network -> moontv-core
moontv-profile -> moontv-core + moontv-storage
moontv-download -> moontv-core + moontv-storage + moontv-network
moontv-sync -> moontv-core + moontv-network + moontv-profile
moontv-local-service -> 所有业务 crate + axum/tower
src-tauri -> tauri + sidecar lifecycle
```

禁止：

- `moontv-core` 反向依赖任何 facade crate
- `src-tauri` 直接依赖网络/下载/存储业务实现
- `moontv-network` 依赖 `axum`
- `moontv-storage` 依赖 `tauri`

## 第一阶段总体原则

第一阶段不是“彻底 Rust 化”，而是把当前单体 sidecar 改造成可继续演化的形态。

重点不是新增功能，而是先完成：

1. sidecar 单体模块化
2. 存储能力独立化
3. 共享类型抽离
4. 为 SQLite 与下载引擎打基础

## 分阶段执行

### Commit 1：Scaffold Workspace Crates

提交建议：

- `chore(rust): scaffold desktop core crates`

动作：

- 新建 `moontv-core`
- 新建 `moontv-storage`
- 新建 `moontv-network`
- 新建 `moontv-profile`
- 新建 `moontv-download`
- 新建 `moontv-sync`
- 更新 workspace `members`

本提交不做：

- 不迁逻辑
- 不改 sidecar 构建链
- 不改二进制名

验收：

- `cargo check --workspace`

### Commit 2：Split Local Service Internally First

提交建议：

- `refactor(local-service): split monolith into internal modules`

动作：

- 先在 `crates/moontv-local-service/src/` 内部拆模块，不立即跨 crate 迁移

建议文件树：

```text
crates/moontv-local-service/src/
  main.rs
  lib.rs
  app/
    mod.rs
    state.rs
  http/
    mod.rs
    router.rs
    error.rs
    response.rs
    handlers/
      mod.rs
      content.rs
      live.rs
      media_proxy.rs
      download_runtime.rs
      admin.rs
      profile_sync.rs
      metadata.rs
  domain/
    mod.rs
    config.rs
    models.rs
```

目标：

- 先消灭单文件耦合
- 不改变行为

验收：

- `cargo test -p moontv-local-service`

### Commit 3：Extract Core Models

提交建议：

- `refactor(core): extract shared desktop domain models`

迁出到 `moontv-core` 的首批对象：

- `SearchResult`
- `ServiceConfig`
- `ApiSite`
- `LiveSourceConfig`
- `DesktopDownloadCacheEntry`
- `DesktopDownloadResourceIndexRecord`

先不迁：

- `AppError`
- Axum response DTO
- handler 参数结构

目标：

- 让网络层、存储层、下载层共享同一套模型

验收：

- `cargo check --workspace`

### Commit 4：Extract File-backed Storage

提交建议：

- `refactor(storage): extract file-backed desktop stores`

迁出到 `moontv-storage` 的首批能力：

- admin persistence 读取/保存
- 下载缓存 body/meta 读写
- 下载资源索引读写
- 下载 store snapshot 读写
- 路径计算
- 文件工具
- hash/path 规则

建议在 `moontv-storage` 中形成下面的对象：

```text
moontv-storage/src/
  lib.rs
  paths.rs
  fs_utils.rs
  admin_persistence.rs
  download_runtime_store.rs
```

建议提供的对象：

- `StoragePaths`
- `AdminPersistenceStore`
- `DownloadRuntimeStore`

目标：

- `AppState` 不再自己做大量文件读写

验收：

- `cargo test -p moontv-local-service`
- `/api/download-runtime/*` 相关测试保持通过

### Commit 5：Add SQLite Foundation

提交建议：

- `feat(storage): add sqlite foundation for desktop local data`

技术选型：

- 使用 `rusqlite`

理由：

- 桌面本地优先
- 单机文件库
- 模型简单
- 更适合本项目现阶段

建议文件树：

```text
moontv-storage/src/
  sqlite/
    mod.rs
    db.rs
    migrations.rs
    migrations/
      0001_init.sql
  profile_repo.rs
```

本提交先做：

- 连接工厂
- migration runner
- 基础 repo trait

本提交先不做：

- 不立即切 favorites/playrecords 到 SQLite

验收：

- `cargo check --workspace`
- 新增 SQLite 初始化测试

### Commit 6：Extract Network Engine

提交建议：

- `refactor(network): extract desktop content and proxy engine`

迁出到 `moontv-network` 的能力：

- 搜索全站聚合
- 单站搜索
- 详情抓取
- 自定义 detail 页面解析
- live source 读取与上游访问
- vod/live proxy 上游请求
- manifest 重写
- Douban/Bangumi 抓取

建议文件树：

```text
moontv-network/src/
  lib.rs
  client.rs
  content/
    mod.rs
    search.rs
    detail.rs
    parse.rs
  live/
    mod.rs
    channels.rs
    epg.rs
    proxy.rs
  vod/
    mod.rs
    proxy.rs
    manifest.rs
  metadata/
    mod.rs
    douban.rs
    bangumi.rs
```

目标：

- `moontv-local-service` 只保留 handler 和协议适配

验收：

- `/api/search`
- `/api/detail`
- `/api/proxy/vod/m3u8`
- `/api/proxy/m3u8`

这些路径行为不能回退

### Commit 7：Local-first Profile Domain

提交建议：

- `feat(profile): add local-first desktop profile domain`

在 `moontv-profile` 中建立：

- favorites repo
- playrecords repo
- searchhistory repo
- skipconfigs repo

优先目标：

- 桌面本地 profile 数据不再依赖 Web 侧 `db.ts`
- sidecar 不再默认把这些路径视为 passthrough

可暂时保留：

- `moontv-sync` adapter 作为 fallback 或后续能力

验收：

- `/api/favorites`
- `/api/playrecords`
- `/api/searchhistory`
- `/api/skipconfigs`

在 desktop 模式下走本地数据面

### Commit 8：Introduce Rust Download Engine Skeleton

提交建议：

- `feat(download): scaffold rust download engine`

建议文件树：

```text
moontv-download/src/
  lib.rs
  engine.rs
  task.rs
  scheduler.rs
  progress.rs
  command.rs
  event.rs
  repository.rs
```

先建立：

- 任务模型
- 命令模型
- 事件模型
- scheduler skeleton
- 与 `moontv-storage` 的 repository 边界

先不做：

- 不立即替换 TS 下载逻辑

验收：

- 编译通过
- 基础单元测试通过

### Commit 9：Move Download Execution from TS to Rust

提交建议：

- `feat(download): move desktop download execution into rust`

目标：

- 让桌面端的 manifest 拉取、资源下载、重试、暂停/恢复、进度计算移到 Rust

前端变化方向：

- TS 只发下载命令
- TS 只消费任务状态
- TS 不再承担主下载状态机

本提交是高风险阶段，建议拆成多个 PR：

- PR 1：命令接口 + 状态查询
- PR 2：新老下载器并行
- PR 3：切换桌面默认下载引擎
- PR 4：删除桌面端 TS 下载执行路径

验收：

- 下载成功率不低于当前实现
- 暂停/恢复/取消可用
- 后台下载稳定性优于当前实现

### Commit 10：Introduce Sync Adapter

提交建议：

- `feat(sync): add optional remote profile sync adapter`

目标：

- 将远端同步降级为可插拔能力
- 不再让桌面本地能力围绕远端 sync 设计

## 当前代码迁移映射

### 优先迁到 `moontv-storage`

- `load_admin_persistence`
- `save_admin_persistence`
- `build_default_admin_persistence_from_raw`
- `read_raw_service_config`
- `write_cached_download`
- `read_cached_download_entry`
- `read_cached_download_body`
- `delete_cached_download`
- `clear_cached_downloads`
- `write_resource_index`
- `read_resource_index`
- `delete_resource_index`
- `clear_resource_indexes`
- `write_download_store_snapshot`
- `read_download_store_snapshot`
- `clear_download_store_snapshot`

### 优先迁到 `moontv-network`

- `search_all_sites`
- `search_site`
- `fetch_content_detail`
- `parse_search_payload`
- `parse_detail_payload`
- `fetch_live_proxy_upstream`
- `fetch_vod_proxy_upstream`
- `rewrite_live_manifest_content`
- `rewrite_vod_manifest_content`
- `fetch_douban_*`
- `fetch_bangumi_*`

### 保留在 `moontv-local-service`

- `Cli`
- `run`
- `build_router`
- request query/body 参数结构
- `build_cached_download_response`
- `parse_download_runtime_status`
- CORS / Range / HTTP response 构造

## 验收门禁

每个里程碑之后至少要过下面这些命令：

```bash
cargo check --workspace
cargo test --workspace
pnpm desktop:prepare:sidecar
pnpm desktop:check
pnpm desktop:test
```

在 Commit 4、6、9 之后必须追加手工验收：

1. 桌面壳可以正常拉起 sidecar
2. `/api/search` 正常返回搜索结果
3. `/api/detail` 正常返回详情
4. `/api/proxy/vod/m3u8` 仍可播放
5. `/api/download-runtime/*` 读写与 Range 响应不回退

## Definition Of Done

Rust 演进到达第一轮目标时，应满足：

- `src-tauri` 只承担桌面壳职责
- `moontv-local-service` 不再是单体业务黑洞
- `moontv-storage` 成为桌面本地状态真源
- `moontv-network` 成为桌面数据面核心引擎
- `moontv-download` 逐步取代桌面 TS 下载状态机
- Web 与 Desktop 的共享能力以 Rust crate 复用，而不是继续复制 TS 逻辑

## 最终判断

桌面版后续应坚定走下面这条线：

> 以 Rust 增强性能，以 Rust 提高后台能力自由度，以 crate 化为未来独立 Rust 库体系做准备。

不建议的方向：

- 全量重写前端 UI 为 Rust
- 把媒体链路强行搬到 IPC
- 在 sidecar monolith 继续堆逻辑，延后抽象
- 在下载引擎 Rust 化之前就大规模删除 TS 能力

建议执行顺序总结：

1. 先模块化 sidecar
2. 再抽 `core`
3. 再抽 `storage`
4. 再抽 `network`
5. 再做 `profile`
6. 最后切 `download`

这个顺序最稳，也最接近当前仓库可承受的演进路径。
