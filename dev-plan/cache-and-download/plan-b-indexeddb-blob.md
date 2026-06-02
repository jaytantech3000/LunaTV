# 方案 B：IndexedDB + Blob URL 播放

> **高可控方案** · 高难度 · 预估 4-6 周

## 背景

不依赖 Service Worker 拦截，完全在应用层控制数据流：将 HLS 分片下载后以 `ArrayBuffer` 存入 IndexedDB，播放时从 DB 取出数据，通过 `MediaSource Extensions (MSE)` 构造本地可播放流，注入 HLS.js。

## 技术选型

| 层 | 技术 | 理由 |
|----|------|------|
| 持久存储 | IndexedDB（via `idb` 库） | 全浏览器支持，数据持久可靠，事务安全 |
| 播放注入 | MediaSource Extensions (MSE) | 浏览器原生支持，可替代网络流喂给 HLS.js |
| M3U8 解析 | 自定义解析器 | 需要路径重写、key 替换，第三方库不完全适配 |
| 状态管理 | Zustand（项目已有） | 与现有 store 一致 |
| 下载引擎 | Fetch + 并发队列 | 可精确控制每片存取 |

## 架构

```
下载阶段：
  DownloadManager
      │ fetch M3U8 → 解析分片列表 → 并发 fetch TS + key
      ▼
  IndexedDB（idb）
      ├── segments store: { key: segUrl, data: ArrayBuffer }
      ├── keys store:     { key: keyUrl, data: ArrayBuffer }
      └── meta store:     { DownloadedContent 元数据 }

播放阶段：
  LocalPlayer（新组件）
      │ 从 IndexedDB 读取分片 ArrayBuffer
      ▼
  MediaSource + SourceBuffer
      │ appendBuffer()
      ▼
  ArtPlayer（src = objectURL of MediaSource）
```

## 核心模块

### `src/lib/download/types.ts`
```typescript
interface SegmentRecord {
  segmentUrl: string            // 原始 URL 作为 key
  data: ArrayBuffer
  contentId: string             // 关联内容
  episodeIndex: number
  order: number                 // 分片顺序
}

interface DownloadedEpisode {
  index: number
  title: string
  segmentCount: number
  keyUrls: string[]             // 加密 key URL 列表
  m3u8Text: string              // 重写后的本地 M3U8 文本
  sizeBytes: number
}
```

### `src/lib/download/idb-store.ts`
使用 `idb` 库封装三个 ObjectStore：
- `segments`：key=`${contentId}/${episodeIndex}/${order}`，value=`ArrayBuffer`
- `encryption-keys`：key=原始 keyUrl，value=`ArrayBuffer`
- `content-meta`：key=`${source}+${id}`，value=`DownloadedContent`

```typescript
const db = await openDB('lunatv-cache', 1, {
  upgrade(db) {
    db.createObjectStore('segments')
    db.createObjectStore('encryption-keys')
    db.createObjectStore('content-meta')
  }
})
```

### `src/lib/download/m3u8-parser.ts`
自定义 M3U8 解析器：
- 解析 `#EXTINF` + URI 行，提取分片 URL 顺序列表
- 解析 `#EXT-X-KEY` 提取加密 key URI 和 IV
- 解析 `#EXT-X-STREAM-INF`（master playlist）选画质分支
- 输出重写后的"本地 M3U8"文本（分片 URI 替换为 IDB 内部引用格式）

### `src/lib/download/manager.ts`
```typescript
async function downloadEpisode(task: DownloadTask) {
  // 1. fetch M3U8 文本
  const m3u8Text = await fetchM3u8(task.m3u8Url)
  // 2. 解析分片和 key 列表
  const { segments, keys } = parseM3u8(m3u8Text)
  // 3. 并发下载 key（先于分片）
  await downloadKeys(keys, task.id)
  // 4. 并发下载分片（并发数 3），每片写入 IDB，更新进度
  await downloadSegments(segments, task, concurrency=3)
  // 5. 写入元数据
  await saveMeta(task)
}
```

### `src/components/LocalPlayer.tsx`（新组件）
替代网络流播放，用于播放已下载内容：

```typescript
// 核心：从 IDB 读取分片，通过 MSE 喂给 ArtPlayer
const mediaSource = new MediaSource()
artPlayer.option.url = URL.createObjectURL(mediaSource)

mediaSource.addEventListener('sourceopen', async () => {
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t')
  for (const segment of segments) {
    const data = await idb.get('segments', segment.key)
    await appendBufferAsync(sourceBuffer, data)
  }
  mediaSource.endOfStream()
})
```

**注意**：浏览器对 `video/mp2t` 的 MSE 支持不稳定，需要通过 HLS.js 的 `fLoader`（自定义 loader）注入 IDB 数据，让 HLS.js 负责转码+追加 SourceBuffer，兼容性更好。

### `src/stores/downloadStore.ts`（Zustand）
同方案 A，结构一致，实现层换为 IDB 操作。

## 新增页面与组件

**`/downloads` 管理页**：同方案 A

**播放页改动**：
- 检测当前内容是否已下载（查 IDB meta store）
- 已下载 → 渲染 `<LocalPlayer>`（MSE 模式）
- 未下载 → 正常 `<ArtPlayer>`（网络流模式）
- 播放页增加下载按钮

**侧边栏**：增加"下载"导航项

## 实现顺序

**Week 1-2（基础层）**
- [ ] 实现 `idb-store.ts`（三个 ObjectStore 封装）
- [ ] 实现 `m3u8-parser.ts`（含 master playlist、加密 key 支持）
- [ ] 实现 `manager.ts` 下载引擎（并发分片 + 进度回调）
- [ ] 实现 `downloadStore.ts`（Zustand）

**Week 3-4（播放层）**
- [ ] 实现 `LocalPlayer.tsx`（HLS.js 自定义 fLoader 注入 IDB 数据）
- [ ] 播放页离线/在线模式切换逻辑
- [ ] 播放页下载按钮 + 状态指示

**Week 5-6（管理层 + 收尾）**
- [ ] `/downloads` 管理页 UI
- [ ] 下一集预取（复用 manager.ts）
- [ ] 存储用量统计（IDB 数据累加）
- [ ] 设置页配置项
- [ ] 跨浏览器兼容测试

## 边界处理

| 场景 | 处理 |
|------|------|
| MSE + `video/mp2t` 兼容性 | 用 HLS.js `fLoader` 自定义加载器绕过，HLS.js 负责格式转换 |
| IDB 事务超时（大量分片） | 分批次写入，单次事务不超过 50 片 |
| AES-128 加密分片 | IDB 同时存储 key 数据，LocalPlayer 解密后 appendBuffer |
| 存储超配额 | IDB 无系统自动清理，但空间不足时写入报 `QuotaExceededError`，需捕获并提示清理 |
| 播放中途分片损坏 | SourceBuffer `error` 事件捕获，降级到网络流重新拉取 |
| IndexedDB 在无痕模式 | 部分浏览器限制 IDB，检测后提示用户退出无痕模式 |

## 与方案 A 的核心差异

| 维度 | 方案 A (SW Cache) | 方案 B (IDB + MSE) |
|------|-------------------|---------------------|
| SW 依赖 | 必须 | 不需要 |
| 播放改动 | 零改动 | 需要新 LocalPlayer 组件 |
| 数据控制粒度 | URL 级别 | 字节级别（可实现断点续传） |
| 实现复杂度 | 中 | 高 |
| Safari 稳定性 | 差（Cache 被系统清） | 好（IDB 相对稳定） |
| 存储读写性能 | 快 | 慢（IDB 逐条事务） |

## 验证方式

1. DevTools → Application → IndexedDB：确认分片数量与 M3U8 一致
2. 断网后播放已下载内容：无任何网络请求（DevTools Network 全为空）
3. 重启浏览器后 IDB 数据仍在，`/downloads` 正常显示
4. 加密内容（AES-128）离线播放正常解密
5. HLS.js fLoader 单元测试：模拟 IDB 数据注入，验证 SourceBuffer 正确追加
