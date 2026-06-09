# LunaTV 桌面优先平台化蓝图

配套执行清单见 `dev-plan/desktop-foundation/phase-1-repo-refactor-checklist.md`。

> **目标顺序** · 桌面版 -> 手机版 -> TV 版  
> **当前结论** · 先拆服务依赖，再上平台壳  
> **桌面 v1 推荐策略** · 本地单用户 + 本地代理服务 + 静态前端

## 为什么先做这份蓝图

当前仓库已经适合做“浏览器站点”，但还不适合直接做“桌面客户端”。

核心原因不是播放器，而是运行形态：

- `next.config.js` 使用 `output: 'standalone'`，说明项目仍以服务端运行时为中心。
- `src/app/layout.tsx` 使用 `dynamic = 'force-dynamic'`，并在服务端读取 `getConfig()`。
- `src/app/api/` 下目前有 `46` 个 route handler。
- VOD、直播、下载都依赖 same-origin `/api/proxy*` 链路。
- 前端非 API 代码里已有至少 `26` 处直接 `fetch('/api/...')` 调用。

这意味着：如果现在直接套 `Tauri`，并不能自动摆脱 Vercel 或 Next 服务端依赖，只会把“浏览器访问站点”换成“桌面 WebView 访问站点”。

## 方案结论

### 采用

- 先做桌面版，作为第一个“去 Vercel 媒体流量依赖”的平台
- 先保留当前单仓库结构，不立即改成 monorepo
- 先抽“平台无关核心逻辑”，再加桌面壳
- 桌面端媒体链路采用“本地 loopback HTTP 服务”，而不是把流媒体代理改成纯 Tauri command
- 桌面端最终采用 `Tauri 2 + Rust 独立本地 HTTP 服务 + SQLite/JSON + 静态前端` 组合
- 数据面走 HTTP，控制面走 Tauri IPC；不要把播放器、下载器、HLS 资源链路改成 IPC 拉流
- 桌面 v1 优先支持本地单用户、本地配置、本地播放记录/收藏/搜索历史

### 暂不采用

- 不在第一阶段直接把整个前端重写成新框架
- 不在第一阶段同时兼顾桌面 / 手机 / TV 三端 UI
- 不在第一阶段保留 Redis / Upstash / Kvrocks 作为桌面默认存储
- 不在第一阶段迁移管理员后台的全部能力
- 不在第一阶段做 TV 焦点导航适配

## 当前代码现状

### 1. 强服务端依赖

当前重要服务端入口包括：

- 配置：`src/lib/config.ts`
- 搜索 / 详情下游：`src/lib/downstream.ts`
- 直播解析：`src/lib/live.ts`
- VOD 代理：`src/lib/download/vod-proxy.ts`
- 用户数据服务端存储：`src/lib/db.ts`
- 鉴权：`src/lib/auth.ts`
- 全站认证中间件：`src/middleware.ts`

### 2. Route handler 分组

`src/app/api/` 当前大致可以分成：

- `admin/*`：13 个
- `proxy/*`：7 个
- `search/*`：5 个
- `douban/*`：5 个
- `live/*`：4 个
- 其他单独接口：登录、收藏、播放记录、搜索历史、配置、Bangumi、cron 等

并不是这些接口都要进入桌面 v1。

### 3. 前端已与 `/api/*` 强耦合

当前前端和客户端逻辑里，至少以下区域直接消费 `/api/*`：

- 登录页
- 搜索预取
- 直播页
- 用户菜单
- 数据迁移组件
- 管理后台
- 豆瓣 / Bangumi 客户端

另外，播放链路和下载链路还会把 `/api/proxy*` 当作资源 URL，而不只是普通 JSON 接口。

### 4. 同源代理是媒体链路前提

当前媒体代理不仅负责“转发”，还负责：

- 注入 `User-Agent` / `Referer`
- 重写 `m3u8`
- 继续重写嵌套 manifest / segment / key / map / LL-HLS part
- 处理 `Range` 和流式响应

因此，桌面版的关键不是“做登录页”，而是先保住这条媒体链路。

## 目标架构

### 总体结构

```text
Desktop Shell (Tauri 2)
  ├─ Static Frontend Bundle
  ├─ Tauri IPC Control Plane
  │   ├─ app lifecycle
  │   ├─ config read/write
  │   ├─ sqlite/json access
  │   ├─ file dialogs / import-export
  │   └─ window / tray / updater / logging
  └─ Local App Service (Rust sidecar, loopback HTTP)
      ├─ content service
      ├─ live service
      ├─ media proxy service
      ├─ metadata service
      ├─ profile/config service
      └─ local storage adapters (SQLite / JSON)
```

### 为什么桌面端要用本地 loopback HTTP 服务

不是所有服务都适合改成 Tauri command。

以下能力更适合继续走 HTTP：

- HLS.js 读取 `m3u8`
- 视频分片和 `Range` 请求
- 下载器按 URL 拉取 manifest / segment / key
- 未来手机端和 TV 端复用同一套服务接口

如果桌面端仍保留“URL 资源流”这层抽象，现有播放器和下载管理器可以最大限度复用。  
因此，桌面代理服务应优先保留 HTTP 语义，而不是把所有请求都塞进原生桥。

### 为什么不用 IPC 承载媒体链路

Tauri IPC 适合命令式控制操作，不适合本项目的媒体主链路。

当前播放器和下载器依赖的是：

- HLS.js 直接消费 `m3u8` URL
- 视频元素直接消费媒体 URL
- 下载器直接 `fetch()` manifest / segment / key
- 代理层继续保留 `Range / Content-Range / Accept-Ranges` 语义

如果改成 IPC 拉流，就必须重写播放器接入、下载器、缓存链路和资源 URL 抽象，收益不足。  
因此桌面版采用：

- HTTP：媒体面 + 共享业务协议
- IPC：控制面 + 原生能力

## 推荐的阶段性技术决策

### 决策 1：第一阶段不拆仓库

当前阶段最重要的是解耦，不是重组目录。  
建议继续使用当前仓库，先在 `src/lib` 下把逻辑分层，稳定后再决定是否拆到 `packages/*`。

### 决策 2：第一阶段保留现有 UI，大幅降低服务端耦合

优先策略：

- 尽量保留现有页面、组件、播放器和下载器
- 把直接依赖 `/api/*` 的代码收敛到统一 transport 层
- 把 route handler 中的真正业务逻辑抽到平台无关模块

这一步完成后，桌面端不再以“复用 TS 服务运行时”为目标，而是以“复用协议、输入输出结构和迁移参考实现”为目标。

### 决策 3：桌面 v1 只做本地单用户

桌面端第一版不应该先做：

- 多用户管理
- 远程共享存储
- 站长后台
- 订阅配置远程拉取与自动更新

桌面 v1 建议只支持：

- 单用户本地资料
- 本地播放记录 / 收藏 / 搜索历史
- 本地配置文件
- 本地媒体代理

### 决策 4：管理员后台进入延后范围

当前 `admin/*` 路由数量最多，但并不是桌面 v1 的核心价值。  
桌面版第一阶段应先保证：

- 搜索
- 详情
- 点播播放
- 直播播放
- 离线下载
- 基础用户数据

后台配置可以先隐藏、降级，或只保留“读取本地配置文件”的最小能力。

## 建议的代码分层

### Phase 1 目标分层

建议先在现有 `src/lib` 下形成如下结构：

```text
src/lib/core/
  content/
  live/
  media/
  metadata/
  profile/

src/lib/runtime/
  config-source.ts
  auth-context.ts
  app-runtime.ts

src/lib/transport/
  api-client.ts
  endpoint.ts

src/lib/server/
  next-route-adapters/
  next-auth.ts

src/lib/platform/
  web/
  desktop/
  mobile/
```

### 说明

- `core/*`：平台无关逻辑，可被 Next route、桌面本地服务、未来手机端复用
- `runtime/*`：环境相关能力，处理“当前运行在哪”
- `transport/*`：前端调用入口，替换硬编码 `/api/*`
- `server/*`：仅保留 Next 适配层
- `platform/*`：未来桌面、手机、TV 差异能力入口

## Route 到服务域的映射

### A. 内容发现域

当前来源：

- `search/*`
- `detail`
- `douban/*`
- `bangumi/calendar`

未来应收敛为：

- `content service`
- `metadata service`

### B. 直播域

当前来源：

- `live/sources`
- `live/channels`
- `live/epg`
- `live/precheck`

未来应收敛为：

- `live service`

### C. 媒体代理域

当前来源：

- `proxy/*`
- `proxy/vod/*`
- `image-proxy`

未来应收敛为：

- `media proxy service`

这是桌面 v1 里优先级最高的一组能力。

### D. 用户数据域

当前来源：

- `favorites`
- `playrecords`
- `searchhistory`
- `skipconfigs`
- `login`
- `logout`
- `change-password`
- `server-config`

未来应收敛为：

- `profile service`
- `session service`

桌面 v1 可以先不保留 cookie 形态，改成显式本地 profile 上下文。

### E. 管理后台域

当前来源：

- `admin/*`
- `cron`
- `data_migration/*`

未来应收敛为：

- `admin service`
- `sync/import-export service`

桌面 v1 中建议整体降级处理。

## 桌面 v1 的建议范围

### 必做

- 搜索 / 详情 / 播放
- 直播
- 媒体代理
- 本地下载
- 本地播放记录 / 收藏 / 搜索历史
- 本地配置文件读取

### 应做

- 豆瓣 / Bangumi 只保留能直接复用的只读能力
- 登录简化为本地 profile / 启动密码
- 基础错误恢复和日志导出

### 明确延后

- 多用户系统
- 远程 Redis / Upstash / Kvrocks
- 完整管理员后台
- 配置订阅自动更新
- 云同步
- TV 端焦点导航 UI

## 分阶段路线

## Phase 0：定义边界，不改运行时

目标：

- 统一桌面优先方向
- 锁定桌面 v1 范围
- 明确哪些路由先抽、哪些延后

产出：

- 本蓝图
- 第一阶段执行清单

## Phase 1：仓库内解耦

目标：

- 不改变现有 Web 行为
- 但开始清除“页面/组件直接绑定 Next API”的结构性问题

重点动作：

1. 引入统一 API transport 层
2. 把硬编码 `/api/*` 收敛到 helper
3. 把 `config / auth / downstream / media proxy / live` 的核心逻辑从 Next route 中抽离
4. 让核心逻辑不再直接依赖 `NextRequest`、cookie、中间件

退出标准：

- 核心业务逻辑可以被“Next route adapter”包裹
- 未来也可以被“desktop local service adapter”包裹

## Phase 2：桌面本地服务原型

目标：

- 在本地起一个最小 Rust 服务原型
- 先证明媒体代理链路可行

实现形态：

- `src-tauri/` 负责桌面壳和进程托管
- `crates/moontv-local-service/` 负责本地 HTTP 服务
- Tauri 负责 sidecar 启停、健康检查、崩溃重启和退出清理

建议技术栈：

- HTTP：`axum`
- async runtime：`tokio`
- 数据层：`rusqlite` 或 `sqlx/sqlite`
- 配置：JSON 文件

控制面和数据面分工：

- HTTP：`/media/*`、`/content/*`、`/live/*`
- IPC：配置读写、SQLite 管理、导入导出、下载任务控制、原生能力

建议最先实现的控制面 IPC：

- `start_local_service`
- `stop_local_service`
- `get_local_service_status`
- `read_app_config`
- `write_app_config`

建议优先打通：

- `/health`
- `/media/vod/m3u8`
- `/media/vod/segment`
- `/media/vod/key`
- `/content/search`
- `/content/detail`

退出标准：

- 本地服务可驱动现有播放器播放 VOD
- 下载链路可继续工作

## Phase 3：静态前端适配

目标：

- 清理 `dynamic = 'force-dynamic'`
- 清理服务端 `generateMetadata()` 依赖
- 让前端能静态构建并在桌面壳中运行

重点动作：

- 将运行时配置改为显式注入
- 把 layout 中的服务端配置读取迁到客户端或本地服务
- 为 transport 提供桌面 base URL

退出标准：

- 前端不依赖 Next SSR 才能启动

2026-06-09 当前落地状态：

- 已增加 `NEXT_BUILD_TARGET=desktop` 构建模式，桌面前端走静态导出并输出到 `desktop-shell-dist/`
- 已在桌面构建时临时移出 `src/app/api` 与 `src/middleware.ts`，避免静态导出继续绑定 Web route handler
- 已将搜索建议、详情、豆瓣评分等桌面用户路径改为统一 transport 访问，不再要求 same-origin `/api/*`
- 已在桌面目标下强制关闭 PWA、fluid search、后台入口，确保桌面 alpha 先收敛到可用主链路
- 已通过 `pnpm desktop:build:frontend` 验证静态前端可独立构建

## Phase 4：Tauri 桌面壳

目标：

- 引入桌面壳
- 启动并托管 Rust 本地服务
- 加入桌面文件系统、日志、窗口、自动更新等能力

退出标准：

- 可交付桌面测试版
- 不依赖 Vercel 跑媒体代理

2026-06-09 当前落地状态：

- Tauri `beforeBuildCommand` 已接入桌面静态前端构建和 release sidecar 同步
- 本地 Rust 服务已覆盖 `/health`、`/content/search`、`/content/detail`、`/content/suggestions`、`/metadata/douban/ratings` 以及 VOD 代理链路
- 前端已接入 Tauri IPC，可在设置面板中查看本地服务状态、编辑桌面 JSON 配置并重启本地服务
- 已通过 `pnpm desktop:check`、`pnpm desktop:test`、`pnpm desktop:build` 验证桌面壳、sidecar 和前端产物可闭环
- 当前已实际产出 macOS 测试包：
  - `target/release/bundle/macos/LunaTV Desktop.app`
  - `target/release/bundle/dmg/LunaTV Desktop_0.1.0_x64.dmg`

## Phase 5：手机版

目标：

- 复用 `core/*`、transport 协议和本地服务抽象
- 针对移动端做权限、存储、后台行为适配

此阶段再决定是继续沿用 Tauri mobile，还是切到更合适的移动壳。

## Phase 6：TV 版

目标：

- 尽量复用服务层和播放层
- 单独重做 TV 导航和焦点交互

TV 版不应建立在“复用桌面 UI”这个前提上。

## 关键风险

### 1. 媒体代理不是普通接口

它要求：

- URL 可被播放器直接消费
- 支持大体量流式传输
- 保持 `Range` 语义
- 保持清单重写

因此不能把它草率替换成普通原生桥方法。

### 2. 鉴权当前以 cookie + middleware 为中心

当前很多逻辑默认存在：

- cookie
- `NextRequest`
- middleware 鉴权

桌面端应逐步改成显式 `AuthContext` / `ProfileContext`，而不是继续模拟 Web cookie。

### 3. 配置当前以服务端读取为中心

当前 `layout` 和很多 route 都会直接 `getConfig()`。  
这会阻碍静态前端和平台壳。

### 4. 管理后台会稀释第一阶段产出

如果一开始就要求桌面版完整支持后台管理、多用户、导入导出、订阅更新，桌面 v1 周期会明显失控。

## 推荐的第一阶段落点

桌面优先不是“先做 Tauri 页面”，而是先把现有仓库变成这样：

- 现有 Web 站还能正常跑
- 业务核心逻辑已不依赖 Next route handler
- 前端对 `/api/*` 的直接依赖明显减少
- 媒体代理逻辑可被单独复用

只要这个状态达成，后续：

- 桌面版可以加本地服务
- 手机版可以复用 transport 和服务域
- TV 版可以复用播放内核和内容服务

这才是对后续三端都最省成本的起点。
