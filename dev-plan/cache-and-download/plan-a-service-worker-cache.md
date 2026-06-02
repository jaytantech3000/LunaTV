# 方案 A：Service Worker + Cache Storage

> **推荐方案** · 中等难度 · 预估 2-3 周

## 背景

LunaTV 当前完全依赖实时 HLS 流（M3U8 + TS 分片），无离线能力。目标：支持整集完整下载（断网可播）+ 下一集自动预取，并提供下载管理页。

## 技术选型

| 层 | 技术 | 理由 |
|----|------|------|
| 缓存存储 | Cache Storage API | 专为大型网络资源设计，GB 级，读写快 |
| 请求拦截 | Service Worker | 透明拦截 HLS 请求，ArtPlayer/HLS.js 零改动 |
| 后台下载 | Fetch 分片队列（前台）+ Background Fetch（Chromium 增强） | 兼容所有浏览器 |
| 状态管理 | Zustand（项目已有） | 与现有 store 一致 |
| SW 集成 | next-pwa（项目已集成） | 复用 SW 注册入口 |

## 架构

```
ArtPlayer/HLS.js
      │ fetch 请求
      ▼
Service Worker (fetch intercept)
      │
      ├─ Cache Storage 命中 → 直接返回（离线播放）
      └─ 未命中 → 正常 fetch → 若已标记"待缓存"则写入
                                          ▲
                              DownloadManager (页面侧)
                              Zustand downloadStore
```

SW 只做拦截+命中响应，主动下载由页面侧 `DownloadManager` 驱动。

## 核心模块

### `src/lib/download/types.ts`
```typescript
interface DownloadTask {
  id: string                      // `${source}+${vodId}+${episodeIndex}`
  title: string
  episodeTitle: string
  episodeIndex: number
  m3u8Url: string
  status: 'queued' | 'downloading' | 'paused' | 'done' | 'error'
  progress: number                // 0-100
  totalSegments: number
  downloadedSegments: number
  sizeBytes: number
  createdAt: number
}

interface DownloadedContent {
  source: string
  id: string
  title: string
  poster: string
  episodes: { index: number; title: string; cachedM3u8Key: string; sizeBytes: number }[]
  totalSizeBytes: number
}
```

### `src/lib/download/manager.ts`
- `downloadEpisode(task)` — 解析 M3U8 → 并发 fetch 分片（并发数 3）→ 逐片写入 Cache Storage → 更新进度
- 先处理 `#EXT-X-KEY` 加密 key，再处理 TS 分片
- `pauseDownload / resumeDownload / cancelDownload`
- `getStorageUsage()` — `navigator.storage.estimate()`
- 超配额时按 LRU 清理旧内容

### `src/lib/download/prefetch.ts`
- 播放页监听 HLS.js 播放进度
- 进度 > 85% 时以低优先级触发下一集 `downloadEpisode()`
- 可在设置中开关

### `src/sw/cache-handler.ts`（扩展 next-pwa 自定义 SW）
```typescript
self.addEventListener('fetch', (event) => {
  if (isProxyRequest(event.request.url)) {
    event.respondWith(
      caches.match(event.request).then(cached => cached ?? fetch(event.request))
    )
  }
})
```

### `src/stores/downloadStore.ts`（Zustand）
```typescript
interface DownloadStore {
  tasks: DownloadTask[]
  contents: DownloadedContent[]
  storageQuotaBytes: number     // 默认 10GB，用户可配置
  storageUsedBytes: number
  prefetchEnabled: boolean
  addTask / updateTask / removeTask / loadContents / deleteContent
}
```

## 新增页面与组件

**`/downloads` 管理页**
- 下载中任务列表（进度条、暂停/取消）
- 已完成内容（封面、大小、播放/删除）
- 存储用量进度条（已用 / 配额）

**播放页改动**
- 集数选择器旁增加下载图标按钮
- 已下载显示勾选状态，下载中显示进度环

**侧边栏**
- `src/components/Sidebar.tsx` 增加"下载"导航项 → `/downloads`

## 实现顺序

**Week 1**
- [ ] 实现 `types.ts` + `downloadStore.ts`
- [ ] 实现 `manager.ts`（M3U8 解析 + 分片并发下载 + Cache Storage 写入）
- [ ] 扩展 next-pwa SW，添加 cache-first 拦截

**Week 2**
- [ ] 实现 `/downloads` 页面 UI
- [ ] 播放页下载按钮 + 状态指示
- [ ] 侧边栏导航入口
- [ ] 存储用量显示与超限清理

**Week 3**
- [ ] `prefetch.ts` 下一集自动预取
- [ ] 暂停/续传完整流程
- [ ] 设置页增加"存储上限"和"自动预取"开关
- [ ] 兼容性测试（Safari / Firefox / Chrome）

## 边界处理

| 场景 | 处理 |
|------|------|
| Safari Cache Storage 被系统清理 | 播放前校验缓存有效性，失效提示重新下载 |
| 存储超配额 | 下载前预检 `estimate()`，超限弹出清理建议 |
| M3U8 含 DRM | 检测到后提示"该内容不支持离线下载" |
| 多 Tab 并发 | BroadcastChannel 广播任务锁，避免重复下载 |
| 网络中断 | 监听 `navigator.onLine`，中断后自动暂停，恢复后提示续传 |
| M3U8 多级嵌套（master playlist） | 先解析选定画质分支，再解析分片列表 |

## 验证方式

1. DevTools → Application → Cache Storage：确认分片已存储
2. DevTools → Network → 离线模式：播放已下载内容无网络请求
3. 刷新页面后 `/downloads` 仍显示已下载内容
4. 存储用量数字与 `navigator.storage.estimate()` 一致
