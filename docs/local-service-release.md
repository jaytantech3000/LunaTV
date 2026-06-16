# Local Service Release

`方案 B` 的发布闭环由三部分组成：

1. Rust 源码：`crates/moontv-local-service`
2. 发布工作流：`.github/workflows/local-service-release.yml`
3. Web 下载映射：默认从固定 GitHub Release tag 取本地服务二进制

## 二进制资产命名

工作流会产出以下 5 个原始可执行文件：

- `lunatv-server-mac-arm64`
- `lunatv-server-mac-x64`
- `lunatv-server-linux-x64`
- `lunatv-server-linux-arm64`
- `lunatv-server-win-x64.exe`

脚本下载时会把这些资产保存为本机统一文件名：

- macOS / Linux：`lunatv-server`
- Windows：`lunatv-server.exe`

## 如何发布

支持两种模式：

### 1. 共享滚动标签

在 GitHub Actions 中手动触发 `Build & Publish Local Service`：

1. `release_tag` 保持默认 `local-service-latest`
2. `release_name` 可保持默认 `LunaTV Local Service`
3. `prerelease` 建议保持 `true`

这适合生产或统一下载入口。工作流会：

1. 先执行 `cargo test --locked`
2. 构建 macOS / Linux / Windows 五个平台的二进制
3. 创建或更新同名 GitHub Release
4. 用 `--clobber` 覆盖旧资产，保证固定 tag 可重复发布

### 2. `nova` 独立 prerelease

直接在 `nova` 对应提交上打 tag 并推送：

```bash
git checkout nova
git pull --ff-only origin nova
git tag local-service-nova-2026-06-16.1
git push origin local-service-nova-2026-06-16.1
```

任何匹配 `local-service-*` 的 tag 都会自动触发 `Build & Publish Local Service`，并默认创建同名 prerelease。

如果 tag 形如 `local-service-nova-*` 或 `local-service-luna-*`，工作流还会自动维护对应的滚动别名：

- `local-service-nova-latest`
- `local-service-luna-latest`

推荐约定：

- `local-service-nova-*`：`nova` 预发布验证
- `local-service-luna-*`：`luna` 稳定线候选
- `local-service-latest`：共享滚动入口

`local-service-*` release 不会再触发 Web Docker 镜像 workflow。

## Web 端环境变量

推荐最小配置：

```env
# 只有当部署平台不能自动暴露 Git 仓库信息时才需要手工指定
DESKTOP_RELEASE_REPO=your-org/LunaTV
```

在 Vercel 这类会暴露 Git 仓库和部署分支的环境里，下载面板现在可以自动推导：

- 仓库：优先 `DESKTOP_RELEASE_REPO` / `LOCAL_SERVICE_RELEASE_REPO`，否则自动尝试 `GITHUB_REPOSITORY` 或 `VERCEL_GIT_REPO_OWNER` + `VERCEL_GIT_REPO_SLUG`
- 桌面版 prerelease 线：未显式配置时默认匹配 `desktop-v*`
- 本地服务通道：按当前部署分支自动切到 `nova` / `luna`

所以一般不需要每次手改 `LOCAL_SERVICE_RELEASE_TAG`：

- `nova` 部署会自动跟随 `local-service-nova-latest`
- `luna` 部署会自动跟随 `local-service-luna-latest`
- 其他环境默认回退到 `local-service-latest`

可选增强：

```env
# 如果部署平台不会提供当前分支，可手工指定发布通道
LOCAL_SERVICE_RELEASE_CHANNEL=nova

# 如果本地服务二进制发布在单独仓库，用它覆盖桌面版仓库
LOCAL_SERVICE_RELEASE_REPO=your-org/LunaTV-binaries

# 如果桌面版 prerelease 不是 desktop-v* 这一条线，可显式覆盖
DESKTOP_RELEASE_TAG_PREFIX=desktop-v

# 如果你要进一步收窄到某个 target_commitish，也可以显式指定
DESKTOP_RELEASE_TARGET_COMMITISH=desktop

# 只有在你明确要锁定某一个具体 tag 时才需要写这个
LOCAL_SERVICE_RELEASE_TAG=local-service-nova-2026-06-16.1

# 逐平台显式地址始终优先于自动推导
LOCAL_SERVICE_RELEASE_URL_MAC_ARM64=
LOCAL_SERVICE_RELEASE_URL_MAC_X64=
LOCAL_SERVICE_RELEASE_URL_LINUX_X64=
LOCAL_SERVICE_RELEASE_URL_LINUX_ARM64=
LOCAL_SERVICE_RELEASE_URL_WIN_X64=
```

当逐平台 URL 未配置时，服务端会自动推导：

```text
https://github.com/<repo>/releases/download/<tag>/<asset-name>
```

本地服务标签解析优先级：

1. `LOCAL_SERVICE_RELEASE_TAG`
2. 自动分支通道或显式 `LOCAL_SERVICE_RELEASE_CHANNEL`
3. 默认 `local-service-latest`

`<repo>` 优先级：

1. `LOCAL_SERVICE_RELEASE_REPO`
2. `DESKTOP_RELEASE_REPO`
3. `GITHUB_REPOSITORY`
4. `VERCEL_GIT_REPO_OWNER` + `VERCEL_GIT_REPO_SLUG`

## 本地验证

```bash
cargo test --manifest-path crates/moontv-local-service/Cargo.toml
cargo run --manifest-path crates/moontv-local-service/Cargo.toml -- --port 8787
curl http://127.0.0.1:8787/health
```
