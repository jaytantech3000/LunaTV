# LunaTV Desktop Profile Sync 详细执行计划

配套文档：

- `dev-plan/desktop-foundation/desktop-first-platform-blueprint.md`
- `dev-plan/desktop-foundation/phase-1-repo-refactor-checklist.md`
- `dev-plan/desktop-foundation/desktop-local-service-protocol-v1.md`
- `dev-plan/desktop-foundation/desktop-rustification-roadmap.md`
- `dev-plan/desktop-foundation/desktop-rust-evolution-execution-plan.md`

> 状态说明（2026-06-25）
>
> - “多端帐号同步（桌面 / 手机 / Web）”已经被降级为桌面主线之外的后续能力。
> - 仓库里已经存在一条可工作的桌面 profile sync 代理链路，但它仍是“可选 adapter + 兼容实现”，不是已经收口完成的桌面核心架构。
> - 本文目标不是把桌面重新定义成“远端账号驱动”的产品，而是在保持桌面本地优先前提下，把当前同步链路整理成可维护、可测试、可灰度的能力。
> - 本文与 `dev-plan/desktop-foundation/desktop-rustification-roadmap.md` 的 Phase 3 并行推进，不等待整份 roadmap 完成后再实施。
>
> 最新进展（2026-06-25）：
>
> - `GET /api/profile/bootstrap` 已经落地，桌面运行时与登录页可以消费统一启动快照。
> - `src/lib/profile/*` 已从旧的 `db.client.ts` 兼容层中抽出，`runtime.ts` 统一解析 `desktop-local` / `desktop-profile-sync`。
> - `moontv-sync` 与 `moontv-profile` 已落地，sync on 走远端 adapter，sync off 走 Rust 本地 profile store。
> - 五个 profile 域（`playrecords` / `favorites` / `follows` / `searchhistory` / `skipconfigs`）在桌面本地模式下已经切到 Rust 真源。
> - 为避免升级后丢失旧数据，桌面本地模式已补上一条 `localStorage -> Rust profile store` 的一次性兼容迁移链路。
> - `profile-sync/status` 已补充稳定错误分类和同步域元数据，桌面管理页与诊断报告可以直接消费。
> - 当前剩余工作主要集中在 Phase 6 的旧分支进一步收缩，以及更大范围的桌面 Rust 化主线继续推进。

## 1. 目标

本计划只解决下面这一件事：

- 当桌面配置了 `profile_sync.api_base_url` 时，桌面版可以复用 Web 端账号与用户数据。

同时必须满足下面几个约束：

- 桌面仍然是本地优先架构。
- 远端同步是可选能力，不是桌面运行的中心。
- 内容搜索、播放、代理、下载、缓存不依赖远端 Web 后端。
- 关闭同步后，桌面基础能力不受影响。
- 后续如果继续推进 Rust 化，这条链路不能成为阻塞项。

## 2. 范围

### 2.1 计划内

- 账号登录、登出、修改密码
- 远端账号会话代持
- 桌面运行时的 profile mode / storage type 判定
- 用户数据同步域：
  - `playrecords`
  - `favorites`
  - `follows`
  - `searchhistory`
  - `skipconfigs`
- profile sync 状态展示、配置入口、错误反馈
- profile sync 模式下的导入导出代理行为
- 相关协议文档、测试、分阶段落地方案

### 2.2 计划外

- 下载任务、下载缓存、媒体缓存同步
- 视频源、分类、直播源、站点配置同步
- 桌面管理后台的全量远端托管
- 手机端、TV 端同步实施
- 离线写队列、多副本冲突合并、复杂双向同步算法

## 3. 当前现状

### 3.1 已经存在的实现

当前仓库已经具备一条基础可用的 profile sync 链路：

- 桌面配置文件支持 `profile_sync.api_base_url`
- `moontv-local-service` 已代理以下接口：
  - `GET /api/profile-sync/status`
  - `GET /api/server-config`
  - `/api/login`
  - `/api/logout`
  - `/api/change-password`
  - `/api/playrecords`
  - `/api/favorites`
  - `/api/follows`
  - `/api/searchhistory`
  - `/api/skipconfigs`
- 远端登录成功后，本地服务会保存远端会话
- 桌面登录页会识别 profile sync 状态并进入远端登录模式
- `db.client.ts` 会在桌面 profile sync 启用时切换到远端用户数据接口
- 桌面管理页和桌面设置页已经暴露 profile sync 的状态说明和配置指导
- 管理数据导入导出在 profile sync 模式下已经支持透传远端

当前设计的真实含义是：

- 媒体数据面继续走本地服务
- profile sync 只影响账号与一小部分用户数据
- 同步模式下，远端 Web 后端是“同步域数据”的真源
- 桌面本地缓存只是 UI/性能优化，不是同步域真源

### 3.2 当前实现的关键问题

### A. 真源不统一

当前 profile mode / storage type 的判断来源分散在三处：

- Web 端运行时：`src/lib/runtime/storage-mode.ts`
- 桌面运行时：`src/components/DesktopRuntimeSync.tsx` + `src/lib/desktop/profile-sync.ts`
- 本地服务：`crates/moontv-local-service/src/lib.rs`

结果是：

- env 级 `STORAGE_TYPE`
- 桌面运行时 `PROFILE_SYNC_ENABLED`
- 远端 `/api/server-config`

三者共同影响 UI 行为，但没有一个统一的“最终解析结果”对象。

### B. 启动和登录链路是两段式拼接

桌面启动时当前流程是：

1. 拉取 `/api/runtime/public-config`
2. 如果 `profileSyncEnabled=true`，再拉取 `/api/profile-sync/status`
3. 再决定是否写入 `desktop-profile-sync` 会话

这会带来几个问题：

- 首屏依赖两次请求才能得出完整状态
- 登录页在 profile sync 状态返回前，仍会先用本地 `STORAGE_TYPE` 预判是否需要用户名
- 运行时配置与认证状态不是同一个快照

### C. TS 端用户数据层职责过重

`src/lib/db.client.ts` 当前同时承担了：

- 本地缓存
- 远端接口选择
- 401 处理
- 用户态缓存失效
- 乐观更新
- 错误提示
- 多个 profile 域的存取逻辑

这会导致：

- 难以逐步替换为统一 profile SDK
- 桌面 / Web / 本地模式 / 同步模式逻辑混在一起
- 测试颗粒度过粗

### D. Rust 侧同步能力仍寄生在 facade 中

按照现路线，`moontv-local-service` 应该更偏向协议层 facade。

但当前 profile sync 相关逻辑仍直接堆在其中：

- 远端目标地址拼接
- cookie store 会话管理
- 401 清理
- `server-config` 探测
- 透传转发

这意味着：

- 本地服务仍在沉积业务逻辑
- 后续拆 `moontv-sync` 的迁移成本会上升

### E. 协议文档与代码不完全一致

当前协议文档仍停留在：

- `playrecords`
- `favorites`
- `searchhistory`
- `skipconfigs`

但代码实际上已经把 `follows` 也纳入同步代理。

如果不先收敛文档，后续开发和测试都会出现理解偏差。

### F. 测试覆盖仍偏薄

当前已有的测试更多覆盖：

- 桌面本地会话自动恢复
- profile context 单用户 / 多用户分支

但对 profile sync 本身还缺少系统性覆盖：

- profile sync 启动快照
- 远端登录成功 / 失败 / 401
- 远端不可达
- 401 后本地会话清理
- `follows` 路由一致性
- 配置切换前后缓存与会话处理

## 4. 设计原则

后续所有实现都必须服从下面原则：

### 4.1 桌面本地优先

- 不配置 `profile_sync.api_base_url` 时，桌面应完整运行。
- 配置 sync 只是打开一条 adapter，不应重写桌面基础架构。

### 4.2 远端同步是显式可选能力

- 同步域要明确
- 非同步域不能被暗中带入远端依赖
- 关闭 sync 必须是明确可回退路径

### 4.3 同步域真源必须明确

推荐明确采用：

- sync 关闭：本地 profile 存储为真源
- sync 开启：远端 Web 后端为同步域真源
- 桌面本地缓存仅作性能优化，不承担长期真源职责

### 4.4 前端不直接理解太多模式分支

UI 层应尽量消费一个统一的“已解析运行时状态”，而不是自己拼：

- `APP_TARGET`
- `STORAGE_TYPE`
- `PROFILE_SYNC_ENABLED`
- `PROFILE_SYNC_STORAGE_TYPE`
- `PROFILE_SYNC_PROFILE_MODE`
- `sessionMode`

### 4.5 Rust facade 与业务 crate 分层清晰

推荐方向保持不变：

- `moontv-local-service` 只做 HTTP facade
- `moontv-profile` 负责本地 profile 域
- `moontv-sync` 负责远端 adapter

## 5. 目标终态

目标终态不是“桌面等于 Web 壳”，而是下面这个结构：

```text
Desktop UI
  -> TS profile SDK
  -> Local Service HTTP

Local Service
  -> Local profile service (sync off)
  -> Remote sync adapter (sync on)
  -> Media / search / proxy / download local data plane

Remote Web Backend
  -> Remote auth + remote user-data truth source
```

同步域的行为模型明确为：

- sync off：
  - 桌面本地 profile 为真源
  - 不访问远端账号同步服务
- sync on：
  - 桌面仍通过本地服务工作
  - 本地服务代理远端账号和用户数据接口
  - 远端是同步域真源
  - 本地只保留临时缓存和展示态

## 6. 推荐分阶段实施

### Phase 0：契约与范围收敛

#### 目标

先把“到底同步什么、谁是主语、哪些接口归 sync 管”写清楚。

#### 工作项

- 更新 `desktop-local-service-protocol-v1.md`
- 把 `follows` 纳入正式协议
- 明确同步域与非同步域边界
- 明确 `desktop-local` / `desktop-profile-sync` 两种会话语义
- 明确 sync on/off 时 `StorageType` / `ProfileMode` 的来源
- 明确 profile sync 模式下导入导出为何走远端代理

#### 建议产出

- 协议文档修订
- 共享 TS 类型草案
- 会话语义说明

#### 验收标准

- 文档与当前实现一致
- 新开发者只看协议文档就能回答“哪些数据会同步”

#### 影响文件

- `dev-plan/desktop-foundation/desktop-local-service-protocol-v1.md`
- `dev-plan/desktop-foundation/desktop-profile-sync-execution-plan.md`

### Phase 1：统一桌面启动快照与运行时真源

#### 目标

把桌面端当前“public-config + profile-sync-status + auth restore”的拼装过程，收敛成一个稳定的启动快照。

#### 建议做法

新增一个本地服务启动快照接口，例如：

- `GET /api/profile/bootstrap`

返回内容至少包含：

- `appTarget`
- `profileSync.enabled`
- `profileSync.reachable`
- `profileSync.authenticated`
- `profileSync.storageType`
- `profileSync.profileMode`
- `profileSync.username`
- `profileSync.role`
- `localAuth.passwordRequired`
- `localAuth.ownerPasswordConfigured`
- `localAuth.multiUser`

#### 工作项

- 定义桌面 profile bootstrap 类型
- 用单次请求替代前端两段式初始化
- `DesktopRuntimeSync` 改为消费 bootstrap
- 登录页改为消费 bootstrap
- 明确首次渲染前的 loading / redirect 策略
- 明确显式登出标记仅作用于 `desktop-local` 自动恢复逻辑

#### 验收标准

- 桌面启动时不再需要前端自己拼模式
- 登录页不再先用 env `STORAGE_TYPE` 猜测 profile mode
- profile sync 状态与认证态来自同一份快照

#### 影响文件

- `crates/moontv-local-service/src/lib.rs`
- `src/components/DesktopRuntimeSync.tsx`
- `src/app/login/page.tsx`
- `src/lib/desktop/profile-sync.ts`
- `src/lib/desktop/auth-session.ts`
- `src/lib/runtime-config.ts`

### Phase 2：抽出统一的 TS profile SDK

#### 目标

把 `db.client.ts` 从“大一统实现”拆成清晰的 profile 客户端层。

#### 推荐结构

```text
src/lib/profile/
  contracts.ts
  runtime.ts
  session.ts
  cache.ts
  client.ts
  local-adapter.ts
  remote-adapter.ts
```

#### 职责拆分

- `contracts.ts`
  - 共享 profile 域类型
  - 路由路径常量
  - bootstrap / status 类型
- `runtime.ts`
  - 解析当前桌面是否启用 sync
  - 给出统一 `ResolvedProfileRuntime`
- `session.ts`
  - 会话读写
  - 401 清理
  - logout 行为
- `cache.ts`
  - 本地缓存与缓存失效
- `client.ts`
  - 对外暴露 profile API
- `remote-adapter.ts`
  - 远端接口请求与错误处理

#### 工作项

- 先新增 profile SDK，不立即删除 `db.client.ts`
- 让 `db.client.ts` 退化为兼容包装层
- 把 `follow-updates.ts` 中 profile mode 判断迁到统一 runtime resolver
- 统一 `follows` / `favorites` / `playrecords` / `searchhistory` / `skipconfigs` 五个域的调用方式

#### 验收标准

- UI 组件不再直接关心 `PROFILE_SYNC_*` 细节
- 用户数据域的模式切换由统一 SDK 决定
- `db.client.ts` 明显变薄

#### 影响文件

- `src/lib/db.client.ts`
- `src/lib/follow-updates.ts`
- `src/app/follow-updates/page.tsx`
- `src/app/play/page.tsx`
- `src/components/UserMenu.tsx`
- 新增 `src/lib/profile/*`

### Phase 3：把同步代理逻辑从 local service facade 中抽薄

#### 目标

先不强制立刻新建 crate，但要先把 profile sync 逻辑从 router 主文件中拆成独立模块或内部服务层。

#### 工作项

- 抽出 sync 目标 URL 解析
- 抽出远端 cookie store / session 管理
- 抽出统一的透传请求构建逻辑
- 抽出 401 -> 清 session 的共用处理
- 抽出 `server-config` 探测逻辑
- 为 profile sync 错误定义统一分类：
  - 未配置
  - 地址非法
  - 远端不可达
  - 远端返回 401
  - 远端协议不兼容

#### 额外建议

如果暂时不新建 `moontv-sync` crate，也至少先做：

- `crates/moontv-local-service/src/profile_sync/*`

这样后续迁出 crate 时不会再次大规模切 facade。

#### 验收标准

- `src/lib.rs` 中的 sync 逻辑明显减少
- sync 逻辑能被单元测试独立覆盖
- `server-config` / `status` / `passthrough` 行为一致

#### 影响文件

- `crates/moontv-local-service/src/lib.rs`
- 新增 `crates/moontv-local-service/src/profile_sync/*`

### Phase 4：引入 `moontv-profile`，收口本地 profile 真源

#### 目标

当 sync 关闭时，桌面本地 profile 数据不再依赖现有 TS/Web 风格实现，而是收敛到 Rust 本地 profile 域。

#### 计划内数据域

- favorites
- playrecords
- follows
- searchhistory
- skipconfigs
- 本地账号模型

#### 工作项

- 新建 `crates/moontv-profile`
- 定义 profile 域模型与 repository 接口
- 复用 `moontv-storage` 提供本地 SQLite / 文件持久化能力
- 本地服务在 sync off 时改走 `moontv-profile`
- 保留必要的数据迁移与旧数据兼容读取

#### 数据原则

- 本地模式下，Rust profile 层是真源
- TS 只读写统一 profile SDK，不直接承担真源职责

#### 验收标准

- sync off 时，桌面 profile 读写不经过现有 Web 侧存储实现
- 打开或关闭 sync，不影响桌面本地 profile 能力

#### 影响文件

- 新增 `crates/moontv-profile/*`
- `crates/moontv-local-service/src/lib.rs`
- `Cargo.toml`

### Phase 5：引入 `moontv-sync` 作为可选远端 adapter

#### 目标

把 profile sync 从“local service 里的一段逻辑”升级为正式的可选适配器。

#### 责任边界

`moontv-sync` 负责：

- profile sync 远端代理
- 远端账号会话
- 远端 `server-config` 读取
- 本地 profile 与远端 profile 之间的 adapter 行为

不负责：

- 媒体代理
- 下载执行
- 桌面壳能力

#### 第一阶段建议实现

不要一开始就做复杂离线双向同步，先收敛为：

- sync on：请求级透传远端真源
- sync off：走本地 profile 真源

这可以把复杂度压在当前产品真正需要的范围内。

#### 工作项

- 新建 `crates/moontv-sync`
- 从 local service 提取 sync 目标解析与 session 管理
- 定义远端 profile API typed client
- 明确远端协议不兼容时的降级与报错
- local service 改为依赖 `moontv-sync`

#### 验收标准

- `moontv-local-service` 不再沉积 sync 业务逻辑
- sync 是显式 adapter，可单独测试、单独演进

#### 影响文件

- 新增 `crates/moontv-sync/*`
- `crates/moontv-local-service/src/lib.rs`
- `Cargo.toml`

### Phase 6：清理旧路径并补齐可观测性

#### 目标

在新链路稳定后，删除历史兼容路径和重复判断。

#### 工作项

- 收缩 `db.client.ts` 兼容层
- 清理重复的 `PROFILE_SYNC_*` 判断
- 补齐桌面管理页和设置页的状态文案
- 增加 profile sync 诊断信息：
  - 当前模式
  - 远端可达性
  - 当前远端账号
  - 最近错误
  - 当前同步域
- 输出故障排查文档

#### 验收标准

- 新旧实现边界清楚
- 本地模式与 sync 模式切换可诊断
- 出现故障时能快速判断是配置问题、网络问题还是协议问题

## 7. 路由与契约收口建议

### 7.1 同步域路由清单

建议把下面这些接口明确标为 profile sync 正式路由：

- `GET /api/profile-sync/status`
- `GET /api/server-config`
- `POST /api/login`
- `POST /api/logout`
- `POST /api/change-password`
- `GET|POST|DELETE /api/playrecords`
- `GET|POST|DELETE /api/favorites`
- `GET|POST|DELETE /api/follows`
- `GET|POST|DELETE /api/searchhistory`
- `GET|POST|DELETE /api/skipconfigs`

### 7.2 需要补文档的行为

- `follows` 已进入同步域
- admin data migration 在 sync mode 下会透传远端
- sync mode 不同步下载、缓存、资源站配置
- 401 触发后，本地持有的 `desktop-profile-sync` 会话应被清理

### 7.3 会话语义矩阵

建议在文档和代码里都保持这个定义：

| sessionMode            | 含义                               | 真源                |
| ---------------------- | ---------------------------------- | ------------------- |
| `desktop-local`        | 桌面本地访问会话                   | 本地配置 / 本地账号 |
| `desktop-profile-sync` | 通过本地服务代理得到的远端账号会话 | 远端 Web 后端       |

补充原则：

- `desktop-local` 的显式登出标记只影响本地会话自动恢复
- `desktop-profile-sync` 的失效由远端 401 驱动

## 8. 测试计划

### 8.1 TypeScript 测试

必须补的测试：

- desktop bootstrap 解析
- profile sync 状态写入运行时配置
- 登录页在 sync on/off 下的分支
- 401 时本地浏览器会话清理
- `db.client.ts` 或新 profile SDK 在 sync on/off 下的路径选择
- `follows` 与其它 profile 域行为一致

### 8.2 Rust 测试

必须补的测试：

- profile sync 目标 URL 解析
- 未配置 `profile_sync.api_base_url` 时的行为
- 远端 `server-config` 拉取成功 / 失败
- 登录成功后会话代持
- 401 时会话清理
- `playrecords` / `favorites` / `follows` / `searchhistory` / `skipconfigs` 透传一致性
- admin data migration 在 sync mode 下透传

### 8.3 手工联调清单

- 未配置 sync：桌面完全本地工作
- 配置 sync 且远端可达：可登录并读写五个同步域
- 配置 sync 但远端不可达：UI 能展示错误，不误导为本地模式
- 远端 401：本地会话被清理，重新跳转登录
- 关闭 sync 后重启：回到本地模式
- sync on/off 来回切换：不会污染下载、缓存、媒体代理

## 9. 风险与规避

### 9.1 风险：把桌面重新绑回 Web 后端

规避：

- 明确同步域边界
- 媒体链路继续本地化
- sync 关闭必须可独立运行

### 9.2 风险：启动期状态抖动

规避：

- 用单次 bootstrap 快照代替多次拼接
- UI 首屏只消费解析后的模式

### 9.3 风险：真源冲突

规避：

- 明确 sync on 时远端为同步域真源
- 本地缓存只做性能优化，不做离线真源

### 9.4 风险：迁移时改动面过大

规避：

- 先抽接口和兼容层，再切实现
- `db.client.ts` 先变 wrapper，最后再清理
- local service 先模块化，再拆 crate

## 10. 推荐 PR 拆分

推荐按下面顺序推进：

1. `docs(profile-sync): align protocol, scope, and session model`
2. `feat(desktop): add unified profile bootstrap snapshot`
3. `refactor(profile): extract ts profile sdk and runtime resolver`
4. `refactor(local-service): isolate profile sync facade logic`
5. `feat(profile): scaffold local-first rust profile domain`
6. `refactor(desktop): switch local profile path to rust profile service`
7. `feat(sync): scaffold optional remote profile sync adapter`
8. `refactor(sync): move local-service proxy logic into moontv-sync`
9. `chore(profile-sync): remove redundant legacy client branches`

## 11. 最终验收标准

计划完成后，应满足下面结果：

- 桌面 sync 是可选能力，不是桌面主运行模式
- sync on/off 的行为边界清晰
- profile mode / storage type / session mode 有统一真源
- 桌面前端不再自行拼 profile sync 状态
- 本地 profile 真源在 Rust 层收口
- 远端 sync 逻辑从 local service facade 中抽离
- 协议文档、代码、测试三者一致

## 12. 本计划的落地建议

如果只选择一条最稳妥的推进路线，建议按下面节奏：

1. 先做 Phase 0 和 Phase 1，把模式和启动真源统一。
2. 再做 Phase 2，把前端 profile 客户端收敛。
3. 之后做 Phase 3，把本地服务中的 sync 逻辑抽薄。
4. 最后再进入 `moontv-profile` / `moontv-sync` crate 级收口。

这样可以先解决当前最现实的问题：

- 文档不一致
- 启动状态拼接
- TS 端职责过重
- facade 继续膨胀

同时避免过早进入大规模 crate 拆分，影响当前桌面主线推进。
