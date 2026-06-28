# LunaTV 音乐系统 Phase 4a 桌面下载 / 离线缓存设计

**目标**

在当前 `/music` 重写线上补齐桌面优先的“手动下载 + 本地优先播放”闭环：用户可以下载单曲或一整张合集到应用托管目录，应用重启后仍能识别已下载资源，并在播放时优先使用本地文件。

**完整目标中的位置**

完整复刻仍然按 5 个子项目推进：

1. 应用壳层
2. 播放核心
3. 数据域
4. 账号能力
5. 桌面集成

Phase 1 已完成壳层和播放骨架。
Phase 2 已完成 `Netease` 实时数据纵切。
Phase 3a 已补齐二维码账号登录。
Phase 3b 已补齐播放现场恢复。
本设计文档覆盖 **Phase 4a = 桌面下载 / 离线缓存 MVP**，属于“播放核心”和“桌面集成”之间的下一条桌面闭环能力。

**为什么现在做**

当前新音乐系统已经具备：

1. 实时首页、搜索、合集、歌词、FM、日推
2. 本地资料库、收藏、继续收听
3. 桌面偏好持久化、tray、快捷键、现场恢复

但桌面版仍缺一个明显能力：

- 用户离线时无法继续播放已经“明确想留下”的歌曲

这会让桌面版仍像“在线网页壳”，不像一个可常驻的桌面播放器。

**范围**

- 支持单曲手动下载
- 支持合集页“一键下载全部”
- 下载文件统一写入应用托管目录
- 本地持久化下载记录、状态、进度和文件路径
- 播放时优先使用本地文件
- 本地文件不可用时回退远端 `streamUrl`
- 非桌面环境显式提示当前能力仅桌面可用

**不做**

- 不做用户自选下载目录
- 不做自动缓存最近播放
- 不做断点续传
- 不做配额、淘汰策略或磁盘清理策略
- 不做歌词离线存储
- 不做跨设备同步下载记录
- 不做通用“离线模式”总开关

**现状结论**

当前已有 4 个可复用基础：

1. [MusicPlayerRoot](/Users/jay/Code/LunaTV/src/features/music/components/MusicPlayerRoot.tsx)
   - 已统一掌管 audio、stream hydrate、歌词和桌面集成
2. [MusicCollectionView](/Users/jay/Code/LunaTV/src/features/music/components/MusicCollectionView.tsx)
   - 已具备合集级动作入口
3. [MusicFullPlayer](/Users/jay/Code/LunaTV/src/features/music/components/MusicFullPlayer.tsx)
   - 已具备单曲级动作入口
4. [tauri-client](/Users/jay/Code/LunaTV/src/lib/desktop/tauri-client.ts) + [src-tauri/lib.rs](/Users/jay/Code/LunaTV/src-tauri/src/lib.rs)
   - 已有成熟 IPC、应用数据目录和文件下载写入模式

结论：

- 当前缺的不是 UI 骨架，而是“下载记录 + 本地文件 + 播放优先级”的闭环

**核心方案**

1. 新增独立 `music-download` 资料域，不污染 `playRecords`、`preferences`、`playbackSession`
2. 桌面端由 Tauri 负责：
   - 解析应用数据目录
   - 下载音频文件
   - 维护 `music-downloads.json`
   - 返回本地文件路径
3. 前端新增下载 store，负责：
   - hydrate 已有下载记录
   - 维护批量下载中的 UI 状态
   - 暴露“当前曲目是否已下载”
4. 播放器新增“本地优先解析”：
   - 先查本地下载记录
   - 命中文件后用 Tauri `asset` URL 播放
   - 否则按现有远端 `track` API 拉取 `streamUrl`
5. 批量下载不做独立 Rust 队列系统：
   - 前端按顺序触发单曲下载
   - 每首曲目各自持久化状态

**为什么不直接复用视频下载系统**

现有 `src/lib/download/*` 是面向 `m3u8` / 分片 / 资源索引的离线视频体系：

- 数据模型围绕 `manifest / segment / key / map`
- 运行时围绕浏览器缓存和本地下载运行时
- 目标对象是“剧集 / 资源索引”，不是“单首音频文件”

音乐 MVP 只需要：

- 一个远端音频 URL
- 一个本地文件
- 一份简洁记录

直接复用视频下载系统会把复杂度提前引入，不符合 KISS / YAGNI。

**新的数据模型**

建议新增：

```ts
interface MusicDownloadRecord {
  downloadId: string;
  track: MusicTrackEntity;
  quality: MusicPlaybackQuality;
  status: 'idle' | 'downloading' | 'downloaded' | 'failed';
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number;
  localFilePath: string | null;
  errorMessage: string | null;
  downloadedAt: number | null;
  updatedAt: number;
}
```

显式约束：

- `downloadId = ${source}:${trackId}:${quality}`
- `track.stream` 不写入持久化记录
- `localFilePath` 只在 `downloaded` 状态下可信
- 启动时把残留的 `downloading` 状态归一化为 `failed`
- 本地文件缺失时，记录保留但状态回退为 `failed`

**目录结构**

建议写入：

```text
<app-data-dir>/
  music/
    downloads/
      records.json
      audio/
        netease-9001-high-7f2a8f9c.audio
```

原因：

- 和桌面其他本地状态一起归属应用数据目录
- 便于后续加清理能力
- 避免把路径选择、权限和跨平台差异提前带入 MVP

**前端边界**

新增前端服务层能力：

- `hydrateMusicDownloads()`
- `downloadMusicTrack()`
- `downloadMusicCollectionTracks()`
- `removeMusicDownload()`
- `resolveDownloadedMusicTrackPlaybackUrl()`

新增 store 只维护：

- 下载记录 map
- hydrate 状态
- 当前批量下载 busy 状态

不把真正文件 I/O 放到前端。

**Tauri IPC 边界**

建议新增命令：

- `list_music_downloads`
- `download_music_track`
- `delete_music_download`
- `resolve_music_download_playback`

行为：

- `list_music_downloads`
  - 返回当前所有下载记录
- `download_music_track`
  - 接收曲目快照、质量和远端下载 URL
  - 边下载边写入记录
  - 完成后返回最终记录
- `delete_music_download`
  - 删除本地文件和记录
- `resolve_music_download_playback`
  - 检查目标文件是否存在
  - 存在则返回文件路径
  - 不存在则同步修正记录并返回空

**播放器集成**

`MusicPlayerRoot` 的加载顺序调整为：

1. 读取当前曲目
2. 先尝试解析本地下载文件
3. 若命中：
   - 转成 Tauri `asset` URL
   - 写回当前 `track.stream`
   - 继续现有 audio / seek / session 流程
4. 若未命中：
   - 继续走现有 `fetchMusicTrackPlayback`
5. 歌词仍按现有 API 拉取，不做本地缓存

关键约束：

- 本地文件优先只影响音频流，不影响歌词和元数据来源
- 本地解析失败不能阻断在线播放回退

**UI 入口**

第一刀只补 3 处：

1. `MusicCollectionView`
   - 新增 `Download all`
   - 每行新增 `Download` / `Downloaded`
2. `MusicFullPlayer`
   - 新增当前曲目 `Download` / `Delete download`
3. `MusicLibraryView`
   - 新增 `Offline downloads` 分区，给出可直接播放的已下载曲目

设置页可只展示下载数量，不做目录管理。

**错误处理**

- 下载请求失败：
  - 记录 `failed`
  - 保留错误文案
  - 不影响当前页面继续使用
- 本地文件删除失败：
  - 保留记录并暴露错误
- 解析本地文件失败：
  - 回退远端 stream
  - 同步修正本地记录状态
- 非桌面环境触发下载：
  - 直接返回“仅桌面版可用”

**测试要求**

前端服务 / store：

- 记录归一化时清空 `stream`
- 浏览器预览环境会拒绝桌面下载
- 批量下载会逐首落记录

Tauri：

- 创建应用托管目录
- 下载成功后写入文件和 `records.json`
- 文件缺失时回退 `failed`
- 删除下载会删除文件和记录

播放器：

- 已下载曲目优先使用本地文件播放
- 本地文件不存在时回退远端 `streamUrl`

UI：

- 合集页、全屏播放器、资料库能看到下载动作
- 已下载状态文案不会回退

**验收标准**

- 桌面版可下载单曲并在重启后识别已下载状态
- 合集页可触发批量下载
- 已下载曲目播放时优先使用本地文件
- 本地文件丢失时仍可在线播放
- 下载文件统一落在应用托管目录
- 第一刀不引入自定义目录、自动缓存和断点续传
