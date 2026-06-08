# LunaTV 桌面优先第一阶段执行清单

配套蓝图见 `dev-plan/desktop-foundation/desktop-first-platform-blueprint.md`。

## 第一阶段目标

第一阶段不是上 Tauri，不是做桌面安装包，而是先完成下面这件事：

> 在不破坏现有 Web 版本的前提下，把仓库改造成“核心逻辑可脱离 Next route handler 复用”的形态。

## 第一阶段完成标准

- 业务核心逻辑可以被 Next route adapter 调用
- 前端不再到处硬编码 `/api/*`
- 媒体代理逻辑可以被单独复用到桌面本地服务
- `config / auth / storage / transport` 的边界明确
- 后续桌面端只需要补“本地服务 + 壳”，而不是再大拆仓库

## 范围控制

### 本阶段纳入

- 搜索 / 详情
- 直播基础服务
- VOD / IPTV 媒体代理
- 本地用户数据接口抽象
- 运行时配置与 transport 解耦

### 本阶段不纳入

- Tauri 初始化与打包
- 完整管理员后台迁移
- 多用户能力
- 远程 Redis / Upstash / Kvrocks 作为桌面默认方案
- TV UI
- 手机端壳

## 任务清单

### 1. 建立 transport 基础层

- [x] 新增统一的 API endpoint/helper，避免组件和页面继续拼接 `/api/*`
- [x] 新增统一 `apiFetch` 封装
- [x] 支持“same-origin Web”和“desktop local service base URL”两种运行模式
- [x] 先替换前端里最核心的 `/api/*` 调用入口

建议优先覆盖：

- `src/app/live/page.tsx`
- `src/app/play/page.tsx`
- `src/lib/playback-source-prefetch.ts`
- `src/lib/bangumi.client.ts`
- `src/components/UserMenu.tsx`

### 2. 盘点并收敛媒体 URL 构建

- [ ] 收敛 VOD 代理 URL 构建逻辑
- [ ] 收敛直播代理 URL 构建逻辑
- [ ] 识别所有“资源 URL 不是 fetch JSON，而是播放器直接消费”的路径
- [ ] 为桌面本地服务预留可配置 proxy base

关键文件：

- `src/lib/download/proxy-url.ts`
- `src/app/api/proxy/m3u8/route.ts`
- `src/app/api/proxy/segment/route.ts`
- `src/app/api/proxy/key/route.ts`
- `src/app/api/proxy/vod/*`
- `src/app/live/page.tsx`
- `src/app/play/page.tsx`

### 3. 抽离平台无关的内容服务

- [x] 将搜索和详情下游逻辑整理成平台无关 service
- [x] 明确输入参数，不直接依赖 `NextRequest`
- [x] 将 route handler 缩成薄适配层

关键文件：

- `src/lib/downstream.ts`
- `src/app/api/search/route.ts`
- `src/app/api/search/one/route.ts`
- `src/app/api/search/resources/route.ts`
- `src/app/api/search/suggestions/route.ts`
- `src/app/api/detail/route.ts`

### 4. 抽离平台无关的直播服务

- [x] 把直播源、频道、EPG、预检逻辑整理成服务域
- [x] 区分“只读配置查询”和“带代理请求头的上游访问”
- [x] 让直播页最终依赖统一 live service client

关键文件：

- `src/lib/live.ts`
- `src/app/api/live/sources/route.ts`
- `src/app/api/live/channels/route.ts`
- `src/app/api/live/epg/route.ts`
- `src/app/api/live/precheck/route.ts`

### 5. 抽离平台无关的媒体代理核心

- [ ] 把 VOD manifest 重写、headers 生成、上游解析抽离成可复用 core
- [ ] 把 IPTV m3u8 / segment / key 代理核心收敛成独立 service
- [ ] 明确本地桌面服务要复用的最小接口

关键文件：

- `src/lib/download/vod-proxy.ts`
- `src/app/api/proxy/vod/m3u8/route.ts`
- `src/app/api/proxy/vod/segment/route.ts`
- `src/app/api/proxy/vod/key/route.ts`
- `src/app/api/proxy/m3u8/route.ts`
- `src/app/api/proxy/segment/route.ts`
- `src/app/api/proxy/key/route.ts`

### 6. 抽离配置来源

- [ ] 把 `getConfig()` 背后的来源拆开
- [ ] 区分“配置模型”“配置文件读取”“数据库读取”“运行时注入”
- [ ] 停止让 UI 初始化直接依赖服务端 `getConfig()`

关键文件：

- `src/lib/config.ts`
- `src/app/layout.tsx`
- `src/app/api/server-config/route.ts`

### 7. 抽离认证上下文

- [ ] 停止让核心逻辑直接依赖 cookie
- [ ] 为核心服务定义显式 `AuthContext` / `ProfileContext`
- [ ] 让 Next middleware 和 route handler 只做 Web 适配

关键文件：

- `src/lib/auth.ts`
- `src/middleware.ts`
- `src/lib/download/vod-proxy.ts`
- 所有直接 `getAuthInfoFromCookie()` 的 route

### 8. 收敛本地用户数据能力

- [ ] 明确桌面 v1 默认只支持本地单用户
- [ ] 盘点 `db.ts` / `db.client.ts` 中哪些能力可以直接复用
- [ ] 把“本地 profile 数据”与“远程共享存储”拆开

关键文件：

- `src/lib/db.ts`
- `src/lib/db.client.ts`
- `src/lib/types.ts`

### 9. 降级管理员后台

- [ ] 明确桌面 v1 不迁移全部 `admin/*`
- [ ] 为后续保留接口，但不把后台迁移作为第一阶段阻塞项
- [ ] 可考虑在第一阶段先隐藏桌面端后台入口

### 10. 为后续桌面本地服务定义最小协议

- [ ] 先定义，不实现完整桌面服务
- [ ] 明确以下最小接口：

必需：

- [ ] `GET /content/search`
- [ ] `GET /content/detail`
- [ ] `GET /media/vod/m3u8`
- [ ] `GET /media/vod/segment`
- [ ] `GET /media/vod/key`
- [ ] `GET /live/sources`
- [ ] `GET /live/channels`
- [ ] `GET /live/epg`

可选：

- [ ] `GET /metadata/bangumi/calendar`
- [ ] `GET /metadata/douban/*`

本阶段只需要协议稳定，不要求全部实现。

## 建议拆分顺序

### PR 1：transport 和 endpoint 收口

目标：

- 先减少前端硬编码 `/api/*`
- 不动主要业务逻辑

### PR 2：内容服务抽离

目标：

- 搜索 / 详情先从 route handler 中抽出来

### PR 3：媒体代理抽离

目标：

- 为桌面本地服务打通最关键的复用核心

### PR 4：配置与认证上下文抽离

目标：

- 清理对 `getConfig()` / cookie / middleware 的隐式依赖

### PR 5：桌面协议定义

目标：

- 给 Phase 2 的本地服务实现铺路

## 验证要求

### 必测

- [ ] Web 版搜索仍可用
- [ ] Web 版点播播放仍可用
- [ ] Web 版直播仍可用
- [ ] 下载链路不回退
- [ ] 本地收藏 / 播放记录 / 搜索历史不回归

### 建议补测

- [ ] `ua/referer` 自定义源
- [ ] 带 `Range` 的代理请求
- [ ] 嵌套 manifest
- [ ] LL-HLS part/preload 重写

## 第一阶段的红线

- 不要先写 Tauri 壳再回头拆服务
- 不要在第一阶段把管理员后台当主目标
- 不要把媒体代理改成不能流式消费的纯函数调用
- 不要把移动端和 TV 端需求提前混进桌面 v1

## 第一阶段完成后的理想状态

完成后，仓库应具备以下特征：

- Web 版继续可运行
- 核心逻辑已从 Next route handler 中解耦
- 前端 transport 已可切换到桌面本地服务
- 媒体代理能力已具备被桌面端复用的边界

这时再开始 Tauri 集成，风险和返工都会明显下降。
