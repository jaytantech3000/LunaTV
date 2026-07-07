# LunaTV 下载站暗夜主题与平台高亮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有下载站增加暗夜主题切换和当前平台下载项高亮，并通过现有发布链路更新线上下载页。

**Architecture:** 继续沿用 `download-site/` 的原生 HTML/CSS/JS 架构，把主题状态和平台检测收敛到 `download-site/assets/app.js`，用 `html[data-theme]` 和 `data-platform-match` 驱动样式。测试继续放在 `src/lib/download-site-ui.test.ts`，发布继续复用现有 `desktop -> download-site workflow -> gh-pages` 链路。

**Tech Stack:** Jest, plain HTML/CSS/JavaScript, GitHub Actions, GitHub Pages

## Global Constraints

- 增加一个顶部主题 icon 按钮
- 支持浅色 / 暗夜两种主题
- 首次访问时跟随系统 `prefers-color-scheme`
- 用户手动切换后将主题偏好持久化到 `localStorage`
- 渲染下载列表时识别当前访问平台
- 对命中的下载项和下载按钮增加高亮态
- 不做三态主题切换（浅色 / 暗夜 / 跟随系统）
- 不新增平台筛选器、平台分组区块或浮层引导
- 不改动 release 数据结构

---

### Task 1: 主题状态与平台匹配测试先行

**Files:**

- Modify: `src/lib/download-site-ui.test.ts`

**Interfaces:**

- Consumes: `createDownloadSiteApp(document: Document)`
- Produces: 主题切换与平台高亮的回归测试覆盖

- [ ] **Step 1: 写主题初始化失败测试**

```ts
it('follows dark system preference on first render and toggles theme persistently', () => {
  document.body.innerHTML = `
    <div id="download-site-app">
      <a data-role="repo-link"></a>
      <button type="button" data-theme-toggle></button>
      <button type="button" data-locale-button="zh-CN"></button>
      <button type="button" data-locale-button="en"></button>
      <div data-slot="release-list"></div>
      <div data-slot="prerelease-list"></div>
      <time data-role="generated-at"></time>
    </div>
  `;

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });

  const app = downloadSiteAppModule.createDownloadSiteApp(document);

  expect(document.documentElement.dataset.theme).toBe('dark');

  const toggle = document.querySelector(
    '[data-theme-toggle]'
  ) as HTMLButtonElement;
  toggle.click();

  expect(document.documentElement.dataset.theme).toBe('light');
  expect(window.localStorage.getItem('lunatv-download-site:theme')).toBe(
    'light'
  );
});
```

- [ ] **Step 2: 运行单测确认失败**

Run: `pnpm test -- --runInBand src/lib/download-site-ui.test.ts`
Expected: FAIL，报主题按钮或 `data-theme` 尚未实现。

- [ ] **Step 3: 写平台高亮失败测试**

```ts
it('highlights the matching Windows asset for Windows visitors', () => {
  document.body.innerHTML = `
    <div id="download-site-app">
      <a data-role="repo-link"></a>
      <button type="button" data-theme-toggle></button>
      <button type="button" data-locale-button="zh-CN"></button>
      <button type="button" data-locale-button="en"></button>
      <div data-slot="release-list"></div>
      <div data-slot="prerelease-list"></div>
      <time data-role="generated-at"></time>
    </div>
  `;

  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: 'Win32',
  });

  const app = downloadSiteAppModule.createDownloadSiteApp(document);
  app.render({
    releases: [
      {
        tagName: 'desktop-v200.0.1',
        version: '200.0.1',
        name: 'LunaTV Desktop 200.0.1',
        prerelease: false,
        publishedAt: '2026-06-27T01:00:00Z',
        htmlUrl: 'https://example.com/release',
        notes: 'stable notes',
        changeSummary: null,
        assets: [
          {
            fileName: 'LunaTV.Desktop_200.0.1_windows-x64-setup.exe',
            platformLabel: 'Windows x64',
            downloadUrl: 'https://example.com/stable.exe',
            size: 101,
          },
          {
            fileName: 'LunaTV.Desktop_200.0.1_macos-arm64.dmg',
            platformLabel: 'macOS Apple Silicon',
            downloadUrl: 'https://example.com/stable.dmg',
            size: 202,
          },
        ],
      },
    ],
  });

  expect(
    document.querySelector('.asset-item[data-platform-match="true"]')
  )?.toHaveTextContent('Windows x64');
  expect(
    document.querySelector('.asset-item__link[data-platform-match="true"]')
  )?.toHaveTextContent('Download');
  expect(
    document.querySelector('.asset-item[data-platform-match="true"]')
  )?.not.toHaveTextContent('macOS Apple Silicon');
});
```

- [ ] **Step 4: 再跑单测确认按预期失败**

Run: `pnpm test -- --runInBand src/lib/download-site-ui.test.ts`
Expected: FAIL，报 `data-platform-match` 尚未输出。

### Task 2: 最小实现主题切换与平台高亮

**Files:**

- Modify: `download-site/index.html`
- Modify: `download-site/assets/app.js`
- Modify: `download-site/assets/app.css`

**Interfaces:**

- Consumes: `window.localStorage`, `window.matchMedia`, `navigator.platform | userAgentData | userAgent`
- Produces:

  - `setTheme(mode: 'light' | 'dark'): void`
  - `resolvePreferredTheme(): 'light' | 'dark'`
  - `resolveVisitorPlatform(): 'windows' | 'macos' | 'linux' | 'unknown'`
  - `data-platform-match="true"` DOM 标记

- [ ] **Step 1: 在 HTML 增加主题按钮挂载点**

```html
<div class="hero__controls">
  <button
    class="theme-toggle"
    type="button"
    data-theme-toggle
    aria-label="Toggle dark theme"
    aria-pressed="false"
  >
    <span class="theme-toggle__icon" aria-hidden="true"></span>
  </button>
  <div class="locale-switch" aria-label="Language switch"></div>
</div>
```

- [ ] **Step 2: 在 `app.js` 增加主题与平台工具函数**

```js
const THEME_STORAGE_KEY = 'lunatv-download-site:theme';

function readStoredTheme() {
  try {
    const theme = globalObject.localStorage?.getItem(THEME_STORAGE_KEY);
    return theme === 'dark' || theme === 'light' ? theme : null;
  } catch (_) {
    return null;
  }
}

function resolveSystemTheme() {
  return globalObject.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function resolveVisitorPlatform() {
  const value = [
    globalObject.navigator?.userAgentData?.platform,
    globalObject.navigator?.platform,
    globalObject.navigator?.userAgent,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/(iphone|ipad|android)/.test(value)) return 'unknown';
  if (/(win)/.test(value)) return 'windows';
  if (/(mac|darwin|os x)/.test(value)) return 'macos';
  if (/(linux|x11)/.test(value)) return 'linux';
  return 'unknown';
}
```

- [ ] **Step 3: 在 `app.js` 渲染主题状态和高亮下载项**

```js
function assetMatchesPlatform(asset, platform) {
  const haystack = `${asset?.fileName || ''} ${
    asset?.platformLabel || ''
  }`.toLowerCase();
  if (platform === 'windows') return /windows|\.exe|setup/.test(haystack);
  if (platform === 'macos')
    return /macos|osx|\.dmg|\.app\.tar\.gz/.test(haystack);
  if (platform === 'linux')
    return /linux|\.appimage|\.deb|\.rpm|\.tar\.gz/.test(haystack);
  return false;
}

item.dataset.platformMatch = matched ? 'true' : 'false';
link.dataset.platformMatch = matched ? 'true' : 'false';
```

- [ ] **Step 4: 在 `app.css` 增加主题变量和高亮态**

```css
html[data-theme='dark'] {
  --paper: #0f1720;
  --paper-strong: #17212c;
  --ink: #edf3fb;
  --ink-soft: #9fb0c4;
  --line: rgba(159, 176, 196, 0.18);
  --line-strong: rgba(159, 176, 196, 0.34);
  --accent: #7dcfff;
  --accent-strong: #c9ecff;
  --signal: #f4a261;
  --surface: rgba(18, 28, 39, 0.84);
}

.asset-item[data-platform-match='true'] {
  border-color: rgba(210, 107, 46, 0.55);
  box-shadow: 0 18px 34px rgba(6, 14, 23, 0.16);
}

.asset-item__link[data-platform-match='true'] {
  display: inline-flex;
  padding: 0.62rem 0.95rem;
  border-radius: 999px;
  background: var(--accent);
  color: #082033;
}
```

- [ ] **Step 5: 运行单测确认通过**

Run: `pnpm test -- --runInBand src/lib/download-site-ui.test.ts`
Expected: PASS，新增主题和平台高亮测试通过，既有 locale/tab 测试不回归。

### Task 3: 构建、上线与回归验证

**Files:**

- Modify: `download-site-dist/**`（由构建生成）

**Interfaces:**

- Consumes: `download-site/` 源码、现有 `Deploy Download Site` workflow
- Produces: 更新后的 `desktop` 分支源码与 `gh-pages` 页面产物

- [ ] **Step 1: 本地构建静态站**

Run: `pnpm download-site:build`
Expected: PASS，并重新生成 `download-site-dist/`。

- [ ] **Step 2: 检查关键产物包含主题按钮和主题脚本**

Run: `rg -n "data-theme-toggle|lunatv-download-site:theme|data-platform-match" download-site download-site-dist`
Expected: 源码和构建产物都命中新增标记。

- [ ] **Step 3: 提交实现代码**

```bash
git add \
  download-site/index.html \
  download-site/assets/app.js \
  download-site/assets/app.css \
  download-site-dist \
  src/lib/download-site-ui.test.ts \
  docs/superpowers/plans/2026-07-07-download-site-theme-platform.zh.md \
  docs/superpowers/plans/2026-07-07-download-site-theme-platform.en.md
git commit -m "feat(download-site): add theme toggle and platform highlight"
```

- [ ] **Step 4: 推送 `desktop` 分支**

Run: `git push origin desktop`
Expected: PASS，触发 `.github/workflows/download-site.yml`。

- [ ] **Step 5: 验证下载站发布 workflow**

Run: `gh run list --workflow "Deploy Download Site" --branch desktop --limit 1`
Expected: 最新一次运行状态为 `completed` / `success`。

- [ ] **Step 6: 验证页面分支更新**

Run: `git ls-remote --heads origin gh-pages`
Expected: `gh-pages` 指针已更新到新提交。
