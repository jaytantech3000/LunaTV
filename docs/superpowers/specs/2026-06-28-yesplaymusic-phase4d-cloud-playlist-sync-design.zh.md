# LunaTV 音乐系统 Phase 4d 云端歌单联动设计

**目标**

在当前 `/music` 重写线上补齐“账号已登录，但歌单收藏仍然只是本地 pin”的断层：当用户已连接网易云账号时，`playlist` 类型合集上的 `Save to library` 动作改为网易云歌单收藏 / 取消收藏，`My playlists` 与资料库歌单区同步刷新；未登录时继续保留当前本地保存歌单兜底。

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
Phase 4c 已完成最近播放同步。
本设计文档覆盖 **Phase 4d = 云端歌单联动**，属于“账号能力”和“资料库语义”之间下一条更接近 YesPlayMusic 的闭环。

**为什么现在做**

当前新音乐系统已经具备：

1. 实时首页、搜索、合集、歌词、日推、私人 FM
2. 二维码登录、我的歌单、喜欢歌曲同步、最近播放同步
3. 播放现场恢复、桌面下载、本地优先播放

但资料库与账号歌单之间仍有一个明显断层：

- 左侧 `My playlists` 已经来自网易云账号
- 歌单详情页上的 `Save to library` 仍然只写本地 `savedCollections`
- 资料库里的 `Saved collections` 仍会把远端歌单和本地榜单 / 专辑 pin 混在一起

这会导致：

- 已登录状态下，“收藏歌单”不会真正回写账号
- `My playlists` 与 `Saved collections` 发生语义重叠
- 当前行为更像“本地钉住歌单”，不像 YesPlayMusic 的“歌单进入我的音乐库”

**范围**

- 已登录网易云账号时：
  - `playlist` 类型合集上的保存动作改为远端收藏 / 取消收藏
  - 收藏歌单成功后，`My playlists` 立即刷新
  - 资料库新增账号感知的 `My playlists` 区块
  - 本地 `savedCollections` 在登录态下只保留非 `playlist` 项
- 未登录时：
  - `playlist` 仍可继续走当前本地 `Save to library`
- `rank / album / artist-toplist` 继续保持本地保存语义
- 已登录且当前歌单本来就是用户自建歌单时：
  - 不允许走“取消收藏本歌单导致它从自己列表里消失”的危险路径
  - UI 只展示只读态

**不做**

- 不做歌单新建、重命名、删除
- 不做歌单内曲目增删 / 排序
- 不做歌单封面、描述、标签、隐私设置编辑
- 不做批量收藏 / 批量取消收藏歌单
- 不做多音源歌单库抽象，第一刀只覆盖 `Netease`

**现状结论**

当前已有 5 个可复用基础：

1. [MusicAccountStore](/Users/jay/Code/LunaTV/src/features/music/state/music-account-store.ts)
   - 已具备账号态和 `playlists`
2. [MusicCollectionView](/Users/jay/Code/LunaTV/src/features/music/components/MusicCollectionView.tsx)
   - 已有合集级 `Save to library` 动作位
3. [music-library-store](/Users/jay/Code/LunaTV/src/features/music/state/music-library-store.ts)
   - 已统一掌管 `savedCollections / favoriteTracks / recentTracks / resumeTracks`
4. [MusicSidebar](/Users/jay/Code/LunaTV/src/features/music/components/MusicSidebar.tsx)
   - 已具备 `My playlists` 展示区
5. [Netease repository](/Users/jay/Code/LunaTV/src/features/music/services/providers/netease/repository.ts)
   - 已具备账号态、喜欢歌曲、最近播放、我的歌单真实会话链路

结论：

- 当前缺的不是“歌单展示”，而是“歌单进入账号音乐库”的真实来源和写回链路

**为什么不继续复用本地 savedCollections**

当前本地 `savedCollections` 的语义是：

- 当前浏览器 / 当前桌面 profile 下的本地 pin
- 不依赖第三方音乐账号
- 适合 `rank / album / artist-toplist` 这类“浏览入口型合集”

网易云歌单收藏的语义是：

- 第三方账号下的远端状态
- 需要登录态
- 会影响用户真实“我的歌单”列表

如果继续把登录态歌单收藏也写进 `savedCollections`，会让：

- source of truth（真实来源）继续混脏
- `Saved collections` 与 `My playlists` 重复
- 退出账号后难以明确哪些歌单是本地 pin，哪些是远端订阅

所以第一刀应像 Phase 4b / 4c 一样，新增独立远端服务层，再让 store 决定当前动作走远端还是本地。

**核心方案**

1. 给账号歌单 summary 增加最小角色信息：
   - `accountPlaylistRole?: 'owned' | 'subscribed'`
2. 在 provider 层新增歌单收藏 contract：
   - `setPlaylistSubscribed`
3. 在 Next route 层新增歌单收藏 mutation route：
   - `/api/music/account/playlists/subscriptions`
4. 前端新增独立 `music-account-playlists` 服务层
5. `music-account-store` 负责刷新账号歌单列表
6. `music-library-store.toggleSavedCollection()` 在“登录 + playlist”条件下改为委托账号歌单收藏，而不是写本地 `savedCollections`
7. `MusicLibraryView` 增加账号 `My playlists` 区块，`Saved collections` 只承载本地 pin 语义

**领域边界**

建议在 [entities.ts](/Users/jay/Code/LunaTV/src/features/music/domain/entities.ts) 的 `MusicCollectionSummaryEntity` 上新增：

```ts
accountPlaylistRole?: 'owned' | 'subscribed';
```

约束：

- 只在 `kind === 'playlist'` 时有意义
- `owned`
  - 表示当前账号自己创建的歌单
- `subscribed`
  - 表示当前账号收藏的他人歌单
- 其他合集类型保持 `undefined`

这样可以让 UI 在不引入第二套账号歌单模型的前提下区分：

- “这是我的自建歌单”
- “这是我收藏的歌单”
- “这只是普通合集 summary”

**Provider 边界**

建议在 [repositories.ts](/Users/jay/Code/LunaTV/src/features/music/domain/repositories.ts) 的 `MusicAccountRepository` 下新增：

```ts
setPlaylistSubscribed(
  source: LiveMusicSourceKey,
  playlistId: string,
  subscribed: boolean,
  options?: { sessionCookie?: string | null }
): Promise<MusicCollectionSummaryEntity[]>;
```

`Netease` 侧实现建议：

1. 先校验当前音乐账号 session
2. 调用远端歌单收藏 / 取消收藏接口
3. 动作成功后重新读取当前账号歌单列表
4. 返回刷新后的 `MusicCollectionSummaryEntity[]`

角色映射规则：

- `creator.userId === account.profile.userId`
  - 映射为 `owned`
- 其他歌单
  - 映射为 `subscribed`

原因：

- 这样前端不需要额外拼“当前歌单是否在我的列表里”
- mutation 成功后可以像 liked songs / recent plays 一样直接接收完整刷新列表
- 后续若做歌单 CRUD，也能继续复用这条歌单列表 source of truth

**Route 边界**

建议新增：

```text
/api/music/account/playlists/subscriptions?source=netease
```

行为：

- `POST`
  - body: `{ playlistId: string }`
  - 表示收藏歌单
- `DELETE`
  - body: `{ playlistId: string }`
  - 表示取消收藏歌单

约束：

- 所有响应都 `no-store`
- 没有有效音乐账号会话时返回 `401`
- 返回值为“刷新后的账号歌单列表”
- route 不读写本地 `savedCollections`

本切片不额外新增歌单列表 GET route，因为现有 [account route](/Users/jay/Code/LunaTV/src/app/api/music/account/route.ts) 已承担初次 hydrate 的账号歌单读取。

**Store 边界**

[music-account-store](/Users/jay/Code/LunaTV/src/features/music/state/music-account-store.ts) 新增：

- `togglePlaylistSubscription(playlistId, subscribed)`

行为：

1. 已登录时调用前端歌单收藏服务
2. 成功后只刷新 `account.playlists`
3. 失败时保留现有 `account.playlists`
4. 不影响 `favoriteTracks / recentTracks / resumeTracks`

[music-library-store](/Users/jay/Code/LunaTV/src/features/music/state/music-library-store.ts) 调整为：

1. `hydrateLibrary()`
   - 继续读本地 `savedCollections`
   - 但在登录态下过滤掉 `playlist` 项，只保留本地非歌单 pin
2. `toggleSavedCollection(summary)`
   - 已登录且 `summary.kind === 'playlist'` 时：
     - 改走账号歌单收藏 / 取消收藏
   - 其他情况：
     - 继续走当前本地保存逻辑
3. `clearSavedCollections()`
   - 继续只清本地 pin
   - 不影响远端 `My playlists`

**UI 语义调整**

第一刀只调整 5 处：

1. [MusicCollectionView](/Users/jay/Code/LunaTV/src/features/music/components/MusicCollectionView.tsx)
   - 已登录 + `playlist`：
     - 非账号歌单：`Collect playlist`
     - 已收藏歌单：`Collected`
     - 自建歌单：`In your playlists`
   - 未登录或非 `playlist`：
     - 继续沿用 `Save to library`
2. [MusicLibraryView](/Users/jay/Code/LunaTV/src/features/music/components/MusicLibraryView.tsx)
   - 已登录时新增 `My playlists` 区块
   - `Saved collections` 的 empty-state 改成强调“本地 pin 的榜单 / 专辑 / 艺人合集”
3. [MusicSidebar](/Users/jay/Code/LunaTV/src/features/music/components/MusicSidebar.tsx)
   - `My playlists` 区块继续保留，但收藏歌单后数量与列表立即刷新
4. [MusicTopBar](/Users/jay/Code/LunaTV/src/features/music/components/MusicTopBar.tsx)
   - 资料库摘要文案切成账号感知，可包含 playlist 数量
5. [MusicSettingsView](/Users/jay/Code/LunaTV/src/features/music/components/MusicSettingsView.tsx)
   - 不新增新页面，不加“清空远端歌单”动作

**本地歌单 pin 的保留策略**

本地 `savedCollections` 第一刀不删除旧数据：

- 未登录时，`playlist` 仍可继续本地保存
- 登录后，本地 `playlist` 项从当前视图中过滤，不自动上传也不自动删除
- 退出登录后，本地 `playlist` pin 会再次出现

这能避免：

- 把本地历史误写到用户真实账号
- 用户退出账号后资料库突然丢掉本地歌单入口
- 一次性引入“本地 pin 迁移到云端”的额外复杂度

**错误处理**

- 未登录却请求远端歌单收藏：
  - 返回 `401`
  - UI 维持当前状态
- 远端歌单收藏 / 取消收藏失败：
  - 保留当前 `account.playlists`
  - 保留当前 `savedCollections`
  - 暴露错误文案
- 当前歌单是账号自建歌单：
  - UI 不提供 destructive（破坏性）取消入口
- 远端返回空歌单列表：
  - 视为合法空态，不视为损坏

**测试要求**

Provider / route：

- 可收藏歌单并返回刷新后的账号歌单列表
- 可取消收藏歌单并返回刷新后的账号歌单列表
- 账号歌单 summary 能标出 `owned / subscribed`
- 无 session 时 route 返回 `401`

Store：

- 登录态下 `toggleSavedCollection(playlist)` 走远端分支
- 登录态下 `savedCollections` 过滤本地 playlist 项
- 未登录时 `toggleSavedCollection(playlist)` 继续走本地分支
- `clearSavedCollections()` 不影响远端账号歌单

UI：

- 已登录歌单页展示 `Collect playlist / Collected / In your playlists`
- 收藏 / 取消收藏后 sidebar 的 `My playlists` 数量即时刷新
- 已登录资料库出现 `My playlists` 区块
- 退出登录后恢复本地 playlist save 语义

**验收标准**

以下条件同时满足，才算 Phase 4d 完成：

1. 已登录时，对 `playlist` 类型合集点击保存会真正影响网易云账号歌单库
2. 收藏 / 取消收藏成功后，`My playlists` 区块立即刷新
3. 已登录资料库中，远端账号歌单不再和本地 `Saved collections` 混在一起
4. `rank / album / artist-toplist` 仍保持本地保存语义
5. 未登录时，歌单保存仍可走本地兜底
6. 自建歌单不会暴露危险的取消收藏入口
7. route / store / UI 回归测试通过
