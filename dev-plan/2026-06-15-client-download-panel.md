# 客户端下载面板（修订版）

## 目标

在用户菜单中新增“客户端下载”入口，点击后弹出下载面板，提供两类能力：

1. **桌面版下载**
   仅分发桌面端发布线中的最新 prerelease 安装包。
2. **本地服务脚本下载**
   下载平台对应的一键安装脚本；脚本执行后，通过本站 API 拉取并启动本地代理服务。

本次方案的核心约束：

- 不允许客户端把任意外部 URL 传给服务端代理下载。
- 下载入口只暴露“受限资产”，不能把站点变成通用 GitHub 带宽代理。
- `/api/desktop-release` 和 `/api/local-service-script` 继续走现有登录鉴权；仅 `/api/client-download` 作为脚本下载网关例外放行，并在 route 内自行完成安全收口。

---

## 非目标

- 不做匿名公开下载页。
- 不支持私有 GitHub Release / token 鉴权下载。
- 不在本次实现自动升级、增量更新或桌面端内置更新提示。

---

## 方案总览

### 下载链路

1. 前端打开下载面板。
2. 面板调用 `/api/desktop-release`，获取当前桌面发布信息和**服务端签发**的下载地址。
3. 点击桌面版下载按钮后，请求 `/api/client-download`。
4. `/api/client-download` 仅接受受限参数：
   - 桌面版：`releaseId + assetId + expires + sig`
   - 本地服务：`platform`
5. 服务端重新校验签名、解析资产、流式转发 GitHub 资产。
6. 本地服务脚本由 `/api/local-service-script` 动态生成，脚本内部调用本站绝对地址 `/api/client-download` 拉取二进制。

说明：

- Shell 脚本在终端里执行时不携带浏览器登录态，因此**本地服务二进制下载不能依赖 cookie 鉴权**。
- 为避免脚本中嵌入易过期签名，本地服务模式改为“公开但固定平台 allowlist”；桌面版仍使用短时签名 URL。

### 发布源判定

“最新 prerelease”不足以唯一标识桌面发布线，必须附加固定规则：

- `prerelease === true`
- `target_commitish === DESKTOP_RELEASE_TARGET_COMMITISH`
- 若配置了 `DESKTOP_RELEASE_TAG_PREFIX`，还必须满足 `tag_name.startsWith(prefix)`

这样可以避免仓库里出现其他 prerelease 时误发错误安装包。

---

## 新增文件

### 1. `src/lib/client-download.ts`

新增服务端辅助模块，统一承载下载相关的类型、签名和 GitHub Release 解析逻辑，避免把安全逻辑散在多个 route 里。

建议职责：

- 定义资产键：

```ts
export type DesktopAssetKey =
  | 'mac-arm64'
  | 'mac-x64'
  | 'win-x64-setup'
  | 'win-x64-portable';

export type LocalServicePlatformKey =
  | 'mac-arm64'
  | 'mac-x64'
  | 'linux-x64'
  | 'linux-arm64'
  | 'win-x64';
```

- 获取并筛选 GitHub Release：
  - 请求 `https://api.github.com/repos/${DESKTOP_RELEASE_REPO}/releases`
  - 使用 `AbortController` 控制超时
  - 选择“最新且匹配桌面发布线”的 prerelease
- 资产匹配：
  - `mac-arm64` -> 文件名匹配 `aarch64.dmg`
  - `mac-x64` -> 文件名匹配 `x64.dmg`
  - `win-x64-setup` -> 文件名匹配 `x64-setup.exe`
  - `win-x64-portable` -> 文件名匹配 `portable.zip`
- 下载签名：
  - 通过 `CLIENT_DOWNLOAD_SIGNING_SECRET` 对 payload 做 HMAC
  - payload 至少包含 `kind / releaseId / assetId / expires`
  - 默认有效期建议 `10 分钟`
- 本地服务 URL 映射：
  - 从环境变量解析平台到二进制 URL 的映射
  - 缺失配置时返回 `null`，由上层 route 输出 `503`

这个文件应配套单元测试，优先测试：

- release 选择逻辑
- 资产匹配逻辑
- 签名生成/校验
- 本地服务平台映射

### 2. `src/app/api/desktop-release/route.ts`

返回桌面端发布信息和**已签名的下载地址**，客户端不自行拼接下载参数。

```ts
export const runtime = 'nodejs';

export async function GET() {
  // 1. 读取桌面发布配置
  // 2. 获取最新匹配的桌面 prerelease
  // 3. 解析版本、发布时间、桌面资产
  // 4. 为每个可用资产生成 /api/client-download 的签名地址
  // 5. 返回前端展示所需数据
}
```

建议返回结构：

```ts
{
  version: string;
  publishedAt: string;
  releaseId: number;
  assets: Array<{
    key: DesktopAssetKey;
    label: string;
    name: string;
    size: number;
    downloadPath: string;
  }>;
  missingAssetKeys: DesktopAssetKey[];
}
```

约束：

- 如果找不到匹配的桌面 prerelease，返回 `503`
- 如果只缺少部分资产，返回剩余可用资产，并通过 `missingAssetKeys` 告知前端置灰
- 不返回原始 GitHub `browser_download_url`

缓存策略：

- `Cache-Control: public, max-age=300, s-maxage=300`
- `CDN-Cache-Control: public, s-maxage=300`
- `Vercel-CDN-Cache-Control: public, s-maxage=300`

### 3. `src/app/api/client-download/route.ts`

统一下载网关，取代原方案中的 `/api/download?url=...`。

```ts
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // 支持 desktop / local-service 两类受限下载
}

export async function HEAD(request: NextRequest) {
  // 与 GET 共用解析逻辑，但不返回 body
}
```

支持两类参数：

1. 桌面版下载

```text
/api/client-download?kind=desktop&releaseId=123&assetId=456&expires=...&sig=...
```

处理逻辑：

- 校验 `expires` 未过期
- 校验 `sig`
- 重新从 GitHub Release API 拉取 `releaseId`
- 在该 release 中查找 `assetId`
- 再次确认该资产能映射到允许的 `DesktopAssetKey`
- 使用 `browser_download_url` 发起流式请求

2. 本地服务二进制下载

```text
/api/client-download?kind=local-service&platform=mac-arm64
```

处理逻辑：

- 仅允许固定平台键
- 从环境变量映射得到目标 URL
- 缺失配置时返回 `503`
- 该模式允许匿名访问，但只能命中固定平台映射，不能代理任意 URL

安全要求：

- **绝不接受裸 `url` 参数**
- 使用 `fetchWithValidatedRedirects` 和 `validateProxyTargetUrl`
- 只允许流式代理“GitHub Release API 解析出的地址”或“本地服务平台映射地址”
- 桌面资产请求和本地服务请求都要限制重定向次数
- `desktop` 模式必须验证签名；`local-service` 模式必须验证平台键属于 allowlist

响应头建议：

- `Content-Disposition: attachment; filename="..."`
- `Content-Type`：优先透传上游
- `Content-Length`：仅在未压缩时透传
- `Accept-Ranges`
- `Content-Range`
- `Cache-Control: no-store`
- `Vary: Range`

说明：

- 文件下载比 `proxy/segment` 更接近 `proxy/m3u8-asset` 的场景，应优先复用后者的安全校验和 header 透传模式。

### 4. `src/app/api/local-service-script/route.ts`

动态生成一键安装脚本。

请求参数：

```text
?platform=mac-arm64|mac-x64|linux-x64|linux-arm64|win-x64
```

脚本路由只负责生成脚本文本，不直接暴露第三方 URL；脚本内部通过本站绝对 API 地址拉取本地服务二进制。

脚本中的基础地址来源建议：

- 优先使用 `SITE_BASE`
- 若未配置，则回退到当前请求的 `origin`

macOS / Linux 输出 `.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

BIN_DIR="${HOME}/.lunatv/bin"
mkdir -p "${BIN_DIR}"

curl -fsSL "<absolute_client_download_url>" -o "${BIN_DIR}/lunatv-server"
chmod +x "${BIN_DIR}/lunatv-server"
nohup "${BIN_DIR}/lunatv-server" >/tmp/lunatv-server.log 2>&1 &

echo "LunaTV local service started."
echo "Refresh LunaTV in your browser to use local acceleration."
```

Windows 输出 `.ps1`：

```powershell
$BinDir = Join-Path $env:USERPROFILE ".lunatv\bin"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$Target = Join-Path $BinDir "lunatv-server.exe"

Invoke-WebRequest -UseBasicParsing "<absolute_client_download_url>" -OutFile $Target
Start-Process -FilePath $Target

Write-Host "LunaTV local service started."
Write-Host "Refresh LunaTV in your browser to use local acceleration."
```

路由约束：

- 平台参数不合法返回 `400`
- 平台对应 URL 未配置返回 `503`
- `Content-Disposition` 固定脚本文件名，例如：
  - `lunatv-local-service-mac-arm64.sh`
  - `lunatv-local-service-win-x64.ps1`

### 5. `src/components/DownloadClientPanel.tsx`

新增下载面板组件，接口建议与 `VersionPanel` 保持一致：

```tsx
interface DownloadClientPanelProps {
  isOpen: boolean;
  onClose: () => void;
}
```

主要行为：

- 使用 `Portal + createPortal`
- 使用 `acquireScrollLock`
- `isOpen === true` 时才拉取 `/api/desktop-release`
- 使用 `AbortController` 处理取消和超时

UI 要求：

- 桌面版区域展示：
  - 版本号
  - 发布时间
  - 平台下载按钮
- 本地服务区域展示：
  - 平台脚本下载按钮
  - “安装后视频流量走本机，不经过 Vercel”说明
- 根据平台检测结果高亮推荐按钮
- 对缺失资产或缺失配置的平台显示禁用态
- 请求失败时显示可重试错误态

建议数据流：

- 桌面版按钮直接使用 `/api/desktop-release` 返回的 `downloadPath`
- 本地服务脚本按钮使用固定脚本路由：
  - `/api/local-service-script?platform=mac-arm64`
  - `/api/local-service-script?platform=win-x64`

不建议：

- 不要在前端自己拼 `/api/client-download?...`
- 不要让按钮点击后再去拼 GitHub URL

---

## 修改文件

### `src/components/UserMenu.tsx`

新增状态：

```tsx
const [isDownloadPanelOpen, setIsDownloadPanelOpen] = useState(false);
```

新增菜单事件：

```tsx
const handleOpenDownloadPanel = () => {
  setIsDownloadPanelOpen(true);
  handleCloseMenu();
};
```

菜单位置：

- 放在“设置”之后
- 放在“管理面板”之前

注意：

- 不能只 `setIsDownloadPanelOpen(true)`，必须同步关闭菜单
- 否则会出现菜单遮罩和下载面板同时存在的问题

渲染方式：

```tsx
<DownloadClientPanel
  isOpen={isDownloadPanelOpen}
  onClose={() => setIsDownloadPanelOpen(false)}
/>
```

### `src/middleware.ts`

新增一条精确例外：

- 允许 `/api/client-download` 进入 route
- 其他新接口不放行，仍要求浏览器登录态

原因：

- 桌面版下载地址由 `/api/desktop-release` 签发，进入 `/api/client-download` 后仍会校验签名
- 本地服务脚本在终端运行时没有浏览器 cookie，必须允许其请求下载网关

---

## 环境变量

### 桌面发布线

| 变量名                             | 必填 | 说明                                         |
| ---------------------------------- | ---- | -------------------------------------------- |
| `SITE_BASE`                        | 建议 | 脚本中生成绝对下载地址时优先使用的站点根地址 |
| `DESKTOP_RELEASE_REPO`             | 是   | GitHub 仓库，例如 `jaytantech3000/LunaTV`    |
| `DESKTOP_RELEASE_TARGET_COMMITISH` | 否   | 若配置则额外限定 `target_commitish`          |
| `DESKTOP_RELEASE_TAG_PREFIX`       | 否   | 若配置则进一步限定 tag 前缀                  |
| `CLIENT_DOWNLOAD_SIGNING_SECRET`   | 是   | 下载签名密钥                                 |

### 本地服务二进制映射

| 变量名                                  | 必填 | 说明                                                          |
| --------------------------------------- | ---- | ------------------------------------------------------------- |
| `LOCAL_SERVICE_RELEASE_REPO`            | 否   | 本地服务二进制发布仓库；未配置时回退到 `DESKTOP_RELEASE_REPO` |
| `LOCAL_SERVICE_RELEASE_TAG`             | 否   | 固定 release tag，默认 `local-service-latest`                 |
| `LOCAL_SERVICE_RELEASE_URL_MAC_ARM64`   | 否   | macOS Apple Silicon 二进制直链，优先级高于自动推导            |
| `LOCAL_SERVICE_RELEASE_URL_MAC_X64`     | 否   | macOS Intel 二进制直链，优先级高于自动推导                    |
| `LOCAL_SERVICE_RELEASE_URL_LINUX_X64`   | 否   | Linux x64 二进制直链，优先级高于自动推导                      |
| `LOCAL_SERVICE_RELEASE_URL_LINUX_ARM64` | 否   | Linux ARM64 二进制直链，优先级高于自动推导                    |
| `LOCAL_SERVICE_RELEASE_URL_WIN_X64`     | 否   | Windows x64 二进制直链，优先级高于自动推导                    |

说明：

- 显式逐平台 URL 未配置时，按固定规则推导：
  `https://github.com/<repo>/releases/download/<tag>/<asset-name>`
- 当自动推导和显式 URL 都不存在时，不返回占位脚本，直接 `503`
- 前端看到该平台未配置时应禁用按钮并提示“暂未开放”

---

## 安全约束

1. 不提供通用 URL 代理下载能力。
2. 桌面版下载参数必须签名，并带过期时间。
3. 本地服务二进制下载不使用签名，但只允许固定平台键映射到固定 URL。
4. 除 `/api/client-download` 外，其余新接口继续受现有登录态保护。
5. GitHub 资产必须先通过 Release API 解析，再下载；不能信任客户端传入的 asset URL。
6. 下载代理必须限制重定向次数，并复用现有 URL 校验逻辑，避免被重定向到内网地址。

---

## 失败场景与回退行为

### 桌面版

- 未找到匹配 release：`503`，前端显示“桌面版暂不可用”
- release 找到但缺失个别资产：仅缺失项置灰
- GitHub 请求失败：`502` 或 `503`，前端显示重试按钮

### 本地服务

- 平台参数非法：`400`
- 平台未配置：`503`
- `SITE_BASE` / 请求源异常：脚本路由返回 `503`，避免生成错误的绝对下载地址

### 统一下载网关

- 签名无效或过期：`403`
- 上游下载失败：`502`

---

## 关键复用

| 现有模式             | 文件                                    | 用途                                                          |
| -------------------- | --------------------------------------- | ------------------------------------------------------------- |
| Portal 弹窗结构      | `src/components/VersionPanel.tsx`       | 弹窗容器、关闭交互、滚动锁定                                  |
| URL 校验与重定向安全 | `src/lib/proxy-security.ts`             | 复用 `validateProxyTargetUrl` / `fetchWithValidatedRedirects` |
| 流式代理头透传       | `src/app/api/proxy/m3u8-asset/route.ts` | `Content-Length` / `Range` / `Content-Disposition` 处理       |
| fetch 超时模式       | `src/lib/douban.ts`                     | `AbortController` + timeout                                   |
| API Route 结构       | `src/app/api/server-config/route.ts`    | `NextResponse` 返回模式                                       |

---

## 测试计划

### 单元测试

1. `src/lib/client-download.test.ts`
   - 选择正确的桌面 prerelease
   - 忽略不匹配 `target_commitish` 的 prerelease
   - 正确识别桌面资产键
   - 正确生成与校验签名
   - 正确解析本地服务平台 URL

### API 测试

2. `src/app/api/desktop-release/route.test.ts`

   - 返回签名下载地址
   - 缺失部分资产时返回 `missingAssetKeys`
   - 找不到匹配 release 时返回 `503`

3. `src/app/api/client-download/route.test.ts`

   - desktop 参数签名有效时可下载
   - 签名失效或过期返回 `403`
   - local-service 平台未配置返回 `503`
   - local-service 模式可在无登录态下下载固定平台资产
   - 正确透传 `Content-Type / Content-Length / Accept-Ranges / Content-Range`
   - 上游失败返回 `502`

4. `src/app/api/local-service-script/route.test.ts`
   - mac/linux 输出 `.sh`
   - windows 输出 `.ps1`
   - 未配置平台返回 `503`

### 组件测试

5. `src/components/DownloadClientPanel.test.tsx`

   - 打开时请求桌面发布信息
   - loading / error / success 三态切换正确
   - 推荐平台按钮高亮正确
   - 缺失资产和未配置脚本按钮为禁用态

6. `src/components/UserMenu` 相关测试
   - 点击“客户端下载”后关闭菜单并打开下载面板

---

## 验收标准

1. 用户菜单中出现“客户端下载”入口，位置在“设置”之后、“管理面板”之前。
2. 点击入口后，原菜单关闭，下载面板单独打开。
3. 桌面版区域能正确加载**桌面发布线**的最新 prerelease，而不是仓库任意 prerelease。
4. 桌面版下载流量经过 `/api/client-download`，客户端不持有第三方裸下载地址。
5. 本地服务脚本下载成功，脚本内容只调用本站 API，不直接暴露第三方二进制地址。
6. 未配置的平台展示为禁用态，而不是给出无效按钮或占位脚本。
7. 只有 `/api/client-download` 允许匿名访问，且只能命中“签名桌面资产”或“固定本地服务平台资产”，不会退化成公开 URL 代理。
