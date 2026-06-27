# LunaTV 下载站设计

**目标**

基于 GitHub Pages 建一个统一下载站，展示当前仓库 `desktop-v*` 的正式版与预发布版，支持中英文切换，并在桌面 release workflow 完成后自动同步更新。

**范围**

- 只展示 `desktop-v*`
- 过滤 `draft` 与 `desktop-v*-internal-run*`
- 下载按钮直链 GitHub Release assets
- 页面分成 `Release` 与 `Prerelease` 两大区域
- 每个版本卡片支持展开，并包含 `Downloads` 与 `Release Notes` 两个 tab
- 顶部提供中英文切换按钮

**不做**

- 不镜像安装包到 Pages
- 不翻译 GitHub Release body 原文
- 不复用当前 Next.js 下载页做静态导出

**数据来源**

唯一数据源是 GitHub Releases API。站点构建阶段拉取 release 列表，清洗后生成静态 `releases.json`。

**页面结构**

- 顶部：站点标题、仓库入口、中英文切换
- 主区块：`Release`、`Prerelease`
- 版本卡片：标题、版本号、发布时间、打开 GitHub Release 链接
- 展开内容：
  - `Downloads`：最终用户可下载资源
  - `Release Notes`：GitHub Release notes 原文

**资源过滤规则**

保留：

- Windows setup
- macOS dmg
- macOS app.tar.gz
- 后续可扩展 Linux 终端用户安装包

过滤：

- `latest.json`
- `.sig`
- 其他辅助元数据文件

**技术方案**

- 静态源目录：`download-site/`
- 构建输出目录：`download-site-dist/`
- 数据导出脚本：拉取 GitHub Releases，复用现有 semver / tag 解析能力，生成 `download-site-dist/data/releases.json`
- 部署方式：GitHub Actions 将 `download-site-dist/` 推送到 `gh-pages` 分支

**自动化链路**

- 新增独立下载站部署 workflow
- 触发方式：
  - 手动 `workflow_dispatch`
  - `Release Desktop App` workflow 成功完成后自动触发
  - 下载站代码变更推送到主分支后触发一次，用于首次上线和页面更新

**容错**

- GitHub API 拉取失败时让 workflow 失败，避免发布空站点覆盖线上
- 站点渲染时如果某个 release 没有可展示资产，则隐藏该 release
- 如果某个分区为空，展示明确的空态文案

**验收标准**

- GitHub Pages 可访问
- 页面能按正式版 / 预发布版分组
- 版本卡片可展开
- `Downloads` 和 `Release Notes` tab 可切换
- 中英文按钮可切换 UI 文案
- 新 release 完成后，下载站自动刷新出新版本
