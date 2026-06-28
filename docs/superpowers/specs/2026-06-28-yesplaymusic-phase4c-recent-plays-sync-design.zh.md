# LunaTV 音乐系统 Phase 4c 最近播放同步设计

**目标**

在当前 `/music` 重写线上补齐“账号已登录，但 `Recently played` 仍然完全是设备本地记录”的断层：当用户已连接网易云账号时，资料库中的 `recentTracks` 改为读取并刷新账号最近播放；未登录时继续保留当前本地最近播放兜底。`resumeTracks` 继续保持本地语义，不做远端化。

**完整目标中的位置**

完整复刻仍按 5 个子项目推进：

1. 应用壳层
2. 播放核心
3. 数据域
4. 账号能力
5. 桌面集成

Phase 1 已完成壳层和播放器骨架。
Phase 2 已完成 `Netease` 实时数据纵切。
Phase 3a 已完成二维码账号登录。
Phase 3b 已完成播放现场恢复。
Phase 4a 已完成桌面下载 / 本地优先播放。
Phase 4b 已完成喜欢歌曲同步。
本设计文档覆盖 **Phase 4c = 最近播放同步**，属于“账号能力”和“资料库语义”之间的下一条闭环。

**为什么现在做**

当前新音乐系统已经具备：

1. 实时首页、搜索、合集、歌词、日推、私人 FM
2. 二维码登录、个人歌单、喜欢歌曲同步
3. 播放现场恢复、桌面下载、本地优先播放

但资料库仍有一个明显缺口：

- `Liked songs` 已经跟随网易云账号
- `Recently played` 仍然完全是设备本地记录
- 已登录状态下，用户拿回了“喜欢什么”，但还没拿回“最近在听什么”

这会让账号音乐身份只恢复了一半。

**范围**

- 已登录网易云账号时：
  - `music-library-store.recentTracks` 改为读取远端最近播放
  - 播放新曲目时，上报最近播放并刷新资料库最近播放列表
  - 账号摘要 / 设置页对最近播放的文案改为账号感知
- 未登录时：
  - 继续沿用现有本地 `recentTracks`
- `resumeTracks` 保持本地语义
- 不删除、不迁移、不覆盖现有本地最近播放数据

**不做**

- 不做远端续播进度同步
- 不做周/月听歌排行、年度报告、统计图表
- 不做“清空网易云最近播放”这类破坏性账号动作
- 不做本地最近播放自动回填网易云历史迁移
- 不做多音源最近播放抽象，第一刀只覆盖 `Netease`

**现状结论**

当前已有 5 个可复用基础：

1. `MusicPlayerRoot`
   - 当前已在播放曲目切换时写本地最近播放
2. `music-library-store`
   - 已统一掌管 `favoriteTracks / recentTracks / resumeTracks`
3. `music-profile.ts`
   - 已稳定承接本地 recent / resume 持久化
4. `MusicAccountCard` 与 `MusicSettingsView`
   - 已具备账号态感知的文案与指标卡
5. Phase 4b liked-tracks 链路
   - 已验证 provider -> route -> service -> store -> UI 的账号感知闭环模式

结论：

- 当前缺的不是“最近播放 UI”，而是“账号最近播放”的真实来源和写回链路

**为什么不直接复用本地 recentTracks**

当前 `music-profile.ts` 下的 `recentTracks` 语义是：

- 当前浏览器 / 当前桌面 profile 下的本地历史
- 由本地播放行为驱动
- 可以被用户自由清空

网易云最近播放的语义是：

- 第三方账号下的远端状态
- 需要登录态
- 不应被本地“清空最近播放”直接破坏

把两者继续塞在同一套读写函数里，会让：

- source of truth（真实来源）变得模糊
- `resumeTracks` 与 `recentTracks` 的边界再次混脏
- 退出账号后难以切回本地最近播放

所以第一刀应像 Phase 4b 一样，新增独立服务层，再让 library store 决定当前走远端还是本地。

**核心方案**

1. 在 provider 层新增“最近播放” contract：
   - `getRecentTracks`
   - `reportTrackPlayed`
2. 在 Next route 层新增 `/api/music/account/recent-tracks`
   - 统一承接最近播放的读取与播放上报
3. 前端新增独立 `music-recent-tracks` 服务层
4. `music-library-store` 保持对 UI 的 `recentTracks` 外部接口不变，但内部改为账号感知
5. `MusicPlayerRoot` 不再直接写本地 recent service，而是委托 library store 根据账号态决定写远端还是本地

**Provider 边界**

建议在 `MusicAccountRepository` 下新增：

```ts
getRecentTracks(
  source: LiveMusicSourceKey,
  options?: { sessionCookie?: string | null }
): Promise<MusicTrackEntity[]>;

reportTrackPlayed(
  source: LiveMusicSourceKey,
  trackId: string,
  options?: { sessionCookie?: string | null }
): Promise<MusicTrackEntity[]>;
```

`Netease` 侧实现建议：

1. 读取当前账号最近播放列表
2. 将远端返回映射为 `MusicTrackEntity[]`
3. 曲目开始播放后调用最近播放上报接口
4. 上报成功后返回刷新后的最近播放列表，而不是只返回 `ok`

原因：

- 前端不需要二次请求拼状态
- PlayerRoot 不需要额外知道 provider 细节
- Store 可以像 Phase 4b 一样直接接收“刷新后的完整列表”

**Route 边界**

建议新增：

```text
/api/music/account/recent-tracks?source=netease
```

行为：

- `GET`
  - 返回当前登录账号的最近播放列表
- `POST`
  - body: `{ trackId: string }`
  - 表示上报该曲目的最近播放

约束：

- 所有响应都 `no-store`
- 没有有效音乐账号会话时返回 `401`
- route 不读写本地 `music-profile recentTracks`

**Store 与播放器边界**

`music-library-store` 对外仍保留：

- `recentTracks`
- `clearRecentTracks`
- `buildPlaybackQueue`

但内部切换为：

1. `hydrateLibrary()`
   - 继续读取本地 `savedCollections / favoriteTracks / resumeTracks`
   - 再根据 `musicAccount.authenticated` 决定 `recentTracks` 来源
2. 新增 `reportRecentTrack(track)`
   - 已登录时走远端 `reportTrackPlayed`
   - 未登录时沿用本地 `saveMusicRecentTrack`
3. 账号切换时：
   - 登录成功后重新 hydrate，切到远端最近播放
   - 退出登录后重新 hydrate，切回本地最近播放
4. `resumeTracks`
   - 始终继续读本地 play records
   - 不被最近播放同步逻辑覆盖

`MusicPlayerRoot` 调整为：

- 保持当前“播放曲目开始后记录 recent”的时机不变
- 但实际写入路径统一改走 `useMusicLibraryStore().reportRecentTrack(...)`

**时间戳与排序策略**

`MusicRecentTrackRecord` 继续复用现有结构：

```ts
interface MusicRecentTrackRecord {
  track: MusicTrackEntity;
  playedAt: number;
}
```

若远端接口直接返回可用的播放时间，则保留该时间。
若远端接口只稳定提供顺序、不稳定提供绝对时间，则第一刀允许在客户端按返回顺序合成 `playedAt`，目的只是保证：

- 资料库最近播放顺序稳定
- TopBar / AccountCard 计数正确
- 当前 UI 不需要真实到秒的历史时间展示

**UI 语义调整**

第一刀只调整 4 处：

1. `MusicAccountCard`
   - 已登录时详情文案改为 “Liked songs and recent plays sync with Netease...”
2. `MusicSettingsView`
   - 已登录时 `Recent plays` 指标卡保留数量显示，但去掉本地清空动作
3. `MusicTopBar`
   - settings / library 摘要继续显示 `recent` 数量，但来源按账号态切换
4. `MusicLibraryView`
   - 标题仍保持 `Recently played`
   - 只切换数据源，不新开页面

**本地最近播放的保留策略**

本地 `recentTracks` 数据第一刀不删除、不上传、不覆盖：

- 用户未登录时仍可继续使用
- 用户登录后改看远端最近播放
- 用户退出后恢复本地最近播放视图

这能避免：

- 远端账号数据被本地噪声污染
- 用户退出账号后资料库突然空掉
- 把 `resumeTracks` 和 `recentTracks` 再次混成一套

**错误处理**

- 未登录却请求远端最近播放：
  - 返回 `401`
  - store 回退本地 recent
- 远端最近播放读取失败：
  - 保留当前 `recentTracks`
  - 暴露错误文案
- 远端上报失败：
  - 不清空现有 `recentTracks`
  - 不阻断实际播放
  - 允许后续播放再次重试
- 远端返回空列表：
  - 正常视为空历史，不视为损坏

**测试要求**

Provider / route：

- 可读取当前账号最近播放列表
- 上报播放后返回刷新后的列表
- 无会话时返回 `401`

Service / store：

- 已登录时 `hydrateLibrary()` 读取远端 recent tracks
- 未登录时继续读取本地 recent tracks
- `reportRecentTrack()` 会按账号态切换远端 / 本地分支
- 远端失败时保留旧状态
- `resumeTracks` 不受最近播放同步影响

播放器 / UI：

- 播放曲目时已登录走远端最近播放上报
- 退出登录后最近播放恢复本地语义
- 设置页已登录时不再出现本地 `Clear recent plays`

**验收标准**

以下条件同时满足，才算 Phase 4c 完成：

1. 已登录时资料库 `recentTracks` 来自网易云最近播放
2. 已登录时播放新曲目会刷新远端最近播放列表
3. 未登录时继续沿用本地最近播放
4. `resumeTracks` 仍保持本地续播语义，不被覆盖
5. 设置页不会误导用户把“清空最近播放”当成可清空网易云历史
6. 定向测试、完整音乐回归、`pnpm typecheck` 全部通过
