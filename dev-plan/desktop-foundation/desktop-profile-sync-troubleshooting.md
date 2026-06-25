# LunaTV Desktop Profile Sync 故障排查

配套文档：

- `dev-plan/desktop-foundation/desktop-profile-sync-execution-plan.md`
- `dev-plan/desktop-foundation/desktop-rustification-roadmap.md`
- `dev-plan/desktop-foundation/desktop-local-service-protocol-v1.md`

## 1. 适用范围

本文只处理桌面版 `profile_sync.api_base_url` 相关问题。

它解决的是下面这条链路：

- 桌面本地服务代持远端 Web 账号会话
- 五个同步域透传到远端：
  - `playrecords`
  - `favorites`
  - `follows`
  - `searchhistory`
  - `skipconfigs`

它**不**处理下面这些能力：

- 下载任务
- 下载缓存
- 媒体代理
- 资源站配置同步

这些能力即使在 sync on 时也仍然应以桌面本地链路为主。

## 2. 快速定位入口

优先从这两个入口看状态：

1. 桌面管理页 `/desktop-admin`
2. 桌面设置页中的“访问控制 > 账号同步状态”

如果这两个入口都读不到状态，再看本地服务本身：

1. 桌面设置页中的“桌面本地服务”状态
2. “运行排查”生成的 diagnostics 报告

## 3. 状态文案对照

### `未启用`

含义：

- 当前没有配置 `profile_sync.api_base_url`
- 桌面应处于纯本地模式

此时应该看到：

- 账号会话语义偏向 `desktop-local`
- 五个同步域不会走远端

优先检查：

- `desktop.config.json` 里是否根本没有 `profile_sync.api_base_url`
- 是否刚把 sync 关闭，但没有重启本地服务

### `已启用但不可达`

含义：

- 已配置远端同步目标
- 但本地服务当前无法访问远端站点

常见原因：

- `profile_sync.api_base_url` 写错
- 远端站点不可达
- 当前网络异常

优先检查：

1. `profile_sync.api_base_url` 是否是完整的 `http://` 或 `https://` 地址
2. 远端站点是否在线
3. 当前网络、代理、防火墙是否拦截了远端请求

### `已连接`

含义：

- 本地服务能访问远端
- 但当前还没有远端登录态

优先检查：

1. 右上角用户菜单是否已经走远端账号登录
2. 是否刚切换 sync on，但还没有重新登录

### `已连接并已登录`

含义：

- 远端目标可达
- 当前桌面已经持有有效的远端账号会话

此时应该看到：

- 当前账号来自远端
- 五个同步域的读写走远端 adapter

### `已连接但登录失效`

含义：

- 远端站点可达
- 但远端会话已失效，通常对应远端 `401`

当前实现约束：

- profile SDK 在远端 `401` 时会立刻清理本地浏览器态
- 桌面 profile sync runtime 在 sync off 时也会清理残留的 `desktop-profile-sync` 会话

优先处理：

1. 重新登录远端账号
2. 确认远端会话没有被服务端主动失效

### `状态未知`

含义：

- 不是“未启用”
- 而是“本地服务没能把 profile sync 状态读出来”

这通常意味着问题已经上升到本地服务层，而不是单纯的远端账号层。

优先处理：

1. 看桌面本地服务是否正常运行
2. 运行 diagnostics
3. 导出排查日志

## 4. 常见问题与处理

### 场景 A：配置了 sync，但页面表现像本地模式

先看“账号同步状态”是不是：

- `未启用`
- `状态未知`

如果是 `未启用`：

- 配置没有真正生效
- 检查 `profile_sync.api_base_url`
- 保存配置后重启本地服务

如果是 `状态未知`：

- 先不要把问题归因为“sync 没开”
- 这更像本地服务读取失败

### 场景 B：远端登录成功后，很快又被踢回登录页

优先判断是不是远端 `401`：

- 用户菜单账号短暂出现后又消失
- 管理页状态变成 `已连接但登录失效`

处理方式：

1. 重新登录远端账号
2. 检查远端 Web 后端是否重置了会话
3. 检查远端 `/api/login`、`/api/logout`、`/api/server-config` 是否正常

### 场景 C：sync on/off 来回切换后账号状态混乱

先确认会话语义：

- `desktop-local`：本地会话
- `desktop-profile-sync`：远端会话

当前预期：

- sync off 后，不应保留残留的 `desktop-profile-sync` 浏览器态
- sync on 后，未登录远端时也不应误显示为本地纯模式

建议排查顺序：

1. 保存配置
2. 重启本地服务
3. 重新打开 `/desktop-admin`
4. 确认状态值是否与配置一致

### 场景 D：管理数据迁移在 sync mode 下行为异常

当前预期：

- `admin data migration export`
- `admin data migration import`

在 sync mode 下都应透传到远端，而不是继续读写桌面本地管理数据。

如果导出正常、导入异常：

- 优先怀疑远端导入接口、multipart 处理或远端认证
- 不要误以为“桌面本地导入逻辑坏了”

## 5. 错误分类与建议动作

### `invalid-base-url`

处理：

- 把 `profile_sync.api_base_url` 改成完整的 `http/https` 地址

### `unreachable`

处理：

- 检查当前网络
- 检查远端站点是否可达
- 检查 DNS、代理、防火墙

### `unauthorized`

处理：

- 重新登录远端账号
- 检查远端会话是否过期

### `protocol-incompatible`

处理：

- 升级桌面端或 Web 端
- 确保两边的 profile sync 协议版本一致

### `upstream-failure`

处理：

- 检查远端 Web 后端日志
- 检查 `/api/server-config` 与账号接口返回

## 6. 建议排查顺序

1. 先确认本地服务是否正常运行。
2. 再确认 `profile_sync.api_base_url` 是否有效。
3. 再确认远端站点是否可达。
4. 最后再判断是不是远端账号会话失效。

不要一上来就把所有问题都归结为“登录坏了”。

很多表象相似的问题，真实根因分别是：

- 配置错误
- 网络不可达
- 协议不兼容
- 远端会话失效
- 本地服务本身没有把状态读出来

## 7. Diagnostics 使用建议

如果状态是 `状态未知`，或者本地服务反复重启失败，优先：

1. 打开桌面设置
2. 运行 diagnostics
3. 导出排查日志

如果已经配置 `profile_sync.api_base_url`：

- diagnostics 导出后会尝试自动上传到远端站点的桌面排查入口

如果没有配置：

- 本地导出仍然应该可用

## 8. 手工联调基线

每次改动 sync 相关逻辑后，至少手动过一遍：

1. 未配置 sync 时，桌面完全本地工作。
2. 配置 sync 且远端可达时，可登录并读写五个同步域。
3. 配置 sync 但远端不可达时，UI 会显示错误，而不是误导为本地模式。
4. 远端 `401` 时，本地会话会被清理，并跳回登录。
5. 关闭 sync 后重启，能回到本地模式。
6. sync on/off 来回切换时，不会污染下载、缓存和媒体代理路径。
