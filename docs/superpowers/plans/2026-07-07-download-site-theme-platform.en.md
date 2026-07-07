# LunaTV Download Site Theme And Platform Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dark-theme toggle and platform-aware download highlighting to the existing download site, then ship the update through the current publish pipeline.

**Architecture:** Keep the existing plain HTML/CSS/JS architecture in `download-site/`, centralize theme state and platform detection in `download-site/assets/app.js`, and drive styling with `html[data-theme]` plus `data-platform-match`. Keep tests in `src/lib/download-site-ui.test.ts`, and reuse the current `desktop -> download-site workflow -> gh-pages` deployment flow.

**Tech Stack:** Jest, plain HTML/CSS/JavaScript, GitHub Actions, GitHub Pages

## Global Constraints

- add one icon-style theme button in the header
- support `light` and `dark` themes
- follow system `prefers-color-scheme` on first visit
- persist manual theme choice in `localStorage`
- detect the current visitor platform while rendering assets
- highlight matching download rows and buttons
- do not add a three-state theme switch
- do not add a platform filter, grouped platform sections, or guided overlays
- do not change the release data shape

---

### Task 1: Write theme and platform tests first

**Files:**

- Modify: `src/lib/download-site-ui.test.ts`

**Interfaces:**

- Consumes: `createDownloadSiteApp(document: Document)`
- Produces: regression coverage for theme switching and platform-aware highlighting

- [ ] **Step 1: Write the failing theme test**

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

- [ ] **Step 2: Run the test and verify the expected failure**

Run: `pnpm test -- --runInBand src/lib/download-site-ui.test.ts`
Expected: FAIL because the theme toggle or `data-theme` handling does not exist yet.

- [ ] **Step 3: Write the failing platform highlight test**

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

- [ ] **Step 4: Run the test again and verify the expected failure**

Run: `pnpm test -- --runInBand src/lib/download-site-ui.test.ts`
Expected: FAIL because `data-platform-match` is not rendered yet.

### Task 2: Implement the minimal theme and highlight behavior

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
  - `data-platform-match="true"` DOM markers

- [ ] **Step 1: Add the theme button mount point in HTML**

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

- [ ] **Step 2: Add theme and platform helpers in `app.js`**

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

- [ ] **Step 3: Render theme state and matching asset markers in `app.js`**

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

- [ ] **Step 4: Add dark-theme tokens and platform highlight styles in `app.css`**

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

- [ ] **Step 5: Run the tests and verify they pass**

Run: `pnpm test -- --runInBand src/lib/download-site-ui.test.ts`
Expected: PASS, including the new theme and platform tests plus the existing locale/tab coverage.

### Task 3: Build, ship, and verify the update

**Files:**

- Modify: `download-site-dist/**` (generated build output)

**Interfaces:**

- Consumes: `download-site/` source and the existing `Deploy Download Site` workflow
- Produces: updated source on `desktop` and updated Pages output on `gh-pages`

- [ ] **Step 1: Build the static site locally**

Run: `pnpm download-site:build`
Expected: PASS and regenerated `download-site-dist/`.

- [ ] **Step 2: Verify the built output contains the new hooks**

Run: `rg -n "data-theme-toggle|lunatv-download-site:theme|data-platform-match" download-site download-site-dist`
Expected: matches in both source and built output.

- [ ] **Step 3: Commit the implementation**

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

- [ ] **Step 4: Push the `desktop` branch**

Run: `git push origin desktop`
Expected: PASS and a new `.github/workflows/download-site.yml` run starts.

- [ ] **Step 5: Verify the publish workflow**

Run: `gh run list --workflow "Deploy Download Site" --branch desktop --limit 1`
Expected: the latest run finishes with `completed` / `success`.

- [ ] **Step 6: Verify the Pages branch moved**

Run: `git ls-remote --heads origin gh-pages`
Expected: the `gh-pages` ref points at a fresh publish commit.
