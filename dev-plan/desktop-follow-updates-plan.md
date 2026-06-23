# 桌面版“追更”功能方案

## 目标

先在桌面版实现“追更”能力，覆盖以下场景：

1. 视频卡片右键菜单新增“追更”入口。
2. 开启追更后，记录开启时间和当时已知的更新集数。
3. 有新集更新时，在视频卡片上显示 `NEW` 标记。
4. 播放页选集列表中，对新集按钮做明确标识。

当前阶段只完善方案，不进入代码实现。后续 Web 版应尽量复用同一套数据结构、判定规则和前端组件协议。

## 范围

首版只覆盖桌面版点播内容，且要求卡片具备稳定的 `source + id`。

不在首版范围内的内容：

- 豆瓣卡片
- 没有稳定主资源标识的聚合卡片
- 直播卡片
- 系统通知
- Web 版同步实现
- 专门的“追更管理页”

## 现状判断

当前项目中已有几块可以直接复用：

- 视频卡片右键入口已存在，入口位于 `src/components/VideoCard.tsx`。
- 播放页选集组件已独立，位于 `src/components/EpisodeSelector.tsx`。
- 播放进度保存链路已存在，位于 `src/app/play/page.tsx`。
- 收藏和播放记录已有统一的前端缓存、事件广播和 profile sync 适配层，位于 `src/lib/db.client.ts`。

同时也存在一个必须规避的问题：

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

### 3. 不建议持久化的派生字段

以下状态建议只在运行时计算，不直接落库：

- `has_new`
- `new_episode_start`
- `new_episode_end`
- `new_episode_count`

原因：

- 这些值都可以从 `acknowledged_episode_count` 和 `latest_episode_count` 推导得到。
- 派生值一旦持久化，后续很容易出现状态不同步。
- 保持底层记录最小化，后续迁移 Web 或补后台刷新时更稳。

### 4. TypeScript 草案

建议的数据结构先收敛到下面这个层级：

```ts
export interface FollowRecord {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  search_title?: string;
  followed_at: number;
  followed_episode_count: number;
  acknowledged_episode_count: number;
  latest_episode_count: number;
  last_checked_at: number;
}
```

首版先不引入额外状态位，例如：

- `status`
- `check_error`
- `last_growth_at`
- `muted`

这些字段都不是首版闭环所必需。只有在后续真的要做失败提示、静音追更、系统通知时，再单独评估是否加字段。

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

### 6. 播放确认的触发点

“已确认新集”不建议在用户点击集数按钮时立即推进。

建议触发条件：

- 用户已经真正切到该集
- 且播放链路开始保存该集的播放记录

也就是复用现有 `savePlayRecord` 附近的已落地行为，而不是把“点了按钮”视为“已经看过”。

这样可以避免几个误判：

- 用户误点一集但马上切回
- 用户只是预览切换，没有开始播放
- 换源时触发了集数切换，但用户并没有真正确认观看

### 7. 非连续更新的兼容

首版规则也要兼容这类情况：

- 追更时是 12 集
- 下一次检查直接变成 16 集

此时：

- `acknowledged_episode_count = 12`
- `latest_episode_count = 16`

运行时推导出来的新集区间就是：

- `13 ~ 16`

不需要额外为“跳更”做特殊字段。

### 8. 单集内容的处理

如果内容最终确认只有 1 集：

- 允许开启追更
- 但通常不会出现 `NEW`

这样做的原因是：

- 某些资源在首轮抓取时可能只有 1 集，后续会变成多集
- 允许先关注，后续一旦扩容仍可吃到同一套机制

如果后续产品上不想让用户对单集资源开启追更，可以只在 UI 层禁用，不建议在底层模型层做硬限制。

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

菜单交互建议：

- 点击“开启追更”时，如果正在拉取当前真实集数，菜单项进入短暂 loading 状态
- 开启成功后，下一次右键应立即显示“取消追更”
- 点击“取消追更”直接删除 `FollowRecord`，不保留软删除状态

文案建议：

- 开启：`开启追更`
- 关闭：`取消追更`
- 角标：`NEW`

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

补充建议：

- 新集标记尽量落在按钮内部右上角或角落，不要改动现有分页和布局
- 按钮宽度不足时，优先保留数字可读性，`NEW` 可以缩为 `新`
- 当前激活集如果也是新集，应优先保证“当前选中态”可读，不要被新集高亮压掉

### 3. 播放页辅助信息

首版不强制增加额外提示文案，但建议预留一个轻量展示位。

例如：

- 在播放页标题区显示 `更新到第 14 集`
- 或显示 `有 2 集未看`

这部分可以作为实现期的可选增强，不作为首版强依赖。

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

建议同时补一组与现有 `favorites` 一致的缓存快照读取接口，方便卡片首屏避免闪烁：

- `getCachedFollowRecordsSnapshot()`
- `getCachedFollowRecordSnapshot(source, id)` 或等价实现

### 2. 数据来源优先级

建议沿用现有用户数据体系的优先级：

1. 内存态/缓存快照
2. `localStorage`
3. profile sync API（如启用）

这样做的好处：

- 桌面版首屏可以立即读到 `NEW` 状态
- 不依赖网络才能知道是否正在追更
- 和当前收藏、播放记录的行为一致，降低心智差异

### 3. 前端接口层

建议在 `src/lib/db.client.ts` 新增：

- `getAllFollowRecords()`
- `getFollowRecord(source, id)`
- `saveFollowRecord(source, id, record)`
- `deleteFollowRecord(source, id)`
- `isFollowing(source, id)`

并加入和现有 `favoritesUpdated` 相同风格的缓存刷新与事件派发机制。

建议额外补两个纯计算 helper，减少 UI 层重复写判断：

- `computeFollowDerivedState(record)`
- `resolveNewEpisodeRange(record)`

建议输出内容至少包含：

- `hasNew`
- `newEpisodeStart`
- `newEpisodeEnd`
- `newEpisodeCount`

### 4. 服务端接口层

建议仿照：

- `/api/favorites`
- `/api/skipconfigs`

新增：

- `GET /api/follows`
- `POST /api/follows`
- `DELETE /api/follows`

这样后续迁移到 Web 或启用桌面 profile sync 时，不需要重做协议。

### 5. API 契约草案

建议契约尽量贴近现有 `favorites`：

`GET /api/follows`

- 不带 query：返回 `Record<string, FollowRecord>`
- 带 `?key=source+id`：返回 `FollowRecord | null`

`POST /api/follows`

- body: `{ key: string; follow: FollowRecord }`

`DELETE /api/follows`

- `?key=source+id`：删除单条
- 不带 `key`：首版不建议暴露“清空全部追更”入口，但底层是否支持可以后续再定

建议首版保持和现有收藏接口同样的错误处理风格：

- 缺参返回 `400`
- 未登录或 profile 不可用时透传现有用户数据错误
- 服务端只做最小字段校验，不在 API 层计算派生状态

### 6. 与 Favorite / PlayRecord 的关系

三者职责建议明确分开：

- `Favorite`
  负责“我收藏了什么”
- `PlayRecord`
  负责“我看到哪里了”
- `FollowRecord`
  负责“我要不要持续关注更新”

交互上可以互相借力，但不要互相承载对方的核心语义。

具体约束建议：

- 开启追更不强制自动收藏
- 取消收藏不强制自动取消追更
- 播放新集时可以推进 `FollowRecord`
- 收藏列表可以读取 `FollowRecord` 来显示 `NEW`

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

组件职责建议尽量窄：

- 负责挑出需要检查的追更记录
- 负责串联调用详情接口
- 负责在发现增量时写回 `FollowRecord`

不负责：

- 管理 UI loading
- 弹系统通知
- 直接修改收藏或播放记录

### 3. 刷新节流建议

建议引入两层节流：

1. 记录级节流
   同一个 `source+id` 在阈值时间内不重复检查
2. 会话级节流
   当前窗口一次 focus/visible 触发中，同一条记录只入队一次

这样可以避免：

- 用户频繁切窗口导致重复请求
- 页面内多个组件同时尝试刷新同一条追更记录

### 4. 失败降级建议

当详情刷新失败时：

- 不修改 `acknowledged_episode_count`
- 不修改 `latest_episode_count`
- 只在需要时更新一次内部失败日志或保留原 `last_checked_at`

首版不建议把失败态直接展示到卡片上，原因是：

- 失败大概率是短时网络或源波动
- 卡片长期挂错误提示会放大噪音

如需后续加失败态，建议单独引入新字段，不要在首版混入主链路。

### 5. 刷新流程

对每个已追更条目：

1. 根据 `source + id` 拉取当前详情
2. 得到真实 `episodeCount`
3. 若 `episodeCount > latest_episode_count`
   则更新 `latest_episode_count`
4. 无论是否变更，都更新 `last_checked_at`
5. 若状态变更，则广播 `followRecordsUpdated`

更细一层的推荐流程：

1. 读取当前追更快照列表
2. 过滤出点播内容和可校验的 `source+id`
3. 过滤掉未到检查阈值的记录
4. 用有限并发拉取详情
5. 比较 `episodeCount` 和 `latest_episode_count`
6. 如果发现增长，写回最新记录
7. 如果没有增长，只更新检查时间
8. 如果写回成功，广播数据变更事件

### 6. 是否需要手动刷新

首版可以不做显式“立即检查更新”按钮，但建议在方案层预留。

原因：

- 用户在某些资源页可能希望马上确认是否有新集
- 手动刷新未来可以直接复用同一套详情检查函数

如果后续要加，建议入口优先级：

1. 播放页
2. 收藏页卡片右键
3. 专门的追更管理页

## 状态流转

建议在实现前把状态流转固定下来，避免边做边改语义。

### 1. 开启追更

1. 用户在卡片菜单点击“开启追更”
2. 前端拉取当前详情
3. 取到真实 `episodeCount`
4. 写入一条新的 `FollowRecord`
5. 广播 `followRecordsUpdated`
6. 卡片立即切换为“已追更”态

### 2. 被动发现新集

1. 桌面刷新器挑中该记录
2. 拉取详情发现 `episodeCount` 增长
3. 更新 `latest_episode_count`
4. 广播 `followRecordsUpdated`
5. 卡片出现 `NEW`
6. 播放页选集列表进入新集高亮态

### 3. 用户开始播放新集

1. 用户切到某个新集
2. 播放记录进入保存链路
3. 根据当前集数推进 `acknowledged_episode_count`
4. 广播 `followRecordsUpdated`
5. 重新计算剩余未确认新集

### 4. 取消追更

1. 用户在卡片菜单点击“取消追更”
2. 删除对应 `FollowRecord`
3. 广播 `followRecordsUpdated`
4. 卡片 `NEW` 和已追更状态一并消失

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

### 4. Home / Favorites / ContinueWatching 的显示策略

这几个页面都可能渲染 `VideoCard`，但建议展示行为保持一致：

- 只要该卡片对应的 `FollowRecord.hasNew === true`，就显示 `NEW`
- 不因为卡片来自收藏、搜索或继续观看而改变判定规则

差异只保留在入口能力上：

- 收藏页、继续观看页、搜索结果页：允许右键开启追更
- 豆瓣卡片、无稳定主键卡片：隐藏追更入口

### 5. 播放页首次打开时的行为

当用户打开播放页时，如果当前资源已追更：

- 应立即读取追更状态并把新集区间传给 `EpisodeSelector`
- 不要求等桌面刷新器跑完才显示

这意味着播放页应优先使用本地快照，再等待后台刷新补正。

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

如果想进一步控制风险，可以拆成两个阶段：

### 阶段 A：先打通核心闭环

- `FollowRecord` 模型
- `db.client` follows 读写
- `/api/follows`
- `VideoCard` 右键追更
- 卡片 `NEW`
- `PlayPage` 推进 `acknowledged_episode_count`

这个阶段做完后，即使没有桌面自动刷新，也已经具备：

- 能开启追更
- 能保存追更状态
- 能通过手工或后续补入口去更新显示

### 阶段 B：再补桌面自动检查

- 全局 bootstrap/poller
- focus / visibility 触发
- 限流和并发控制
- 细化失败降级

这样开发过程更容易定位问题，出了问题也能先保住核心链路。

## 测试重点

后续实现阶段应重点覆盖：

- 开启追更时以真实详情集数建基线
- `latest_episode_count > acknowledged_episode_count` 时卡片显示 `NEW`
- 13/14 这种连续新集场景下，播放 13 后只剩 14 为新集
- 播放最新集后 `NEW` 自动消失
- 第三方源集数短暂回退时不误清 `NEW`
- focus / visibility 触发刷新时不会高频重复请求

建议把测试分三层：

### 1. 纯逻辑测试

覆盖对象：

- `computeFollowDerivedState`
- `resolveNewEpisodeRange`
- 播放确认推进逻辑

重点验证：

- 基线集数、最新集数、已确认集数的关系
- 13 -> 14 -> 16 这类非连续跳更
- 回退结果不误清 `NEW`

### 2. 数据层测试

覆盖对象：

- `db.client` 的 follows 缓存读写
- `followRecordsUpdated` 事件派发
- 本地模式与 profile sync 模式下的行为一致性

### 3. 组件接入测试

覆盖对象：

- `VideoCard`
- `EpisodeSelector`
- `PlayPage`

重点验证：

- 右键菜单文案切换
- `NEW` 角标显示/消失
- 选集按钮的新集标识
- 播放一集后新集范围收缩

## 验收口径

后续进入实现时，建议用下面这组口径判断是否算完成：

1. 用户能在桌面版点播卡片上开启和取消追更。
2. 开启追更时记录的是实时详情集数，而不是卡片历史快照。
3. 新集出现后，卡片能稳定显示 `NEW`。
4. 播放页选集列表能准确标出新集范围。
5. 用户开始播放某个新集后，未确认新集范围会自动收缩。
6. 窗口重新聚焦或恢复可见后，桌面版能按节流规则检查追更更新。
7. 第三方源短暂返回更少集数时，不会误清卡片 `NEW`。
8. 不开启追更的内容，不会产生额外详情刷新负担。

## 当前结论

这个需求适合按“独立 FollowRecord + 卡片与播放页共享判定 + 桌面轮询刷新”的方式实现。

首版不改 Rust，不依赖系统通知，不强绑收藏，不做 Web 同步实现。先把数据模型、判定规则和共享 UI 协议定稳，后续再进入代码阶段。
