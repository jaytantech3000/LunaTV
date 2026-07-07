# LunaTV Download Site Dark Theme And Platform Highlight Design

**Goal**

Add two incremental capabilities (增量能力) to the existing `download-site/` static download site:

- add a dark-theme toggle button to the top tools area, placed to the left of the language switch
- highlight the download item and button that best match the visitor's current platform

**Why Now**

The current download site already has:

- release and prerelease sections
- Chinese and English copy switching
- expandable release cards and download lists

But it still has two visible gaps:

- the page only has one theme, so night-time browsing has weaker comfort and contrast
- every installer has the same visual weight, so users must scan the whole list before deciding what to click

That slows down first-screen decision making and falls short of the usual progressive-enhancement (渐进增强) baseline for a static download page.

**In Scope**

- add one icon-style theme toggle in the header
- support `light` and `dark` themes
- follow system `prefers-color-scheme` on first visit
- persist the user-selected theme in `localStorage`
- detect the current visitor platform during render
- add a highlighted state for matching download items and download buttons
- add automated tests for theme switching and platform matching

**Out Of Scope**

- no three-state theme switch (`light` / `dark` / `system`)
- no cross-page or cross-subdomain theme sync
- no architecture-level installer recommendation
- no new platform filter, grouped platform sections, or guided overlay
- no change to the release data shape

**Current-State Conclusion**

The current implementation already exposes clean extension boundaries (扩展边界):

1. `download-site/assets/app.js`
   - already owns locale state, render flow, and `localStorage` reads and writes
2. `download-site/assets/app.css`
   - already uses CSS custom properties (CSS 自定义属性), so `html[data-theme]` overrides fit naturally
3. `src/lib/download-site-ui.test.ts`
   - already covers the main DOM interactions and is the right place for regression tests

Conclusion:

- this change does not need a framework or a state library; plain JS plus CSS variables remains the simplest and most robust approach

**Approach Options**

1. Recommended: `html[data-theme]` + CSS variable overrides + platform-match data attributes
   - Pros: one clear state boundary, clean DOM hooks, easiest to test
   - Cons: requires a small initialization layer for theme and platform resolution
2. Alternative: rely on `prefers-color-scheme`, then override with classes on user click
   - Pros: slightly less initial code
   - Cons: harder priority rules between system preference and user preference, more scattered tests
3. Not recommended: expand this into a full theme settings surface
   - Pros: more extensible
   - Cons: over-engineered for a download page

**Recommended Approach**

Use option 1:

- store the active theme on `document.documentElement.dataset.theme`
- persist user choice with a dedicated `localStorage` key
- fall back to system dark preference when no user choice exists
- mark matched download items with `data-platform-match="true"` during render

**Page Structure Change**

The top tools area becomes:

- GitHub Releases link
- theme toggle icon button
- Chinese / English switch

Keep the theme control as a single button. Do not add extra explanatory text that would make the current compact tools area heavier.

**Theme Model**

Add a small theme state model:

```ts
interface ThemeState {
  mode: 'light' | 'dark';
  source: 'system' | 'user';
}
```

Behavior rules:

- read `localStorage` first during initialization
- if no user preference exists, fall back to `matchMedia('(prefers-color-scheme: dark)')`
- after a user click, write the next theme to `localStorage` immediately and switch `source` to `user`
- when `source = system`, the page should react to system theme changes while it is open
- when `source = user`, system changes must not override the manual choice

This follows the common “user preference overrides system preference” pattern, which is safer than media-query-only behavior.

**Platform Detection**

Resolve the current platform in this priority order:

1. `navigator.userAgentData?.platform`
2. `navigator.platform`
3. `navigator.userAgent`

Normalize the result to only:

- `windows`
- `macos`
- `linux`
- `unknown`

Explicit constraints:

- iPhone / iPad / Android should all resolve to `unknown`
- do not distinguish `x64` from `arm64`
- if platform detection is not reliable, do not highlight anything

**Asset Match Rules**

Determine whether an asset matches the current platform by checking both `fileName` and `platformLabel`:

- `windows`
  - match `windows`, `.exe`, `setup`
- `macos`
  - match `macos`, `osx`, `.dmg`, `.app.tar.gz`
- `linux`
  - match `linux`, `.AppImage`, `.deb`, `.rpm`, `.tar.gz`

If either `platformLabel` or `fileName` matches, treat the asset as a platform match.

Why:

- the current release data already provides `platformLabel`
- file-name matching is a defensive fallback (防御性兜底) when one field is incomplete or inconsistent

**Visual Treatment**

For theme:

- keep the existing “paper ledger” direction instead of rebuilding the layout
- preserve the current warm-paper direction in light mode
- switch to a dark blue-gray background, dimmer panels, lighter text, and a warm accent in dark mode

For platform highlight:

- increase border contrast and surface depth on the matched asset row
- strengthen the matched platform pill
- turn the matched download button into a filled accent button
- keep non-matching items visually quiet

Principle:

- create one stronger emphasis layer only; do not reorder the list or create multiple equally loud focal points

**Accessibility And Interaction**

- the theme button must have an `aria-label`
- the theme button should expose `aria-pressed`
- keep the current visible focus outline
- do not rely on color alone; the platform highlight should also differ in border, background, and button shape
- preserve the current single-column mobile layout

**Failure Handling**

- if `localStorage` is unavailable, theme switching should still work for the current session even without persistence
- if `matchMedia` is unavailable, fall back to light theme
- if platform detection fails, return `unknown` without throwing
- if an asset is missing `fileName` or `platformLabel`, matching must safely return false

Do not hide behavior inside empty catches; even when falling back quietly, the code path should stay explicit.

**Test Strategy**

Write failing tests first, then implement:

1. Theme tests
   - with no stored user preference and a dark system preference, initialization should enter dark mode
   - after clicking the theme button, the page should switch themes and persist the new value
2. Platform highlight tests
   - on Windows, the Windows installer row should carry the highlight marker
   - non-Windows assets should not be marked by mistake

Keep the tests in `src/lib/download-site-ui.test.ts` and reuse the existing Jest DOM setup.

**Acceptance Criteria**

- a theme icon button appears to the left of the language switch
- the first visit can follow the system light/dark preference
- after a user theme change, reload keeps the same choice
- on Windows / macOS / Linux, the matching installer row and button are visibly highlighted
- on unknown platforms, the page still renders normally without false highlights
- the existing locale switch and release tabs do not regress
