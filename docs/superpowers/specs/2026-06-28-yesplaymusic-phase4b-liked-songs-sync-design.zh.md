# LunaTV 音乐系统 Phase 4b 喜欢歌曲同步设计

**目标**

在当前 `/music` 重写线上补齐“账号已登录，但喜欢歌曲仍是本地收藏”的断层：当用户已连接网易云账号时，`Saved tracks` / `Save` 这条链路改为读取并操作网易云“我喜欢的音乐”，未登录时继续保留本地收藏兜底。

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
本设计文档覆盖 **Phase 4b = 喜欢歌曲同步**，属于“账号能力”和“资料库语义”之间的下一条闭环。

**为什么现在做**

当前新音乐系统已经具备：

1. 实时首页、搜索、合集、歌词、日推、私人 FM
2. 二维码登录、个人歌单、资料库、本地继续收听
3. 播放现场恢复、桌面下载、本地优先播放

但账号体验仍有一个明显断层：

- 登录后可以看到个人歌单，却不能让“喜欢歌曲”跟随网易云账号
- `Saved tracks` 仍然是设备本地记录
- 账号卡片当前明确写着“Saved tracks ... stay on this device”

这会让“已登录”只像拿到了一张浏览通行证，而不是拿回自己的音乐身份。

**范围**

- 已登录网易云账号时：
  - 资料库的 `favoriteTracks` 改为读取网易云“我喜欢的音乐”
  - 全屏播放器的 `Save / Saved` 动作改为远端 `Like / Liked`
  - 资料库、账号卡片、顶部摘要、设置页的相关文案与数量改为账号感知
- 未登录时：
  - 继续沿用现有本地收藏
- 保留本地收藏数据，但不自动上传到网易云
- 喜欢 / 取消喜欢完成后，前端状态立即刷新

**不做**

- 不做“把本地收藏一键迁移到网易云”
- 不做批量喜欢 / 批量取消喜欢
- 不做歌单创建、编辑、删除
- 不做评论、MV、社交能力
- 不做多音源喜欢歌曲抽象，第一刀只覆盖 `Netease`

**现状结论**

当前已有 4 个可复用基础：

1. [MusicAccountCard](/Users/jay/Code/LunaTV/src/features/music/components/MusicAccountCard.tsx)
   - 已具备二维码登录、账号态展示、个人歌单入口
2. [music-library-store](/Users/jay/Code/LunaTV/src/features/music/state/music-library-store.ts)
   - 已统一掌管 `favoriteTracks / recentTracks / resumeTracks`
3. [MusicFullPlayer](/Users/jay/Code/LunaTV/src/features/music/components/MusicFullPlayer.tsx)
   - 已有单曲级 `Save / Saved` 入口
4. [Netease repository](/Users/jay/Code/LunaTV/src/features/music/services/providers/netease/repository.ts)
   - 已具备账号态、个人歌单、日推、FM 的真实会话链路

结论：

- 当前缺的不是账号壳层，而是“账号喜欢歌曲”的真实来源和操作链路

**核心方案**

1. 在 provider 层新增“喜欢歌曲” contract：
   - `getLikedTracks`
   - `setTrackLiked`
2. 在 Next route 层新增 `/api/music/account/likes`
   - 统一承接喜欢歌曲的读取、喜欢、取消喜欢
3. 前端新增独立 `music-liked-tracks` 服务层
   - 不把“远端喜欢歌曲”直接塞进 `music-profile.ts`
4. `music-library-store` 保持现有 `favoriteTracks` 外部接口不变，但内部改为账号感知：
   - 已登录：远端喜欢歌曲
   - 未登录：本地收藏
5. UI 保留现有播放器 / 资料库骨架，只调整文案、数据源和动作语义

**为什么不直接复用本地 favorites**

当前 [music-profile.ts](/Users/jay/Code/LunaTV/src/features/music/services/music-profile.ts) 的 `favorites` 语义是：

- 本地浏览器 / 本地桌面 profile
- 可选远端 profile sync
- 目标是“设备资料库”

网易云“我喜欢的音乐”的语义是：

- 第三方账号下的远端状态
- 需要登录态
- 会直接影响用户真实账号数据

把两者混在同一套读写函数里，会让：

- source of truth（真实来源）变得不清楚
- 退出账号后难以切回本地收藏
- 未来做“本地收藏”和“远端喜欢”并存时边界失真

所以第一刀应新增独立服务层，再让 library store 决定当前用哪条链路。

**Provider 边界**

建议在 [repositories.ts](/Users/jay/Code/LunaTV/src/features/music/domain/repositories.ts) 的 `MusicAccountRepository` 下新增：

```ts
getLikedTracks(
  source: LiveMusicSourceKey,
  options?: { sessionCookie?: string | null }
): Promise<MusicTrackEntity[]>;

setTrackLiked(
  source: LiveMusicSourceKey,
  trackId: string,
  liked: boolean,
  options?: { sessionCookie?: string | null }
): Promise<MusicTrackEntity[]>;
```

`Netease` 侧建议实现为：

1. 先读取当前账号资料与个人歌单
2. 找到“我喜欢的音乐”歌单
   - 首选 `specialType === 5`
   - 名称匹配只作为 fallback
3. 读取该歌单详情并映射为 `MusicTrackEntity[]`
4. 喜欢 / 取消喜欢时调用网易云对应接口
5. 动作成功后返回刷新后的喜欢歌曲列表，而不是只返回 `ok`

原因：

- 前端不需要做二次请求拼状态
- 当前 store 也不需要引入 optimistic update
- 失败回滚逻辑更简单

**Route 边界**

建议新增：

```text
/api/music/account/likes?source=netease
```

行为：

- `GET`
  - 返回当前登录账号的喜欢歌曲列表
- `POST`
  - body: `{ trackId: string }`
  - 表示喜欢该曲目
- `DELETE`
  - body: `{ trackId: string }`
  - 表示取消喜欢该曲目

约束：

- 所有响应都 `no-store`
- 没有有效音乐账号会话时返回 `401`
- route 不读写本地 `music-profile favorites`

**Store 与状态边界**

[music-library-store](/Users/jay/Code/LunaTV/src/features/music/state/music-library-store.ts) 保持对 UI 的接口基本不变：

- `favoriteTracks`
- `favoriteTrackKeys`
- `toggleFavoriteTrack`
- `isTrackFavorited`

但内部切换为：

1. `hydrateLibrary()`
   - 仍然读取本地 `savedCollections / recentTracks / resumeTracks`
   - 再根据 `musicAccount.authenticated` 决定 `favoriteTracks` 来源
2. `toggleFavoriteTrack(track)`
   - 已登录时走远端喜欢 / 取消喜欢
   - 未登录时走本地收藏
3. 账号切换时：
   - 登录成功后重新 hydrate，切到远端喜欢歌曲
   - 退出登录后重新 hydrate，切回本地收藏
4. 远端请求失败时：
   - 保留上一次 `favoriteTracks`
   - 暴露错误文案
   - 不清空现有列表

**UI 语义调整**

第一刀只调整现有 5 处：

1. [MusicFullPlayer](/Users/jay/Code/LunaTV/src/features/music/components/MusicFullPlayer.tsx)
   - 已登录时：
     - `Save track to library` -> `Like track`
     - `Saved` -> `Liked`
   - 未登录时沿用当前本地文案
2. [MusicLibraryView](/Users/jay/Code/LunaTV/src/features/music/components/MusicLibraryView.tsx)
   - 已登录时 `Saved tracks` -> `Liked songs`
3. [MusicAccountCard](/Users/jay/Code/LunaTV/src/features/music/components/MusicAccountCard.tsx)
   - 统计卡片 `Saved` -> `Liked`
   - 详情文案不再声称已登录用户的喜欢歌曲只保存在本机
4. [MusicTopBar](/Users/jay/Code/LunaTV/src/features/music/components/MusicTopBar.tsx)
   - 摘要文案切成账号感知
5. [MusicSettingsView](/Users/jay/Code/LunaTV/src/features/music/components/MusicSettingsView.tsx)
   - 指标卡在已登录时展示 `Liked songs`

**本地收藏的保留策略**

本地 `favorites` 数据第一刀不删除、不迁移、不覆盖：

- 用户未登录时仍可继续使用
- 用户登录后改看远端喜欢歌曲
- 用户退出后恢复本地收藏视图

这能避免：

- 自动上传误操作
- 远端账号污染
- 既有桌面数据突然丢失

**错误处理**

- 未登录却请求远端喜欢歌曲：
  - 返回 `401`
  - 前端回退本地收藏
- 远端喜欢 / 取消喜欢失败：
  - 保留当前喜欢列表
  - 暴露错误文案
- 喜欢歌单找不到：
  - 返回空列表，不抛“数据损坏”式致命错误
- 网易云接口返回业务失败：
  - 透传可读错误，不吞没

**测试要求**

Provider / route：

- 可读取当前账号喜欢歌曲
- 喜欢动作成功后返回刷新后的列表
- 取消喜欢成功后返回刷新后的列表
- 无会话时返回 `401`

Store：

- 已登录时 `hydrateLibrary()` 读取远端喜欢歌曲
- 未登录时继续读取本地收藏
- `toggleFavoriteTrack()` 会按账号态切换远端 / 本地分支
- 远端失败时保留旧状态

UI：

- 已登录时全屏播放器出现 `Like / Liked`
- 资料库显示 `Liked songs`
- 退出登录后恢复 `Saved tracks / Save / Saved`

**验收标准**

- 已登录网易云账号时，资料库喜欢歌曲来自账号远端状态，而不是本地 favorites
- 已登录时，播放器喜欢按钮会真实操作网易云喜欢歌曲
- 喜欢 / 取消喜欢后，资料库和按钮状态同步刷新
- 未登录时，本地收藏行为不回退
- 本地收藏不会被自动上传、删除或覆盖
