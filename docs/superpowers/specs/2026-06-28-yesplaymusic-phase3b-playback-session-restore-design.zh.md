# LunaTV 音乐系统 Phase 3b 播放现场恢复设计

**目标**

在当前 `/music` 重写线中补齐桌面优先的“播放现场恢复”能力：应用重启或页面重新挂载后，恢复上一条活动队列、当前曲目和播放进度，让用户回到离开前的收听上下文，而不是只看到零散的“继续收听”单曲。

**完整目标中的位置**

完整复刻仍然是 5 个子项目：

1. 应用壳层
2. 播放核心
3. 数据域
4. 账号能力
5. 桌面集成

Phase 1 已完成子项目 1 + 2 的基础骨架。  
Phase 2 已完成 `Netease` 实时数据纵切。  
Phase 3a 已补齐二维码账号登录主通路。  
本设计文档覆盖 **Phase 3b = 桌面播放现场恢复**，属于“播放核心”和“桌面集成”之间的闭环能力。

**为什么现在做**

当前新音乐系统已经具备：

1. 真实队列、真实歌词、真实 stream
2. 本地 `recent tracks` 与 `play records`
3. 桌面 tray、快捷键、媒体会话
4. 音乐偏好持久化

但仍缺 1 个很明显的产品缺口：

- 现在只能记住“某首歌播到哪里”，不能记住“上一轮正在播什么队列”

这会导致桌面版重启后体验断裂，不像一个可长期驻留的桌面播放器。

**范围**

- 新增“播放现场快照”独立数据模型
- 保存：
  - 当前队列
  - 当前曲目 `currentTrackId`
  - 当前进度 `positionMs`
  - 当前曲目时长 `durationMs`
  - `savedAt`
- 恢复时：
  - 重新装配队列
  - 点亮 mini player
  - 恢复当前曲目与进度
  - 默认进入 `paused`
  - 重新拉取当前曲目的 stream 与歌词
- 复用现有 profile route / 本地缓存模式

**不做**

- 不恢复 full player 打开态
- 不恢复 queue drawer / lyrics panel 展开态
- 不恢复自动外放
- 不把 `streamUrl` 写进持久化快照
- 不复用 `playRecords` 结构硬塞队列快照
- 不做跨设备冲突解决或多端同步策略

**现状结论**

当前已有 3 个可复用基础：

1. [MusicPlayerRoot](/Users/jay/Code/LunaTV/src/features/music/components/MusicPlayerRoot.tsx)
   - 已统一掌管 audio、歌词同步、桌面 tray 和本地播放记录写入
2. [music-profile](/Users/jay/Code/LunaTV/src/features/music/services/music-profile.ts)
   - 已有“本地缓存 + profile API”双层存储模式
3. [Music playback state](/Users/jay/Code/LunaTV/src/features/music/state/playback-store.ts)
   - 已有稳定的 `queue / currentTrackId / positionMs / durationMs`

结论：

- 当前缺的不是播放状态骨架，而是“播放状态快照”的持久化与恢复闭环

**核心方案**

1. 新增独立 `music-playback-session` 资料域，不污染 `playRecords`
2. 快照使用新的统一模型：
   - `queue`
   - `currentTrackId`
   - `positionMs`
   - `durationMs`
   - `savedAt`
3. 队列里的曲目仍复用 `MusicTrackEntity`，但持久化前强制清空 `stream`
4. 继续走“本地缓存 + `/api/music/profile/playback-session`”模式
5. 恢复逻辑放在 `MusicPlayerRoot`，因为它最接近 audio / seek / stream hydrate 生命周期

**为什么不用 play record 复用**

`playRecords` 的语义是“单曲续播记录”，而不是“活动播放现场”：

- `playRecords`
  - 单曲维度
  - 可用于“继续收听”
  - 不关心队列顺序
- `playback session`
  - 队列维度
  - 用于桌面冷启动恢复
  - 必须保留当前队列顺序与当前曲目

如果把两者混在一起，后续很难解释“清空继续收听”与“清空当前播放现场”的边界。

**新的数据模型**

建议新增：

```ts
interface MusicPlaybackSession {
  queue: QueueItemEntity[];
  currentTrackId: string | null;
  positionMs: number;
  durationMs: number;
  savedAt: number;
}
```

显式约束：

- `queue` 中每个 `track.stream` 持久化前必须清空
- `currentTrackId` 必须命中 `queue` 中某一项，否则整条快照视为无效
- `positionMs` 与 `durationMs` 必须是非负数
- 没有活动队列时，保存空快照而不是伪造默认曲目

**保存策略**

触发保存的时机只保留 3 类：

1. 队列或当前曲目变化后
2. `audio.pause`
3. `pagehide` / 桌面关闭前

原因：

- 不在 `timeupdate` 上高频写入，避免无意义 I/O
- 曲目切换时先存结构快照
- 暂停或退出时再把最新进度写实

**恢复策略**

恢复只在首次挂载且当前没有活动队列时执行：

1. 读取快照
2. 如果快照为空，直接跳过
3. 如果快照有效：
   - 写入 playback store
   - `playState` 强制设为 `paused`
   - 点亮 mini player
   - 等当前曲目 stream hydrate 完成后再 seek 到 `positionMs`
   - 同步拉取歌词

关键约束：

- 冷启动恢复后默认不自动播放，避免桌面应用启动即外放
- seek 必须发生在 stream 可用之后，不能把恢复进度提前写到空 audio 上

**存储边界**

新增：

- `GET /api/music/profile/playback-session`
- `POST /api/music/profile/playback-session`

行为：

- `GET`
  - 返回完整快照
- `POST`
  - 全量覆盖快照
  - 空快照视为“清空活动播放现场”

为什么不用 `DELETE`：

- 当前需求只需要“读”和“全量写”
- 发送空快照即可表达清空
- 可以少一类 route 和一类错误面

**错误处理**

- 读取快照失败：
  - 记录错误
  - 回退到空快照
  - 不阻断 `/music` 打开
- 写入快照失败：
  - 保留本地缓存
  - 允许后续覆盖重试
- 快照无效：
  - 丢弃整条快照
  - 不做半恢复
- 恢复后当前曲目拉 stream 失败：
  - 保留队列与当前曲目
  - 通过现有 `playbackStore.error` 暴露可恢复错误

**测试要求**

数据层：

- 无效快照会回退为空
- 队列快照会清空 `stream`
- 远端 profile route 能读写完整快照

播放器根节点：

- 冷启动时恢复队列、当前曲目和位置
- 恢复后默认 `paused`
- mini player 会重新出现
- 暂停和关闭前会写出最新快照
- 当前已有活动队列时，不允许异步恢复覆盖用户现场

UI 回归：

- 现有点播、切歌、歌词、tray、`continue listening` 不得回归

**验收标准**

- 桌面重启后 `/music` 能恢复上一条活动队列
- 当前曲目和进度能恢复到用户离开前的位置
- 恢复后不会自动播出声音
- 持久化快照不含 `streamUrl`
- 现有 `play records` 继续只负责“继续收听”，不承担队列恢复职责
