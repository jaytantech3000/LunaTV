# 桌面版“追更”功能方案

## 目标

先在桌面版实现“追更”能力，覆盖以下场景：

1. 视频卡片右键菜单新增“追更”入口。
2. 开启追更后，记录开启时间和当时已知的更新集数。
3. 有新集更新时，在视频卡片上显示 `NEW` 标记。
4. 播放页选集列表中，对新集按钮做明确标识。

当前阶段仅保存方案，不进入代码实现。后续 Web 版应尽量复用同一套数据结构、判定规则和前端组件协议。

## 范围

首版只覆盖桌面版点播内容，且要求卡片具备稳定的 `source + id`。

不在首版范围内的内容：

- 豆瓣卡片
- 聚合卡片但没有稳定主资源标识的场景
- 直播卡片
- 系统通知
- Web 版同步实现

## 现状判断

当前项目中已有几块可以直接复用：

- 视频卡片右键入口已存在，入口位于 `src/components/VideoCard.tsx`。
- 播放页选集组件已独立，位于 `src/components/EpisodeSelector.tsx`。
- 播放进度保存链路已存在，位于 `src/app/play/page.tsx`。
- 收藏和播放记录已有统一的前端缓存、事件广播和 profile sync 适配层，位于 `src/lib/db.client.ts`。

同时也存在一个需要规避的问题：

- 收藏卡片上的总集数目前本质上是历史快照，不是实时集数。
- 因此“追更”不能只依赖 `Favorite.total_episodes`，必须有一条独立的刷新和比对链路。

## 核心设计

### 1. 单独建模，不复用 Favorite

不建议把“追更”状态直接塞进 `Favorite`，原因如下：

- 追更和收藏不是同一个概念。
- 后续可能存在“取消收藏但继续追更”的需求。
- 追更需要独立的刷新时间、最新集数、已确认集数等字段。
- 单独建模后，桌面版和 Web 版都更容易复用。

建议新增 `FollowRecord` 数据结构，按 `source+id` 存储。

### 2. 建议字段

`FollowRecord` 建议至少包含：

- `title`
- `source_name`
- `cover`
- `year`
- `search_title`
- `followed_at`
- `followed_episode_count`
- `acknowledged_episode_count`
- `latest_episode_count`
- `last_checked_at`

字段含义：

- `followed_at`
  记录用户开启追更的时间。
- `followed_episode_count`
  记录用户开启追更时的真实集数快照。
- `acknowledged_episode_count`
  记录用户已经“确认过”的最大集数，用于判断哪些集属于新集。
- `latest_episode_count`
  记录最近一次检查到的最新真实集数。
- `last_checked_at`
  记录最近一次远端详情检查时间，供桌面轮询节流使用。

## 状态判定规则

### 1. 开启追更时

不要直接信任卡片传入的 `episodes`。

原因：

- 收藏页和继续观看页的集数可能已经过期。
- 追更的初始基线必须是“当前真实集数”。

因此开启追更时应先拉一次详情，再写入：

- `followed_episode_count = currentRealEpisodeCount`
- `acknowledged_episode_count = currentRealEpisodeCount`
- `latest_episode_count = currentRealEpisodeCount`

### 2. 卡片 NEW 判定

建议规则：

- 当 `latest_episode_count > acknowledged_episode_count` 时，显示 `NEW`。

这样可以自然得到“新集区间”：

- `(acknowledged_episode_count, latest_episode_count]`

### 3. 新集按钮判定

在播放页选集列表中：

- 集号大于 `acknowledged_episode_count`
- 且集号小于等于 `latest_episode_count`

则该按钮标记为新集。

### 4. 新集消除规则

首版不额外加“手动清除新集”按钮，直接走自动推进。

当用户真正开始播放第 `N` 集后：

- `acknowledged_episode_count = max(acknowledged_episode_count, N)`

这样行为会更自然：

- 从 12 集更新到 14 集时，13 和 14 标记为新集。
- 用户播放 13 后，只剩 14 是新集。
- 用户播放 14 后，卡片 `NEW` 自动消失。

### 5. 集数回退处理

首版不建议在发现集数减少时主动回退 `latest_episode_count`。

原因：

- 第三方源可能短暂异常。
- 如果直接回退，可能误清除 `NEW` 状态。

建议首版策略：

- 仅当发现更大的集数时更新 `latest_episode_count`
- 小于等于当前 `latest_episode_count` 的结果只更新 `last_checked_at`

## UI 方案

### 1. 视频卡片

入口位置：

- `VideoCard` 的右键菜单
- 现有长按菜单可以先保持兼容，但桌面版优先生效

菜单项建议：

- 未追更时显示“开启追更”
- 已追更时显示“取消追更”

卡片状态建议：

- 在海报角标区增加 `NEW` 小标签
- 风格建议和评分、集数角标区分开
- 优先使用偏暖色，例如琥珀或橙红色，避免和现有绿色集数标签混淆

### 2. 播放页选集列表

在 `EpisodeSelector` 上增加新集区间输入参数，例如：

- `newEpisodeStart`
- `newEpisodeEnd`

按钮表现建议：

- 普通未选中集：维持现有样式
- 新集未选中：增加高亮描边或 `NEW` 小字
- 新集且当前选中：保留现有 active 样式，再叠加一层新集提示

不建议首版只靠颜色变化，不够直观。至少应有以下之一：

- `NEW`
- `新`
- 明显描边

## 数据层方案

### 1. 新增 FollowRecord 存储

建议仿照现有 `favorites` 和 `skipconfigs` 方式，新增独立数据域：

- 前端缓存
- 本地存储
- 事件广播
- profile sync 接口

建议命名：

- 存储 key：`moontv_follows`
- 事件名：`followRecordsUpdated`
- API：`/api/follows`

### 2. 前端接口层

建议在 `src/lib/db.client.ts` 新增：

- `getAllFollowRecords()`
- `getFollowRecord(source, id)`
- `saveFollowRecord(source, id, record)`
- `deleteFollowRecord(source, id)`
- `isFollowing(source, id)`

并加入和现有 `favoritesUpdated` 相同风格的缓存刷新与事件派发机制。

### 3. 服务端接口层

建议仿照：

- `/api/favorites`
- `/api/skipconfigs`

新增：

- `GET /api/follows`
- `POST /api/follows`
- `DELETE /api/follows`

这样后续迁移到 Web 或启用桌面 profile sync 时，不需要重做协议。

## 刷新机制

### 1. 不依赖服务端 cron 作为首方案

项目里已有 `/api/cron` 批量刷新收藏和播放记录集数的思路，但它更偏服务端后台任务。

桌面版“追更”首版建议不要依赖它，原因如下：

- 桌面端需要用户可见、按需、低频的本地刷新行为。
- `cron` 更适合做全局兜底，不适合做首版的主状态源。
- 后续 Web 版未必有同样的触发条件。

### 2. 桌面版主刷新策略

建议新增一个桌面专用 bootstrap/poller 组件，挂在全局布局中。

触发时机建议：

- 应用启动后
- 窗口重新获得焦点时
- 页面从 `hidden` 变为 `visible` 时

节流策略建议：

- 只检查已开启追更的条目
- 只检查 `last_checked_at` 超过阈值的条目
- 阈值首版可取 30 分钟到 2 小时之间
- 并发数控制在 3 到 5

### 3. 刷新流程

对每个已追更条目：

1. 根据 `source + id` 拉取当前详情
2. 得到真实 `episodeCount`
3. 若 `episodeCount > latest_episode_count`
   则更新 `latest_episode_count`
4. 无论是否变更，都更新 `last_checked_at`
5. 若状态变更，则广播 `followRecordsUpdated`

## 页面接入建议

### 1. VideoCard

职责：

- 读取当前卡片是否已追更
- 决定右键菜单显示“开启追更”还是“取消追更”
- 根据 `FollowRecord` 决定是否显示 `NEW`

这样收藏页、继续观看、搜索结果页都能自动吃到同一套状态。

### 2. PlayPage

职责：

- 读取当前资源的 `FollowRecord`
- 计算新集区间并透传给 `EpisodeSelector`
- 在现有播放进度保存链路中推进 `acknowledged_episode_count`

建议复用当前已经存在的播放记录写入点，不额外发明新的“已观看”判定入口。

### 3. EpisodeSelector

职责：

- 接收新集区间参数
- 按集数判断当前按钮是否属于新集
- 渲染对应样式或文字标记

## 兼容与迁移考虑

为了后续迁移到 Web，建议从第一版开始就保持以下约束：

- 桌面专有逻辑只放在“检查触发器”这一层
- 数据结构保持通用
- API 协议保持通用
- `VideoCard` 和 `EpisodeSelector` 的 props 设计保持通用

这样后续 Web 版只需要替换：

- 刷新触发时机
- 是否启用轮询

而不需要改掉核心判定逻辑。

## 建议实施顺序

后续真正开始开发时，建议按以下顺序推进：

1. 定义 `FollowRecord` 类型与存储接口
2. 增加 `db.client` 的 follows 读写与事件机制
3. 增加 `/api/follows` 接口
4. 在 `VideoCard` 接入追更菜单和 `NEW` 卡片标记
5. 在 `PlayPage` 接入追更读取和已确认集数推进
6. 在 `EpisodeSelector` 接入新集按钮标识
7. 增加桌面版 bootstrap/poller 刷新器
8. 补测试，重点覆盖状态判定和集数推进逻辑

## 测试重点

后续实现阶段应重点覆盖：

- 开启追更时以真实详情集数建基线
- `latest_episode_count > acknowledged_episode_count` 时卡片显示 `NEW`
- 13/14 这种连续新集场景下，播放 13 后只剩 14 为新集
- 播放最新集后 `NEW` 自动消失
- 第三方源集数短暂回退时不误清 `NEW`
- focus / visibility 触发刷新时不会高频重复请求

## 当前结论

这个需求适合按“独立 FollowRecord + 卡片与播放页共享判定 + 桌面轮询刷新”的方式实现。

首版不改 Rust，不依赖系统通知，不强绑收藏，不做 Web 同步实现。先把数据模型、判定规则和共享 UI 协议定稳，后续再进入代码阶段。
