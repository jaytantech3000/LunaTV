# LunaTV Desktop Local Service Protocol v1

## 目标

这个协议定义桌面本地 loopback service 的最小复用面。

- 目标对象是桌面 v1，本地单用户 profile
- 不要求兼容管理员后台
- 不要求保留 cookie 鉴权
- 优先复用现有前端、播放器、下载链路的数据结构和媒体 URL 语义

## 运行假设

- 服务运行在本地回环地址，例如 `http://127.0.0.1:8787`
- 桌面端默认使用隐式本地 profile，不通过 cookie 传递身份
- Web 版本继续由 Next route adapter 把 cookie 解析为 `AuthContext / ProfileContext`
- JSON 接口保持当前响应结构，媒体接口继续保持 HTTP 流式响应

## 兼容约束

- 点播媒体参数继续使用 `source`
- 直播媒体参数继续使用 `moontv-source`
- `m3u8` 重写后仍返回播放器可直接消费的 URL
- `segment / key / logo` 继续返回可流式消费的字节流
- 媒体代理必须保留 `Range / Content-Range / Accept-Ranges / CORS` 语义

## 必需接口

### GET `/content/search`

查询参数：

- `q`: 搜索关键字

响应：

```json
{
  "results": []
}
```

说明：

- 对应当前 Web `GET /api/search`
- 结果结构保持 `SearchResult[]`

### GET `/content/detail`

查询参数：

- `id`: 视频 ID
- `source`: 资源站 key

响应：

```json
{
  "id": "string",
  "title": "string"
}
```

说明：

- 对应当前 Web `GET /api/detail`
- 返回结构保持单个 `SearchResult`

### GET `/media/vod/m3u8`

查询参数：

- `source`: 资源站 key
- `url`: 上游 manifest URL

响应：

- `Content-Type: application/vnd.apple.mpegurl`
- body 为已重写的 manifest 文本

说明：

- 对应当前 Web `GET /api/proxy/vod/m3u8`
- 负责嵌套 manifest、segment、key、map、LL-HLS part/preload/rendition-report 重写

### GET `/media/vod/segment`

查询参数：

- `source`
- `url`

响应：

- 流式二进制内容

说明：

- 对应当前 Web `GET /api/proxy/vod/segment`
- 必须透传 `Range` 请求头

### GET `/media/vod/key`

查询参数：

- `source`
- `url`

响应：

- 二进制密钥内容

说明：

- 对应当前 Web `GET /api/proxy/vod/key`

### GET `/live/sources`

响应：

```json
{
  "success": true,
  "data": []
}
```

说明：

- 对应当前 Web `GET /api/live/sources`
- 返回直播源列表

### GET `/live/channels`

查询参数：

- `source`: 直播源 key

响应：

```json
{
  "success": true,
  "data": []
}
```

说明：

- 对应当前 Web `GET /api/live/channels`
- 返回频道列表

### GET `/live/epg`

查询参数：

- `source`: 直播源 key
- `tvgId`: 节目单频道 ID

响应：

```json
{
  "success": true,
  "data": {
    "tvgId": "string",
    "source": "string",
    "epgUrl": "string",
    "programs": []
  }
}
```

说明：

- 对应当前 Web `GET /api/live/epg`

## 建议保留的兼容接口

这些接口不在 Phase 1 必需清单里，但桌面本地服务实现时建议一并提供：

- `GET /content/resources`
- `GET /content/suggestions`
- `GET /live/precheck`
- `GET /media/live/m3u8`
- `GET /media/live/segment`
- `GET /media/live/key`
- `GET /media/live/logo`

## 可选元数据接口

- `GET /metadata/bangumi/calendar`
- `GET /metadata/douban/*`

## 非目标

以下内容不进入 v1 协议阻塞范围：

- `admin/*`
- 多用户远程共享存储
- 配置订阅自动更新
- 桌面壳生命周期接口
