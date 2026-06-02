# 方案 C：Background Fetch API + Service Worker（渐进增强）

> **最佳体验方案（Chromium）** · 高难度 · 预估 3-4 周

## 背景

在方案 A 基础上，对支持 Background Fetch API 的浏览器（Chrome 74+ / Edge 79+）使用原生后台下载——**关闭 Tab、锁屏后下载仍继续**，系统通知栏显示进度。不支持的浏览器（Safari、Firefox）自动降级到方案 A 的前台分片队列。

## 技术选型

| 层 | 技术 | 理由 |
|----|------|------|
| 后台下载（Chromium） | Background Fetch API | 原生系统级后台，关 Tab 继续下载 |
| 后台下载（降级） | Fetch 分片队列（方案 A） | 覆盖 Safari/Firefox |
| 缓存存储 | Cache Storage API | Background Fetch 完成后 SW 自动将响应存入 |
| 请求拦截 | Service Worker | 播放时透明命中缓存 |
| 进度通知 | Background Fetch 事件 + Web Notifications API | 系统级进度条 + 完成通知 |
| 状态管理 | Zustand（项目已有） | 与现有 store 一致 |

## Background Fetch 工作原理

```
页面调用 bgFetch.fetch(id, urls, options)
      │
      ▼
浏览器接管（独立于页面生命周期）
      │ 后台下载所有 URLs
      ▼
Service Worker 监听 backgroundfetchsuccess 事件
      │ 将所有响应写入 Cache Storage
      ▼
播放时 SW fetch 拦截 → Cache Storage 命中 → 离线播放
```

页面关闭/锁屏 → 下载不中断，系统通知栏显示 "LunaTV 正在下载..."

## 架构

```
┌─────────────────────────────────────────────────┐
│                     Browser                     │
│                                                 │
│  DownloadManager                                │
│      │                                          │
│      ├─ supportsBackgroundFetch?                │
│      │   ├─ YES → registration.backgroundFetch  │
│      │   │         .fetch(id, segmentUrls)      │
│      │   └─ NO  → 方案 A 前台分片队列            │
│      │                                          │
│  Service Worker                                 │
│      ├─ fetch event → cache-first（同方案 A）    │
│      ├─ backgroundfetchsuccess                  │
│      │   └─ cache.addAll(event.registration)   │
│      ├─ backgroundfetchfail → 标记任务失败        │
│      └─ backgroundfetchabort → 标记任务取消      │
│                                                 │
│  Cache Storage                                  │
│  Zustand downloadStore                          │
└─────────────────────────────────────────────────┘
```

## 核心模块

### `src/lib/download/bg-fetch-manager.ts`

```typescript
export async function startBackgroundFetch(task: DownloadTask): Promise<void> {
  const registration = await navigator.serviceWorker.ready
  const { segments, keys } = await parseM3u8(task.m3u8Url)
  const allUrls = [...keys.map(k => k.url), ...segments.map(s => s.url)]

  const bgFetch = await registration.backgroundFetch.fetch(
    task.id,
    allUrls,
    {
      title: `下载中：${task.title} ${task.episodeTitle}`,
      icons: [{ src: '/icons/download.png', sizes: '192x192' }],
      downloadTotal: estimateTotalBytes(segments.length),
    }
  )

  // 监听进度（页面存活时）
  bgFetch.addEventListener('progress', () => {
    const progress = bgFetch.downloaded / bgFetch.downloadTotal * 100
    downloadStore.getState().updateTask(task.id, { progress })
  })
}

export function supportsBackgroundFetch(): boolean {
  return 'serviceWorker' in navigator &&
    'BackgroundFetchManager' in (globalThis as unknown)
}
```

### `src/sw/bg-fetch-handler.ts`（Service Worker 扩展）

```typescript
// 下载成功：将所有响应存入 Cache Storage
self.addEventListener('backgroundfetchsuccess', (event: BackgroundFetchSuccessEvent) => {
  event.waitUntil((async () => {
    const cache = await caches.open('lunatv-offline-v1')
    const records = await event.registration.matchAll()
    await Promise.all(
      records.map(async (record) => {
        const response = await record.responseReady
        await cache.put(record.request, response)
      })
    )
    // 写入元数据，通知页面更新 UI
    await saveDownloadedMeta(event.registration.id)
    await self.registration.showNotification('下载完成', {
      body: `${event.registration.id} 已可离线观看`,
      icon: '/icons/check.png',
    })
  })())
})

// 下载失败
self.addEventListener('backgroundfetchfail', (event) => {
  event.waitUntil(markTaskFailed(event.registration.id))
})

// 用户在系统通知栏取消
self.addEventListener('backgroundfetchabort', (event) => {
  event.waitUntil(markTaskCancelled(event.registration.id))
})
```

### `src/lib/download/manager.ts`（统一入口）

```typescript
export async function downloadEpisode(task: DownloadTask): Promise<void> {
  if (supportsBackgroundFetch()) {
    await startBackgroundFetch(task)           // 方案 C 路径
  } else {
    await startForegroundDownload(task)        // 方案 A 路径（降级）
  }
}
```

### `src/lib/download/prefetch.ts`

同方案 A，进度 > 85% 时触发下一集下载，调用统一 `downloadEpisode()` 入口。

### `src/sw/cache-handler.ts`（fetch 拦截）

同方案 A，cache-first 策略拦截 `/api/proxy/*` 请求。

### `src/stores/downloadStore.ts`（Zustand）

在方案 A 基础上增加：
```typescript
interface DownloadStore {
  // ...方案 A 所有字段
  bgFetchRegistrations: Record<string, string>  // taskId → bgFetchId
  restoreFromBgFetch: () => Promise<void>       // 页面重启时恢复后台任务进度
}
```

## 新增页面与组件

**`/downloads` 管理页**：同方案 A，增加"后台下载中"状态标识（区分前台/后台）

**播放页**：同方案 A，下载按钮 + 状态指示

**侧边栏**：同方案 A，增加"下载"导航项

## 实现顺序

**Week 1**
- [ ] 实现 `types.ts` + `downloadStore.ts`
- [ ] 实现方案 A 的前台分片下载（作为降级路径，也是 MVP）
- [ ] 扩展 next-pwa SW，添加 cache-first 拦截

**Week 2**
- [ ] 实现 `bg-fetch-manager.ts`（Background Fetch 触发）
- [ ] 实现 SW 的 `backgroundfetchsuccess/fail/abort` 事件处理
- [ ] 实现 `manager.ts` 统一入口（能力检测 + 路径分发）

**Week 3**
- [ ] `/downloads` 管理页 UI（含前台/后台状态区分）
- [ ] 播放页下载按钮
- [ ] `restoreFromBgFetch()`：页面重启后从 SW 恢复后台任务状态
- [ ] Web Notifications 权限请求流程

**Week 4**
- [ ] 下一集预取（统一入口，无额外工作）
- [ ] 设置页配置项
- [ ] 端到端测试：关闭 Tab 后下载继续，通知弹出，重新打开页面状态恢复

## 浏览器兼容矩阵

| 浏览器 | Background Fetch | 路径 | 体验 |
|--------|-----------------|------|------|
| Chrome 74+ | ✅ | 方案 C 原生 | 最佳（关 Tab 继续）|
| Edge 79+ | ✅ | 方案 C 原生 | 最佳 |
| Firefox | ❌ | 方案 A 降级 | 良好（前台下载）|
| Safari 16.4+ | ❌（SW 有限支持） | 方案 A 降级 | 一般（系统可清理缓存）|
| iOS Safari | ❌ | 方案 A 降级 | 受限 |

## 边界处理

| 场景 | 处理 |
|------|------|
| Background Fetch 不支持 | `supportsBackgroundFetch()` 检测，自动降级方案 A |
| 用户未授予通知权限 | 不影响下载本身，仅无法弹出完成通知 |
| 页面关闭期间下载完成 | SW `backgroundfetchsuccess` 处理写入缓存，重新打开页面后 `restoreFromBgFetch()` 恢复状态 |
| Background Fetch 被系统中止（省电模式） | `backgroundfetchabort` 捕获，标记任务失败，提示用户重新下载 |
| 多 Tab 并发同一任务 | Background Fetch ID 全局唯一，第二个 Tab `fetch()` 调用返回已存在的 registration |
| 存储超配额 | 同方案 A |

## 与方案 A 的核心差异

| 维度 | 方案 A | 方案 C |
|------|--------|--------|
| 关 Tab 后下载 | ❌ 中断 | ✅ 继续（Chromium）|
| 系统通知栏进度 | ❌ | ✅（Chromium）|
| 实现复杂度 | 中 | 高（SW 事件链 + 状态恢复）|
| 调试难度 | 中 | 高（SW 后台调试困难）|
| Firefox/Safari | 与方案 A 相同 | 自动降级到方案 A |

## 验证方式

1. Chrome DevTools → Application → Background Fetch：确认任务注册
2. 下载中关闭 Tab → 重新打开页面：任务状态正确恢复（进度或完成）
3. 系统通知栏显示下载进度和完成通知
4. Firefox / Safari：自动降级到前台下载，功能正常
5. DevTools → Network → 离线模式：已下载内容正常播放
