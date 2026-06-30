# LunaTV 音乐中心重置与占位期设计

**目标**

在当前 `desktop` 方向工作树中，先将现有 `/music` 对应的旧音乐 UI 和旧运行时行为安全下线，再为后续基于 `Rust + TypeScript + Tauri` 的 YesPlayMusic 重建预留干净入口。此次设计的重点不是立即重写新播放器，而是先完成“旧系统软下线、桌面基础设施保留、重建边界稳定化”，并把迁移步骤写成可执行的工程方案。

**已确认决策**

1. 现有 `/music` 不继续增量改造，按“清空旧功能后重建”处理
2. 本阶段采用“仅清空 UI，保留桌面音乐基础设施”的路径
3. `/music` 路由保留，但改成“音乐中心重构中”的占位页
4. 现有旧音乐播放行为临时禁用，不允许后台恢复、继续播放或抢占音频输出
5. `/music` 相关旁路能力一并隐藏或禁用，包括主导航入口、tray 音乐控制以及任何经实现审计确认的旧音乐下载/设置入口
6. 占位期采用明确运行时语义：`/music` 直达保留、主导航不再展示音乐入口、旧音乐 HTTP 路由与 Tauri IPC 进入禁用态

**范围**

- 保留正式 `/music` 路由路径，但始终渲染占位页
- 移除旧音乐全局运行时挂载，确保应用启动后不会恢复旧音乐播放
- 隐藏侧边栏、移动底部导航以及其他已确认的用户可见音乐入口
- 停用旧音乐 tray 菜单与其对应前端联动
- 在冻结旧模块前，先抽离共享 `music contracts / record schemas / sanitizers`
- 保留 `src-tauri/**`、现有窗口逻辑、Tauri bridge、本地 sidecar、桌面更新和视频桌面壳
- 保留旧音乐 API、旧 Rust 音乐命令和旧前端音乐源码作为暂存资产，但其占位期对外行为由单独的运行时语义定义
- 保留旧音乐持久化数据与桌面下载产物，不在本阶段直接清空或迁移
- 为下一阶段新的 YesPlayMusic 模块预留稳定目录、版本化存储命名空间和边界契约

**不做**

- 不在本阶段直接接入新的 YesPlayMusic UI 或播放核心
- 不在本阶段全量删除 `src/features/music/**`
- 不在本阶段立即删除 `/api/music/*` 或 Rust 音乐 IPC 源码
- 不在本阶段执行旧音乐数据向新模型的正式迁移
- 不在本阶段为旧音乐系统提供并行回退页
- 不在本阶段改变现有视频、直播、下载、更新、登录等主流程

**现状结论**

- 当前音乐功能不是单一路由页面，而是分散在根布局、导航、全局播放器根节点、桌面 tray、下载桥接和 `/api/music/*` 上
- 旧音乐播放器根节点目前以全局方式挂在应用布局中，因此只改 `/music` 页面无法真正停用旧音乐行为
- 共享运行时层已经直接依赖旧音乐契约与 record schema，典型位置包括 DB 层、profile 服务层和桌面 Tauri bridge，因此“整体迁目录”在当前仓库中不可直接执行
- 管理台配置与运行时投影仍把 `EnableWebMusic` 当作在线产品开关使用，如果不重定义其占位期语义，文档、配置和 UI 会出现分裂
- 现有桌面集成中，窗口配置、Tauri 命令、sidecar、本地配置和更新机制都已经稳定，不应为了重建音乐 UI 一并拆掉

**核心方案**

1. 先做 `Phase 0`：抽离共享音乐契约，再谈旧模块冻结或迁移
2. 占位期不使用“看起来下线、实际上还能调用旧逻辑”的模糊语义，而是显式定义路由、配置、HTTP、IPC 和 tray 的行为
3. 旧音乐源码与旧音乐数据先按 `v1 legacy` 资产保留，不在本阶段做数据迁移
4. 旧前端实现冻结前，必须先让共享层彻底脱离 `@/features/music/**`
5. 后续新的 YesPlayMusic 模块按 `v2` 独立命名空间开发，禁止默认读取 `v1` 遗留数据

**目标状态**

占位期完成后，系统应满足以下状态：

- 访问 `/music` 时只显示占位页
- 应用启动后不会自动恢复旧音乐播放现场
- 桌面 tray 中不再出现旧音乐播放控制
- 侧边栏和移动底部导航不再展示“音乐”入口
- `EnableWebMusic` 不再驱动占位期导航显隐或页面装配
- `/api/music/*` 不再提供旧音乐正式功能
- 旧音乐 Tauri IPC 即使被调用，也只返回稳定的禁用态错误
- `v1` 遗留数据和桌面下载产物继续保留，等待未来独立迁移方案
- 视频、直播、下载、更新、登录、本地 sidecar 以及窗口逻辑保持可用

**占位期运行时语义**

路由语义：

- `/music` 路由始终可直接访问
- `/music` 页面始终渲染占位页，不再渲染旧 `MusicPageShell`
- `/music` 的可访问性不再由 `EnableWebMusic` 决定

导航语义：

- 侧边栏和移动底部导航在占位期内一律不渲染“音乐”入口
- 即使后台仍保留旧 `EnableWebMusic` 持久化值，导航也不得据此恢复旧入口

配置语义：

- 管理台不再展示旧“启用网页音乐”开关，避免产生错误预期
- 旧 `EnableWebMusic` 持久化值保留，但占位期内 `buildPublicRuntimeConfig` 与桌面运行时刷新逻辑必须强制投影 `ENABLE_WEB_MUSIC=false`
- 该值在新音乐中心上线前视为保留字段，而不是当前 UI 行为开关

HTTP 语义：

- 所有旧 `/api/music/*` 路由在占位期统一返回 `410 Gone`
- 返回头必须包含 `Cache-Control: no-store`
- 返回体必须包含稳定的结构化错误信息，例如 `music feature disabled during placeholder phase`
- 旧音乐账号二维码、会话、收藏、播放、搜索和 profile 相关路由均按同一禁用语义处理

IPC 语义：

- 旧音乐 Tauri 命令在源码中暂时保留，但占位期被调用时必须返回稳定的禁用态错误
- 错误语义统一为“占位期已禁用旧音乐功能”，不得继续执行旧下载、旧播放或旧 tray 状态同步

Tray 语义：

- Tauri `setup` 阶段不再安装旧音乐 tray
- 前端不再监听或发送旧音乐 tray 事件

Session 语义：

- 旧音乐账号 cookie、桌面下载记录和 profile 数据可以保留
- 占位期内任何活跃路由都不得继续刷新、写入或变更这些旧音乐会话资产

**拆除边界**

保留的部分：

- `src-tauri/tauri.conf.json` 中的窗口配置、构建命令和 `externalBin`
- `src-tauri/src/main.rs` 与 `src-tauri/src/lib.rs` 中的桌面壳、sidecar、本地配置、更新器和主窗口生命周期
- `src/lib/desktop/tauri-client.ts` 中统一的 Tauri 前端桥接外观层
- 现有视频播放器、直播播放器、下载流程和公共桌面布局
- 旧音乐持久化数据、桌面下载文件和相关 JSON 记录文件
- 旧音乐源码，前提是其对外行为受占位期运行时语义约束

临时下线的部分：

- `src/app/music/page.tsx` 对应的正式音乐页面内容
- 根布局中的旧 `MusicPlayerRoot` 全局挂载
- 侧边栏与移动底部导航中的“音乐”入口
- 管理台中的旧“启用网页音乐”开关
- 旧音乐 tray 菜单与前端 tray 事件联动
- 任何经实现审计确认的旧音乐下载、设置或账号入口

**Phase 0：共享契约抽离**

目标：

- 在冻结旧 `src/features/music/**` 之前，先把仍被共享层依赖的音乐契约抽离到 feature 目录外

建议新位置：

```text
src/lib/music-contracts/
  entities.ts
  music-collection-profile-records.ts
  music-playback-session-records.ts
  music-preferences-records.ts
  music-profile-records.ts
```

抽离要求：

- `src/lib/**`、`src/app/api/**`、`src/components/**`、`src/lib/desktop/**` 等共享层不得继续直接 import `@/features/music/**`
- 仅音乐 UI、旧音乐编排逻辑和未来 `music-legacy` 允许依赖 `src/features/music/**`
- 只有在共享层 import 全部切到 `src/lib/music-contracts/**` 后，才允许将旧前端实现迁入 `src/features/music-legacy/`

**迁移阶段与顺序**

1. `Phase 0`：抽离共享契约
   - 把 `entities`、`record schemas`、`sanitizers` 从旧 feature 目录迁到 `src/lib/music-contracts/**`
   - 更新 DB 层、profile 服务层、桌面 bridge 和 API 路由的 import
   - 用 `rg "@/features/music/" src` 验证共享层残留依赖
2. `Phase 1`：切断全局副作用
   - 根布局移除旧 `MusicPlayerRoot`
   - Tauri `setup` 阶段停用旧音乐 tray 安装
   - `/music` 路由替换为占位页
3. `Phase 2`：切断用户入口与错误配置暗示
   - 隐藏侧边栏“音乐”
   - 隐藏移动底部导航“音乐”
   - 管理台隐藏旧“启用网页音乐”开关
   - 继续审计并移除任何已确认的旧音乐下载、设置或账号入口
4. `Phase 3`：禁用旧运行时面
   - 所有旧 `/api/music/*` 路由统一返回 `410 Gone`
   - 旧音乐 Tauri IPC 统一返回禁用态错误
   - 停止任何旧音乐 cookie 写入、tray 事件和后台恢复逻辑
5. `Phase 4`：冻结旧实现
   - 在共享层已脱钩前提下，将剩余旧前端实现迁入 `src/features/music-legacy/`
   - `music-legacy` 仅保留参考价值，不再承载活跃运行时

**回滚点**

- 回滚点 A：`Phase 0` 完成后，行为应保持不变，但共享层已不再依赖 `@/features/music/**`
- 回滚点 B：切断全局副作用后，应用可启动，`/music` 为占位页，旧音乐不再自动播放
- 回滚点 C：切断入口与配置暗示后，用户无法从主导航进入旧音乐，管理台也不再误导性展示开关
- 回滚点 D：禁用旧运行时面后，直打 `/api/music/*` 或旧音乐 IPC 只会得到禁用态响应
- 回滚点 E：冻结旧实现后，即使新音乐重建延期，也可在不恢复旧共享依赖的前提下继续开发

**重建目录规划**

正式重建时采用以下目录结构：

```text
src/
  app/
    music/
      page.tsx
  features/
    music-legacy/
      ...旧音乐实现，仅供参考
    music/
      app/
      components/
      domain/
      services/
        providers/
          yesplaymusic/
        desktop/
        playback/
      state/
      tests/
  lib/
    music-contracts/
    playback/
      media-arbiter.ts
```

目录职责：

- `src/app/music/page.tsx`
  - 仅做路由入口装配
- `src/features/music-legacy/*`
  - 旧音乐实现，只读参考
- `src/features/music/app/*`
  - 页面级容器与场景组装
- `src/features/music/components/*`
  - 新音乐 UI 组件
- `src/features/music/domain/*`
  - 新音乐领域层与仓储接口
- `src/features/music/services/providers/yesplaymusic/*`
  - YesPlayMusic 或上游音乐源适配层
- `src/features/music/services/desktop/*`
  - 桌面专属能力包装层
- `src/features/music/state/*`
  - 新音乐状态层
- `src/lib/music-contracts/*`
  - 共享实体、record schema、sanitize helper，供 DB、profile、desktop bridge 与 legacy/v2 两侧共用
- `src/lib/playback/media-arbiter.ts`
  - 音视频互斥协调器

**边界契约**

1. UI 不直连 Tauri
   - React 组件不得直接导入 `@tauri-apps/api/*`
   - 桌面能力必须经过 `src/lib/desktop/tauri-client.ts` 或新的桌面服务层
2. UI 不直连第三方音乐源
   - 页面和 store 只消费统一领域实体
   - 上游接口差异只允许出现在 provider adapter 层
3. 音频互斥必须全局协调
   - 视频开始播放时，协调器暂停音乐
   - 音乐开始播放时，协调器暂停视频
   - 该逻辑不得散落在单个页面中
4. 路由层只做装配
   - `/music` 路由文件不承载播放器核心、网络请求或桌面 IPC 逻辑
5. 共享层禁止依赖旧 feature 目录
   - `src/lib/**`、`src/app/api/**`、`src/components/**` 等共享层不得直接 import `@/features/music/**`
6. 新音乐系统必须使用版本化命名空间
   - 新 `v2` 音乐模块默认不得读取 `v1` 遗留本地 key、profile record 或桌面下载记录
7. 旧模块只读冻结
   - 迁入 `music-legacy` 后只允许参考，不允许新代码继续依赖

**遗留数据策略**

- 占位期不清空旧音乐本地数据与远端 profile 数据
- 旧本地 key 视为 `v1 legacy`，包括但不限于：
  - `moontv_music_preferences`
  - `moontv_music_playback_session`
- 旧 profile 数据、收藏、播放记录、最近播放、搜索历史和集合记录继续保留，但占位期不再由活跃 UI 写入
- 旧桌面下载文件与下载记录保留，但不再由活跃 UI 展示或修改
- 后续新的 YesPlayMusic 模块必须采用新的 `v2` 命名空间、payload 和 record schema
- 若未来需要迁移 `v1 -> v2`，必须单独产出迁移设计，而不是在占位期隐式兼容

**测试基线迁移**

- 更新 `/music` 页面测试，不再断言渲染旧 `MusicPageShell`
- 更新导航测试，不再因为 `EnableWebMusic=true` 而期待出现音乐入口
- 更新运行时配置测试，覆盖占位期 `ENABLE_WEB_MUSIC=false` 的强制投影语义
- 新增 `/api/music/*` 返回 `410 Gone` 的测试
- 新增旧音乐 IPC 返回禁用态错误的测试
- 新增静态校验或 grep 验收，确保共享层不再 import `@/features/music/**`

**验收标准**

占位期验收：

- `pnpm typecheck` 通过
- `pnpm desktop:check` 通过
- 桌面应用启动正常
- 访问 `/music` 显示占位页
- 无论旧持久化 `EnableWebMusic` 值为何，侧边栏和移动底部导航都不展示“音乐”
- 管理台不再展示旧“启用网页音乐”开关
- 直打旧 `/api/music/*` 返回 `410 Gone` 且带 `Cache-Control: no-store`
- 调用旧音乐 Tauri IPC 时返回稳定禁用态错误
- 旧音乐不会自动恢复播放，也不会继续占用音频输出
- tray 中不再出现旧音乐控制
- `/play`、`/live`、下载、更新、登录和 sidecar 功能无回归

重建准备阶段验收：

- 共享层 import 已切到 `src/lib/music-contracts/**`
- `src/features/music-legacy/**` 之外的共享层不再 import `@/features/music/**`
- 新 `music` 模块可以在不依赖旧运行时的前提下独立开发
- 新音乐模块默认不读取 `v1 legacy` 数据
- 音视频互斥协调器拥有单独落点，不与任一页面耦合

**主要风险与缓解**

- 风险：只改 `/music` 页面，不移除根布局里的旧播放器挂载，旧音乐仍会后台运行
  - 缓解：先切断全局副作用，再处理路由和导航
- 风险：不先抽离共享契约就迁目录，会导致 DB、profile、desktop bridge 和 API 路由编译失败
  - 缓解：把共享契约抽离定义为 `Phase 0` blocker
- 风险：`EnableWebMusic` 仍被当作在线产品开关，造成配置和 UX 分裂
  - 缓解：占位期强制投影 `ENABLE_WEB_MUSIC=false`，并隐藏管理台旧开关
- 风险：新音乐系统误读 `v1` 旧数据，导致 schema 冲突或脏恢复
  - 缓解：明确 `v2` 命名空间隔离，迁移另立设计

**下一步**

本设计批准后，下一阶段应先产出实现计划，再按 `Phase 0 -> Phase 1 -> Phase 2 -> Phase 3 -> Phase 4` 的顺序执行。
