# LunaTV 下载站 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建并上线 GitHub Pages 下载站，在桌面 release 完成后自动同步正式版与预发布版下载信息。

**Architecture:** 使用一个独立静态站目录承载页面，用 Node 脚本直接从 GitHub Releases 生成结构化数据，并由独立 GitHub Actions workflow 推送到 `gh-pages`。页面不镜像安装包，只做统一展示和跳转，从而复用现有 release 产物链路并降低维护成本。

**Tech Stack:** Node.js, plain HTML/CSS/JavaScript, GitHub Actions, GitHub Releases API

## Global Constraints

- 只展示 `desktop-v*`
- 过滤 `draft` 与 `desktop-v*-internal-run*`
- 下载按钮直链 GitHub Release assets
- 页面分成 `Release` 与 `Prerelease` 两大区域
- 每个版本卡片支持展开，并包含 `Downloads` 与 `Release Notes` 两个 tab
- 顶部提供中英文切换按钮
- 不镜像安装包到 Pages
- 不翻译 GitHub Release body 原文

---

### Task 1: 下载站数据导出

**Files:**

- Create: `scripts/export-download-site-data.mjs`
- Create: `src/lib/download-site-data.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: GitHub Releases API payload
- Produces: `download-site-dist/data/releases.json`

- [ ] 写失败测试，覆盖 release 过滤、资产过滤、正式版/预发布分组排序
- [ ] 跑测试确认失败
- [ ] 实现最小数据清洗与 JSON 输出
- [ ] 跑测试确认通过

### Task 2: 静态下载站页面

**Files:**

- Create: `download-site/index.html`
- Create: `download-site/assets/app.css`
- Create: `download-site/assets/app.js`
- Create: `download-site/assets/releases.template.json`
- Create: `scripts/build-download-site.mjs`

**Interfaces:**

- Consumes: `download-site-dist/data/releases.json`
- Produces: 可直接部署到 Pages 的静态站目录

- [ ] 先补页面渲染测试或最小 DOM 行为测试
- [ ] 跑测试确认失败
- [ ] 实现中英文切换、分区、展开卡片、tab 切换
- [ ] 本地构建并确认页面产物输出
- [ ] 跑测试确认通过

### Task 3: GitHub Pages 自动部署

**Files:**

- Create: `.github/workflows/download-site.yml`
- Modify: `.github/workflows/desktop-release.yml`
- Modify: `docs/desktop-updater-release.md`

**Interfaces:**

- Consumes: `download-site-dist/`
- Produces: `gh-pages` branch deployment

- [ ] 实现独立 Pages workflow，支持首次部署与后续自动同步
- [ ] 将 desktop release 完成后的同步接入到下载站 workflow
- [ ] 更新文档说明
- [ ] 检查 workflow 语法与触发逻辑

### Task 4: 首次上线验证

**Files:**

- Modify: `README.md` 或相关文档（如需要）

**Interfaces:**

- Consumes: 已推送代码与 workflow
- Produces: 可访问的 GitHub Pages 站点

- [ ] 本地执行下载站构建
- [ ] 推送代码
- [ ] 触发部署 workflow
- [ ] 验证 `gh-pages` 分支内容
- [ ] 验证 Pages URL 可访问并展示真实 release 数据
