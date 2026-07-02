# LunaTV 旧版音乐模块硬删除与重建准备设计

**目标**

在当前 `desktop` 工作树中，彻底删除现有旧版音乐模块的代码、路由、IPC、配置开关和测试资产，让桌面版回到“当前没有音乐模块”的干净状态；仅保留与音乐无关的桌面壳、窗口、sidecar、更新与视频能力，为后续基于 `Rust + TypeScript + Tauri` 的新音乐中心重建腾出边界。

**已确认决策**

1. 合入目标态不保留占位页，不保留 `music-legacy` 参考区，也不保留长寿命 `410` / `LEGACY_MUSIC_DISABLED` 兼容层
2. 删除 `src/app/music/page.tsx`，`/music` 暂时回到未实现状态，访问时由应用默认 `404` / `not-found` 处理；未来新音乐中心上线时再重新占用该路径
3. 删除 `src/app/api/music/**`，旧音乐 HTTP 接口不再继续暴露
4. 删除 `src/features/music/**`，旧音乐前端实现不迁入任何 `legacy` 目录
5. 删除旧音乐 Tauri IPC、tray 菜单、桌面下载能力和前端 desktop bridge，而不是改造成“禁用但保留”
6. 保留桌面窗口、sidecar、本地服务、自动更新、鉴权、视频/直播/下载等非音乐能力
7. 历史音乐用户数据、本地音频文件和下载记录默认不自动清除；本阶段先断开代码读写引用，后续如需清盘再单独出数据清理方案
8. 本次 spec 只负责删除旧音乐模块，不定义任何新音乐模块目录、接口、路由、命名空间或重建任务

**范围**

- 删除旧音乐路由、页面、组件、状态、服务、测试与 API 目录
- 删除根布局中的旧音乐全局挂载和所有主导航音乐入口
- 删除旧音乐桌面 IPC、tray 和下载桥接
- 删除 `crates/moontv-local-service/src/music_api.rs`、旧 `/media/audio/stream` 代理链路，以及它们在 local-service 中的挂载
- 删除 `crates/moontv-local-service/src/profile_sync.rs`、`crates/moontv-local-service/src/profile_local.rs` 中所有旧音乐 profile 同步代理、本地 handler、payload 与校验逻辑
- 删除 `crates/moontv-profile/src/lib.rs` 中所有旧音乐 record schema、map type 与 `load/save/clear_music_*` 存储方法
- 删除共享层中的旧音乐类型、存储接口、profile 服务和配置投影
- 删除管理台与公开运行时中的 `EnableWebMusic` 活跃语义
- 保留所有非音乐桌面基础设施与现有视频主流程

**不做**

- 不在本阶段接入新的 YesPlayMusic UI、播放核心或音频互斥逻辑
- 不在本阶段预建新的 `src/features/music/**`、`src/desktop/modules/music/**` 或任何未来目录脚手架
- 不在本阶段迁移、转换或清空历史音乐数据
- 不在本阶段为旧音乐客户端保留兼容垫片、回退页或灰度开关
- 不在本阶段为未来新音乐中心预留实现文件、代理路由或占位 API

**现状耦合图**

当前旧音乐能力不是独立页面，而是分散在以下活跃区域：

- 路由与 UI 入口
  - `src/app/music/page.tsx`
  - `src/features/music/app/MusicPageShell`
  - `src/features/music/components/MusicPlayerRoot.tsx`
  - `src/components/Sidebar.tsx`
  - `src/components/MobileBottomNav.tsx`
  - `src/app/layout.tsx`
- HTTP 路由
  - `src/app/api/music/**` 下当前共有 20 个 route handler
- 共享运行时与配置
  - `src/lib/runtime/public-config.ts`
  - `src/lib/runtime-config.ts`
  - `src/lib/desktop/runtime-config.ts`
  - `src/lib/config.ts`
  - `src/lib/admin.types.ts`
  - `src/app/api/admin/site/route.ts`
  - `src/app/admin/page.tsx`
- 共享存储与 profile 服务
  - `crates/moontv-profile/src/lib.rs`
  - `src/lib/types.ts`
  - `src/lib/db.ts`
  - `src/lib/redis-base.db.ts`
  - `src/lib/upstash.db.ts`
  - `src/lib/core/profile/music-user-data-service.ts`
- 本地 HTTP 服务
  - `crates/moontv-local-service/src/lib.rs`
  - `crates/moontv-local-service/src/music_api.rs`
  - `crates/moontv-local-service/src/profile_sync.rs`
  - `crates/moontv-local-service/src/profile_local.rs`
  - 旧 `/api/music/*` 与 `/media/audio/stream` 聚合 / 代理链路
- 桌面桥接与 Tauri
  - `src/lib/desktop/tauri-client.ts`
  - `src-tauri/src/lib.rs`
  - `src-tauri/capabilities/default.json`
  - `src-tauri/gen/schemas/capabilities.json`
- 测试
  - `src/app/music/page.test.tsx`
  - `src/features/music/tests/**`
  - `src/lib/config.test.ts`
  - `src/lib/runtime/public-config.test.ts`
  - `src/lib/desktop/runtime-config.test.ts`
  - `src/components/Sidebar.test.tsx`
  - 以及所有引用 `EnableWebMusic`、`/api/music/*`、`MusicPlayerRoot`、`music-tray` 的测试

这意味着“只删 `/music` 页面”不是有效删除；必须同步拆掉共享层、桌面层和配置层中的旧音乐依赖。

**目标态**

路由与导航：

- 合入态不再存在 `src/app/music/page.tsx`
- `/music` 暂时不存在正式实现，访问时进入应用默认 `404` / `not-found`
- 侧边栏、移动底部导航和其他主入口不再出现“音乐”
- 根布局不再挂载 `MusicPlayerRoot`

HTTP 与配置：

- 合入态不再存在 `src/app/api/music/**`
- 不保留 `410` 兼容 handler；旧接口直接消失
- 管理台不再展示 `EnableWebMusic`
- `src/lib/runtime/public-config.ts` 不再对外投影 `ENABLE_WEB_MUSIC`，也不再读取 `NEXT_PUBLIC_ENABLE_WEB_MUSIC`
- `src/app/layout.tsx` 中桌面 runtime bootstrap script 不再合成 `ENABLE_WEB_MUSIC`
- `src/lib/runtime-config.ts`、`src/lib/desktop/runtime-config.ts` 不再定义 `ENABLE_WEB_MUSIC` / `enableWebMusic` 字段与 merge 逻辑
- `src/app/api/admin/site/route.ts`、`src/lib/config.ts`、`src/lib/admin.types.ts` 不再把 `EnableWebMusic` 当作活跃字段处理
- `crates/moontv-local-service/src/lib.rs` 中桌面本地配置 schema、默认值与归一化路径不再保留 `EnableWebMusic` / `enable_web_music` 字段，也不再通过 `DesktopSiteConfig`、`DesktopAdminConfig`、`default_enable_web_music`、`normalize_desktop_site_config` 或相关导入导出逻辑把该字段重新写回磁盘
- 历史配置文件中即使仍残留 `EnableWebMusic` 键，也只能在读路径被容忍；一旦配置被重写保存，该字段应从持久化对象中剥离，不能再影响运行时行为

桌面、本地服务与 Tauri：

- `src/lib/desktop/tauri-client.ts` 中不再保留任何旧音乐下载、tray 或播放路径桥接
- `crates/moontv-local-service/src/lib.rs` 中不再暴露任何旧音乐 `/api/music/*` 路由、`/media/audio/stream`、profile 同步入口或 `enableWebMusic` runtime/bootstrap payload
- `crates/moontv-local-service/src/lib.rs` 中不再保留 `enable_web_music` 字段、`mod music_api;`、`use music_api::{...}` 或 `get_music_audio_stream`
- `crates/moontv-local-service/src/profile_sync.rs` 与 `crates/moontv-local-service/src/profile_local.rs` 中不再保留 `proxy_profile_sync_music_*`、`handle_music_profile_*`、`validate_music_*`、`SaveMusic*Payload` 等旧音乐 profile 逻辑
- `crates/moontv-local-service/src/music_api.rs` 在合入态中已删除
- `src-tauri/src/lib.rs` 中不再保留旧音乐 tray 常量、菜单、事件、下载命令、`DesktopMusicDownload*` payload / status、`music_downloads_*` 路径辅助函数和 `MUSIC_DOWNLOADS_*` 常量
- 若仓库中不存在其他活跃 tray 使用点，`src-tauri/Cargo.toml` 不再保留 `tray-icon` feature，`src-tauri/capabilities/default.json` 不再通过 `core:default` 或显式 `core:tray:*` 暴露 tray 权限，`src-tauri/gen/schemas/capabilities.json` 与之保持一致；`src-tauri/gen/schemas/*-schema.json` 中的 tray 权限定义属于 Tauri 通用 schema，不作为“项目仍在使用 tray”的判据
- 桌面壳仍保留窗口、sidecar、本地服务、更新器和非音乐 IPC

共享类型与存储：

- `crates/moontv-profile/src/lib.rs` 中不再定义或导出 `MusicFavoriteRecord`、`MusicRecentTrackRecord`、`MusicPlayRecord`、`MusicFavoriteMap`、`MusicPlayRecordMap`、`MusicRecentTrackList`，也不再暴露 `load/save/clear_music_*` 方法
- 活跃共享层不再 import 任何旧音乐类型
- `IStorage`、`DbManager` 和各类存储驱动不再暴露音乐 CRUD
- `src/lib/core/profile/music-user-data-service.ts` 删除，不再保留旧音乐 profile 读写服务

数据语义：

- 旧音乐数据从“活跃数据”变为“不可达孤儿数据”
- 合入态不得再有任何代码读取、刷新、写入或迁移这些旧音乐数据

**硬删除策略**

本次删除以“最终合入态干净”为标准，而不是以“中间过渡态还能兼容”为标准。

1. 删除所有用户可见入口
2. 删除所有服务端和桌面端旧音乐能力
3. 删除所有共享层旧音乐类型与存储接口
4. 删除全部旧音乐实现与测试
5. 用 Git 历史作为唯一回滚来源，而不是把旧系统继续塞在工作树里

这套策略的关键是：

- 不建立 `music-legacy`
- 不抽离 `music-contracts`
- 不保留长期禁用壳
- 不保留未来需要再次拆掉的“临时占位层”
- Git 历史是未来重建时回看旧实现代码的唯一参考来源；项目文档可以作为历史过程记录保留，但活跃工作树中不保留任何额外 legacy 实现资产或休眠旧音乐实现文件

**删除阶段**

`Phase 1`：切断用户面与全局挂载

- 删除 `src/app/music/page.tsx`
- 删除 `src/features/music/components/MusicPlayerRoot.tsx` 在 `src/app/layout.tsx` 中的挂载
- 删除 `src/components/Sidebar.tsx` 与 `src/components/MobileBottomNav.tsx` 中的音乐入口
- 删除所有仍直接跳转 `/music` 的活跃 UI 逻辑

`Phase 2`：删除 HTTP、配置和管理台语义

- 删除 `src/app/api/music/**`
- 删除 `src/app/admin/page.tsx` 中的 `EnableWebMusic` UI、状态和提交逻辑
- 删除 `src/app/api/admin/site/route.ts` 中的 `EnableWebMusic` 读写与校验
- 删除 `src/lib/runtime/public-config.ts` 中的 `ENABLE_WEB_MUSIC` 投影逻辑，以及 `NEXT_PUBLIC_ENABLE_WEB_MUSIC` 旧环境变量读取
- 删除 `src/app/layout.tsx` 中 runtime bootstrap script 对 `ENABLE_WEB_MUSIC` 的合成
- 删除 `src/lib/runtime-config.ts` 中 `ENABLE_WEB_MUSIC` 运行时字段
- 删除 `src/lib/desktop/runtime-config.ts` 中 `enableWebMusic` payload 和 `ENABLE_WEB_MUSIC` merge 逻辑
- 删除 `src/lib/config.ts`、`src/lib/admin.types.ts` 以及相关测试中对 `EnableWebMusic` 的活跃定义；`src/lib/config.ts` 中的 `configSelfCheck()`（或等价 Web 侧 `AdminConfig` sanitizer）不得再为该字段补默认值，并且必须在 `src/app/api/admin/profile-sync/merge/route.ts`、`src/app/api/admin/data_migration/import/route.ts` 以及其他通过 `db.saveAdminConfig()` 持久化 `AdminConfig` 的 Web 写路径上，把历史 `EnableWebMusic` 从 `SiteConfig` 持久化对象中剥离
- 显式审计仓库根 `config.example.json`，确认默认配置文件本身不再包含旧音乐字段；`src/lib/runtime/config-source.ts` 中的 `readBundledDefaultConfigFile()` 与 `src-tauri/src/lib.rs` 中的 `DEFAULT_DESKTOP_CONFIG` 默认配置入口不得重新引入或回填 `EnableWebMusic` / `enable_web_music`
- 删除 `crates/moontv-local-service/src/lib.rs` 中 `DesktopSiteConfig` / `DesktopAdminConfig` 里的 `EnableWebMusic` / `enable_web_music` 配置字段、`default_enable_web_music` 默认值逻辑，以及 `normalize_desktop_site_config`、默认配置构造、配置导入导出和写盘路径里对该字段的保留
- 对历史配置残留值采取“读路径容忍、写路径剥离”的处理，任何配置保存或重写路径都不得再写回 `EnableWebMusic`

`Phase 3`：删除共享层旧音乐依赖

- 从 `crates/moontv-profile/src/lib.rs` 中删除以下旧音乐 schema 与存储能力：
  - `MusicFavoriteRecord`
  - `MusicRecentTrackRecord`
  - `MusicPlayRecord`
  - `MusicFavoriteMap`
  - `MusicPlayRecordMap`
  - `MusicRecentTrackList`
  - `MUSIC_FAVORITES_DOMAIN_KEY`
  - `MUSIC_RECENT_TRACKS_DOMAIN_KEY`
  - `MUSIC_PLAY_RECORDS_DOMAIN_KEY`
  - `load_music_*`
  - `save_music_*`
  - `clear_music_*`
- 删除 `src/lib/core/profile/music-user-data-service.ts`
- 从 `src/lib/types.ts` 的 `IStorage` 中移除全部音乐接口
- 从 `src/lib/db.ts` 中移除全部音乐方法
- 从 `src/lib/redis-base.db.ts`、`src/lib/upstash.db.ts` 以及其他存储实现中移除音乐数据读写
- 保留非音乐迁移逻辑，但移除 `migrateData()` 中所有 `u:*:music:*` 相关扫描、搬运或规范化分支，避免应用启动时继续触碰孤儿数据
- 清理所有共享层对 `@/features/music/**` 的 import

`Phase 4`：删除桌面桥接、本地服务与 Tauri 旧音乐能力

- 从 `src/lib/desktop/tauri-client.ts` 中删除以下旧音乐桥接：
  - `updateDesktopMusicTrayState`
  - `listenDesktopMusicTrayCommands`
  - `listDesktopMusicDownloads`
  - `downloadDesktopMusicTrack`
  - `deleteDesktopMusicDownload`
  - `resolveDesktopMusicDownloadPlayback`
- 从 `crates/moontv-local-service/src/lib.rs` 中删除以下旧音乐能力：
  - `/api/music/profile/favorites`
  - `/api/music/profile/recent-tracks`
  - `/api/music/profile/play-records`
  - `/api/music/sources`
  - `/api/music/home`
  - `/api/music/search`
  - `/api/music/collection`
  - `/api/music/track`
  - `/api/music/lyric`
  - `/media/audio/stream`
  - runtime public config 与 `/api/profile/bootstrap` 中的 `enableWebMusic` 投影
  - `RuntimePublicConfigResponse` 等结构中的 `enable_web_music`
  - `mod music_api;`、`use music_api::{...}` 与 `get_music_audio_stream`
  - 旧音乐 provider glue、DTO 和相关测试
- 删除 `crates/moontv-local-service/src/music_api.rs`
- 从 `crates/moontv-local-service/src/profile_sync.rs` 与 `crates/moontv-local-service/src/profile_local.rs` 中删除以下旧音乐能力：
  - `proxy_profile_sync_music_favorites`
  - `proxy_profile_sync_music_recent_tracks`
  - `proxy_profile_sync_music_play_records`
  - `handle_music_profile_favorites`
  - `handle_music_profile_recent_tracks`
  - `handle_music_profile_play_records`
  - `validate_music_*`
  - `validate_music_queue_identity`
  - `MUSIC_RECENT_TRACKS_LIMIT`
  - `SaveMusic*Payload` 及其他仅服务旧音乐 profile 的 payload / DTO
- 从 `src-tauri/src/lib.rs` 中删除以下旧音乐能力：
  - `MUSIC_TRAY_*` 常量
  - 旧音乐 tray 安装、菜单和事件分发逻辑
  - `update_music_tray_state`
  - `list_music_downloads`
  - `download_music_track`
  - `delete_music_download`
  - `resolve_music_download_playback`
  - `DesktopMusicDownloadStatus`
  - `DesktopMusicDownloadRecordPayload`
  - `DesktopMusicDownloadPlaybackPathPayload`
  - `build_music_download_id`
  - `music_downloads_dir`
  - `music_downloads_audio_dir`
  - `music_downloads_records_path`
  - `MUSIC_DOWNLOADS_DIR_NAME`
  - `MUSIC_DOWNLOADS_AUDIO_DIR_NAME`
  - `MUSIC_DOWNLOADS_RECORDS_FILE_NAME`
  - 其余所有 `music_download_*` 下载 helper、文件路径构造、记录修复/排序、测试辅助逻辑与实现细节
- 若仓库中不存在其他活跃 tray 使用点，则从 `src-tauri/Cargo.toml` 中移除 `tauri` 的 `tray-icon` feature，并同步收窄 `src-tauri/capabilities/default.json`：不得继续通过 `core:default` 或显式 `core:tray:*` 暴露 tray 权限；再刷新 `src-tauri/gen/schemas/capabilities.json` 等受影响生成产物。`src-tauri/gen/schemas/*-schema.json` 中的 tray 权限定义属于 Tauri 通用 schema，不作为“仍在使用 tray”的判据

`Phase 5`：删除旧模块源码与测试并做总清扫

- 删除 `src/features/music/**`
- 删除 `src/app/music/page.test.tsx`
- 删除 `src/features/music/tests/**`
- 更新 `src/lib/config.test.ts`、`src/lib/runtime/public-config.test.ts`、`src/lib/desktop/runtime-config.test.ts`、`src/components/Sidebar.test.tsx` 等仍引用旧音乐开关或旧入口的测试
- 删除或重写 `crates/moontv-local-service/src/lib.rs`、`profile_sync.rs`、`profile_local.rs` 中旧音乐本地服务、旧音频流、旧音乐 profile 与 runtime/bootstrap 断言测试
- 全仓 `rg` 扫描，确认活跃代码中不再残留 `EnableWebMusic`、`ENABLE_WEB_MUSIC`、`enableWebMusic`、`enable_web_music`、`/api/music`、`/media/audio/stream`、`MusicPlayerRoot`、`MUSIC_TRAY_`、`music-tray`、`music_tray`、`MusicTray`、`DesktopMusicTray`、`DesktopMusicTrack`、`open_music_from_tray`、`update_music_tray_state`、`delete_music_download`、`download_music_track`、`list_music_downloads`、`resolve_music_download_playback`、`music_download_`、`get_music_audio_stream`、`mod music_api`、`use music_api`、`proxy_profile_sync_music_`、`handle_music_profile_`、`validate_music_`、`validate_music_queue_identity`、`SaveMusic`、`MusicFavoriteRecord`、`MusicRecentTrackRecord`、`MusicPlayRecord`、`MusicPlaybackSession`、`MusicPreferences`、`SavedMusicCollectionRecord`、`MusicFavoriteMap`、`MusicPlayRecordMap`、`MusicRecentTrackList`、`DesktopMusicDownload`、`build_music_download_id`、`music_downloads_`、`music_download_record`、`MUSIC_DOWNLOADS_`、`MUSIC_FAVORITES_DOMAIN_KEY`、`MUSIC_RECENT_TRACKS_DOMAIN_KEY`、`MUSIC_PLAY_RECORDS_DOMAIN_KEY`、`MUSIC_RECENT_TRACKS_LIMIT`、`getMusic[A-Z]`、`saveMusic[A-Z]`、`setMusic[A-Z]`、`deleteMusic[A-Z]`、`clearMusic[A-Z]`、`load_music_`、`save_music_`、`clear_music_` 等旧音乐痕迹

**共享依赖拆除原则**

- 共享层必须直接删除旧音乐接口，而不是把旧音乐类型迁到新位置继续留在活跃代码里
- 这次删除不引入 `src/lib/music-contracts/**`
- 这次删除不为“将来可能要复用”保留额外抽象；未来新音乐中心需要的契约，到重建阶段再按新设计重新建立
- 删除完成后，活跃代码中不应再存在从非音乐模块指向旧音乐目录的 import

**桌面、本地服务与 Tauri 保留边界**

保留：

- `src-tauri/tauri.conf.json` 中现有窗口、构建命令和 sidecar 配置
- `src-tauri/src/main.rs` 与 `src-tauri/src/lib.rs` 中非音乐的桌面壳、本地服务、更新器、鉴权和窗口生命周期
- `crates/moontv-local-service/**` 中非音乐的本地 HTTP 服务、profile 同步、管理台和运行时 bootstrap 链路
- `src/lib/desktop/tauri-client.ts` 中非音乐的通用 IPC 外观层
- 视频、直播、下载、更新、登录与现有桌面布局

删除：

- 所有旧音乐 tray
- 所有旧音乐下载命令与记录管理
- 所有旧音乐播放路径解析
- 所有旧音乐 desktop 事件监听
- 所有旧音乐本地服务路由、旧音频流代理、旧音乐 profile 同步 / 本地 handler、bootstrap payload 字段、`music_api.rs` 源码与相关测试

**遗留数据策略**

本阶段默认不做用户数据物理删除，原因是代码删除与数据清盘属于两个不同风险面。

保留但断开引用的数据包括：

- 存储层中 `u:{user}:music:*` 命名空间下的历史 key
- Tauri 数据目录下历史 `music-downloads.json`
- 旧音乐下载目录中的本地音频文件

处理原则：

- 删除所有活跃读写代码
- 删除所有启动迁移中对旧音乐命名空间的触碰逻辑
- 不在本阶段自动清理、覆盖或迁移这些数据
- 在文档中明确它们已经变成孤儿数据
- 后续新音乐中心不得默认复用同名 `music` 命名空间，也不得默认复用这些遗留 Tauri 磁盘路径/文件名（如 `music` 下载目录、`audio` 子目录、`music-downloads.json`）；要么使用版本化命名空间 / 路径（如 `music-v2`），要么在复用前单独批准清理/迁移方案
- 如果未来要清理，必须单独出“数据备份/清理方案”并获得明确确认

**测试与 CI 影响**

- 旧音乐测试整体删除，不再以“禁用态”改写后继续留在默认 CI 中
- 所有引用 `EnableWebMusic` / `ENABLE_WEB_MUSIC` / `NEXT_PUBLIC_ENABLE_WEB_MUSIC` / `enableWebMusic` 的配置测试、桌面 runtime 刷新测试与导航测试需要同步收缩或重写
- Web 侧管理员配置写路径回归测试必须显式覆盖 `src/lib/config.test.ts`、`src/app/api/admin/profile-sync/merge/route.test.ts` 以及管理员配置导入链，断言历史 `EnableWebMusic` 输入经过 `configSelfCheck()`、profile-sync merge 或导入保存后，不会再出现在最终持久化的 `SiteConfig` 中
- 所有引用 `/api/music/*`、`/media/audio/stream`、`MusicPlayerRoot`、桌面音乐下载、tray、本地服务旧音乐路由、`enable_web_music`、`get_music_audio_stream`、`proxy_profile_sync_music_`、`handle_music_profile_` 与 `validate_music_` 的测试需要删除或重写
- 删除后至少应执行以下验证：
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test -- --runInBand` 或仓库当前等价测试命令
  - `pnpm desktop:check`
  - `pnpm desktop:test`
  - `pnpm desktop:build:frontend`
  - `rg -n "EnableWebMusic|ENABLE_WEB_MUSIC|NEXT_PUBLIC_ENABLE_WEB_MUSIC|enableWebMusic|enable_web_music|/api/music|/media/audio/stream|MusicPlayerRoot|MUSIC_TRAY_|music-tray|music_tray|MusicTray|DesktopMusicTray|DesktopMusicTrack|open_music_from_tray|update_music_tray_state|delete_music_download|download_music_track|list_music_downloads|resolve_music_download_playback|music_download_|get_music_audio_stream|mod music_api|use music_api|proxy_profile_sync_music_|handle_music_profile_|validate_music_|validate_music_queue_identity|SaveMusic|MusicFavoriteRecord|MusicRecentTrackRecord|MusicPlayRecord|MusicPlaybackSession|MusicPreferences|SavedMusicCollectionRecord|MusicFavoriteMap|MusicPlayRecordMap|MusicRecentTrackList|DesktopMusicDownload|build_music_download_id|music_downloads_|music_download_record|MUSIC_DOWNLOADS_|MUSIC_FAVORITES_DOMAIN_KEY|MUSIC_RECENT_TRACKS_DOMAIN_KEY|MUSIC_PLAY_RECORDS_DOMAIN_KEY|MUSIC_RECENT_TRACKS_LIMIT|u:\\*:music:\\*|u:\\{user\\}:music:\\*|getMusic[A-Z]|saveMusic[A-Z]|setMusic[A-Z]|deleteMusic[A-Z]|clearMusic[A-Z]|load_music_|save_music_|clear_music_" config.example.json src src-tauri crates desktop-shell-dist --glob '!**/*.md'`
  - `rg -n "/music" src --glob '!src/app/music/**' --glob '!src/app/api/music/**' --glob '!src/features/music/**' --glob '!**/*.test.*'`，确认活跃运行时代码中不再残留直跳 `/music` 的导航 / 跳转逻辑
  - `test ! -e desktop-shell-dist/music.html && test ! -e desktop-shell-dist/music.txt`，确认桌面导出产物中不再残留 `/music` 页面文件
  - `test ! -d desktop-shell-dist/_next/static/chunks/app/music`，确认桌面导出产物中不再残留 `/music` 路由 chunk 目录
  - 若仓库中没有其他活跃 tray 使用点，再执行 `rg -n "tray-icon" src-tauri/Cargo.toml` 与 `rg -n '"core:default"|core:tray:' src-tauri/capabilities/default.json src-tauri/gen/schemas/capabilities.json`，确认不再残留无主 tray feature / capability；不要把 `src-tauri/gen/schemas/*-schema.json` 中的 Tauri 通用 schema 条目当作失败信号

**回滚策略**

- 不在工作树中保留休眠旧音乐代码作为回滚手段
- 如需回滚，依赖 Git 历史、提交或临时分支恢复
- 这比维护一套永久失活但仍需跟随编译的 `legacy` 代码或 local-service 旧音乐实现文件更简单，也更符合 KISS / YAGNI

**验收标准**

1. `src/features/music/**`、`src/app/api/music/**`、`src/app/music/**`、`src/lib/core/profile/music-user-data-service.ts`、`crates/moontv-local-service/src/music_api.rs` 在合入态中已删除
2. `src/app/layout.tsx` 不再挂载 `MusicPlayerRoot`
3. 侧边栏、移动底部导航和其他主入口中不再出现音乐入口，且活跃 UI 代码中不再保留直跳 `/music` 的导航 / 跳转逻辑
4. `EnableWebMusic` / `ENABLE_WEB_MUSIC` / `NEXT_PUBLIC_ENABLE_WEB_MUSIC` / `enableWebMusic` / `enable_web_music` 不再出现在活跃运行时代码、桌面 runtime 刷新链路、管理台代码和公开配置投影中
   - 这也包括 `src/lib/config.ts` 中的 `configSelfCheck()`、`src/app/api/admin/profile-sync/merge/route.ts`、`src/app/api/admin/data_migration/import/route.ts` 以及其他 Web 侧 `AdminConfig` 保存链，不得再通过 `db.saveAdminConfig()` 把历史 `EnableWebMusic` 透传回持久化配置
   - 这也包括仓库根 `config.example.json`，以及 `src/lib/runtime/config-source.ts` / `src-tauri/src/lib.rs` 的 bundled default config 入口
   - 这也包括 `crates/moontv-local-service/src/lib.rs` 中桌面本地配置 schema、默认值和归一化/写盘路径
5. `src/lib/desktop/tauri-client.ts`、`crates/moontv-local-service/src/lib.rs`、`profile_sync.rs`、`profile_local.rs`、`crates/moontv-profile/src/lib.rs` 与 `src-tauri/src/lib.rs` 中不再存在旧音乐桥接、`/api/music/*` 本地服务、`/media/audio/stream`、runtime/bootstrap `enableWebMusic` 投影、`get_music_audio_stream`、`mod music_api`、`use music_api`、`proxy_profile_sync_music_*`、`handle_music_profile_*`、`validate_music_queue_identity`、`MUSIC_TRAY_*`、`music_tray*`、`MusicTray*`、`DesktopMusicTray*`、`DesktopMusicTrack*`、`DesktopMusicDownload*`、`build_music_download_id`、`delete_music_download`、`open_music_from_tray`、`music_download_*`、`music_downloads_*`、`music_download_record*`、`MUSIC_DOWNLOADS_*`、`MUSIC_*_DOMAIN_KEY`，以及旧音乐 tray、下载和播放路径 IPC，包括 `resolve_music_download_playback`
6. 若仓库中没有其他活跃 tray 使用点，`src-tauri/Cargo.toml` 不再保留仅服务旧音乐的 `tray-icon` feature，`src-tauri/capabilities/default.json` 不再通过 `core:default` 或显式 `core:tray:*` 暴露 tray 权限，且 `src-tauri/gen/schemas/capabilities.json` 已反映这一收窄；`src-tauri/gen/schemas/*-schema.json` 中的 Tauri 通用权限定义不作为失败判据
7. `crates/moontv-profile/src/lib.rs`、活跃共享层与存储实现不再定义、import 或暴露任何旧音乐 record schema、map type、profile helper 或音乐存储接口；启动迁移逻辑也不再扫描或搬运 `u:*:music:*`
8. 历史 `EnableWebMusic` 残留值在读路径上不会导致异常，但任何配置重写后都不会再被持久化；这同时覆盖 Web 侧 `configSelfCheck()` + `db.saveAdminConfig()` 链、管理员配置 merge / import 写路径，以及 Rust local-service 写盘路径
9. `config.example.json`、`src/**`、`src-tauri/**`、`crates/**` 与 `desktop-shell-dist/**` 中针对旧音乐关键字的扫描结果为空
10. `desktop-shell-dist/**` 已按当前源码重新生成；由于 Tauri `frontendDist` 指向该目录，合入态中不再保留旧音乐页面文件（如 `music.html`、`music.txt`）、`_next/static/chunks/app/music/**` 路由 chunk、旧音乐入口或 `ENABLE_WEB_MUSIC` 等桌面前端产物残留
11. 文档中的历史记录可保留，Git 历史仍是唯一代码回看来源；除文档外，不允许在活跃工作树中再保留额外 legacy 参考资产
12. `pnpm lint`、`pnpm typecheck`、`pnpm desktop:check`、`pnpm desktop:test`、`pnpm desktop:build:frontend` 和项目基线测试通过

**风险与缓解**

- 风险：共享层或本地服务中仍有隐藏 import / route，导致删目录后编译失败或旧音乐接口残留可达
  - 缓解：删除前后都使用 `rg` 全仓扫描，并优先从 `src/lib/**`、`src/components/**`、`src/app/**`、`src-tauri/**`、`crates/**` 做耦合清点
- 风险：非 `/api/music` 命名的旧音乐流代理或 Rust 蛇形字段漏出扫描，导致看似删除完成但 runtime 仍残留旧音乐能力
  - 缓解：验收扫描必须显式覆盖 `/media/audio/stream`、`enable_web_music`、`get_music_audio_stream`、`mod music_api` 与 `use music_api`
- 风险：旧音乐 profile 同步 / 本地处理逻辑藏在通用文件 `profile_sync.rs`、`profile_local.rs` 中，删路由后仍可能留下休眠实现
  - 缓解：Phase 4 与验收必须显式删除 `proxy_profile_sync_music_*`、`handle_music_profile_*`、`validate_music_*` 和相关 payload / DTO
- 风险：底层 profile crate 仍保留音乐 schema 与 `load/save/clear_music_*` 方法，导致旧音乐数据模型虽不再被路由引用但仍滞留在活跃代码
  - 缓解：Phase 3 与验收必须显式覆盖 `crates/moontv-profile/src/lib.rs` 中的音乐 record type、map type 与存储 helper 删除
- 风险：Tauri 下载命令虽然被删掉，但 `DesktopMusicDownload*` 类型、`music_download_*` / `music_downloads_*` / `music_download_record*` helper 或 `MUSIC_DOWNLOADS_*` 常量仍残留在活跃 Rust 代码
  - 缓解：Phase 4 与验收必须显式覆盖这些下载 helper / 常量的删除，并把相关关键字加入全仓扫描
- 风险：前端 `pnpm lint/typecheck/test` 全部通过，但 `src-tauri` 或 `crates/**` 因旧音乐删除导致编译 / 测试失败，形成“Web 绿、Desktop 红”的假完成
  - 缓解：删除后把 `pnpm desktop:check` 与 `pnpm desktop:test` 设为必跑验证，而不是只跑前端命令
- 风险：音乐 tray 逻辑被删掉，但 `src-tauri/Cargo.toml` 的 `tray-icon` feature 或 `src-tauri/gen/**` 生成产物仍保留无主 tray capability，导致桌面壳残留无用能力面
  - 缓解：若仓库中无其他 tray 消费者，Phase 4 与验收必须同步移除 `tray-icon` 并刷新受影响的 Tauri 生成产物
- 风险：即使删除了 `tray-icon` feature，`src-tauri/capabilities/default.json` 仍可能通过 `core:default` 间接授予 `core:tray:default`；反过来，`src-tauri/gen/schemas/*-schema.json` 又会天然包含 Tauri 通用 tray 权限定义，导致验收出现“假失败”或“假完成”
  - 缓解：tray 能力验收必须直接审计 `src-tauri/capabilities/default.json` 与 `src-tauri/gen/schemas/capabilities.json`，而不是把通用 schema 文件里的 `core:tray:*` 当成项目级能力残留
- 风险：历史配置或数据残留让人误以为旧音乐仍可恢复
  - 缓解：从管理台、公开运行时和导航层彻底移除旧音乐语义，并在文档中明确历史数据仅为孤儿数据
- 风险：公开运行时仍保留 `NEXT_PUBLIC_ENABLE_WEB_MUSIC` 环境变量读取，导致旧音乐开关语义通过 env 旁路继续生效
  - 缓解：Phase 2、验收与全仓扫描必须显式覆盖 `NEXT_PUBLIC_ENABLE_WEB_MUSIC`
- 风险：前端管理台和公开 runtime 已移除旧音乐开关，但 Rust local-service 的 `DesktopSiteConfig` / `DesktopAdminConfig`、默认值或归一化写盘路径仍保留 `EnableWebMusic` / `enable_web_music`，导致任意一次桌面配置保存都会把旧字段重新持久化
  - 缓解：Phase 2 与验收必须显式删除 `crates/moontv-local-service/src/lib.rs` 中该字段的 schema、默认值、normalize 逻辑和配置写盘保留路径，确保“读路径容忍、写路径剥离”在桌面本地配置链路也成立
- 风险：Web 侧管理员配置 merge / import 写路径把未知 `SiteConfig` 字段当作透传对象处理；如果只删除显式类型、UI 和公开投影，历史客户端或备份仍可能通过 `configSelfCheck()` -> `db.saveAdminConfig()` 把 `EnableWebMusic` 重新写回数据库
  - 缓解：Phase 2、测试验证与验收必须显式覆盖 `src/lib/config.ts` 的 `configSelfCheck()`、`src/app/api/admin/profile-sync/merge/route.ts`、`src/app/api/admin/data_migration/import/route.ts` 以及其他 `AdminConfig` 持久化链，确保旧字段在写路径被剥离而不是透传
- 风险：可见导航虽然已删除，但命令式跳转、快捷入口或其他运行时代码仍把用户送到 `/music`；如果这些逻辑藏在 `hooks`、`stores`、非音乐 `features` 或其他 `src/**` 目录里，会被窄范围扫描漏掉，形成“入口消失但死路仍在”的 404 残留体验
  - 缓解：Phase 1、测试验证与验收必须对整个活跃 `src/**` 执行 `/music` 跳转扫描，并排除已删除的 `src/app/music/**`、`src/app/api/music/**` 与 `src/features/music/**`
- 风险：旧 `music-downloads.json`、`music` 下载目录和 `audio` 子目录会继续留盘；如果未来新音乐中心默认复用这些路径，可能把孤儿数据误当成新模块状态，造成下载记录、缓存文件或本地播放源串味
  - 缓解：文档约束必须把“禁止默认复用”从 KV namespace 扩展到 Tauri 磁盘目录与记录文件名；未来若要复用，必须先单独批准清理 / 迁移方案
- 风险：源码已清干净，但 `desktop-shell-dist/**` 仍保留旧音乐导出产物；由于 Tauri `frontendDist` 直接指向该目录，最终桌面包仍可能带着 `/music` 页面或旧开关脚本
  - 缓解：把 `pnpm desktop:build:frontend` 设为必跑验证，并对 `desktop-shell-dist/**` 执行旧音乐关键字扫描，而不是仅扫描源码目录
- 风险：`desktop-shell-dist/**` 中即使不再命中旧音乐关键字，顶层静态导出页 `music.html` / `music.txt` 仍可能残留，导致桌面包继续携带 `/music` 路由壳
  - 缓解：验证与验收必须显式断言 `desktop-shell-dist/music.html` 与 `desktop-shell-dist/music.txt` 不存在
- 风险：顶层 `/music` 页面文件虽然消失，但 `desktop-shell-dist/_next/static/chunks/app/music/**` 路由 chunk 仍残留，导致桌面包继续携带旧音乐前端代码
  - 缓解：验证与验收必须显式断言 `desktop-shell-dist/_next/static/chunks/app/music` 目录不存在
- 风险：repo 根目录级扫描被 `.next*`、`target`、`node_modules` 等缓存或生成目录污染，导致验证噪声过大，无法准确判断是否仍有活跃旧音乐代码
  - 缓解：关键字扫描聚焦 `src/**`、`src-tauri/**`、`crates/**` 与 `desktop-shell-dist/**` 这些活跃源码 / 发包输入目录，而不是直接扫描整个仓库根目录
- 风险：仓库根 `config.example.json` 虽然不是源码目录，但它仍是 Web 与 Tauri 共用的默认配置输入；如果这条链路未纳入显式审计，旧音乐字段可能通过 bundled default config 在源码扫描通过后重新回流
  - 缓解：Phase 2、全仓扫描与验收必须把 `config.example.json` 以及 `src/lib/runtime/config-source.ts` / `src-tauri/src/lib.rs` 的默认配置入口纳入显式审计
- 风险：启动阶段的通用数据迁移仍继续扫描或搬运 `u:*:music:*`
  - 缓解：保留非音乐迁移逻辑，但显式删除所有 music 命名空间迁移分支
- 风险：未来重建时失去“可参考实现”
  - 缓解：参考来源放回 Git 历史，而不是继续让旧实现参与当前仓库编译与维护
- 风险：桌面下载目录或 JSON 记录长期滞留
  - 缓解：后续若需要清理，单独设计导出、备份和清除流程，不把数据删除夹带进本次代码删除
