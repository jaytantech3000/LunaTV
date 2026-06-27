# LunaTV Download Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and launch a GitHub Pages download site that automatically syncs release and prerelease desktop downloads after the desktop release workflow completes.

**Architecture:** Use a standalone static site directory for the UI, generate structured release data from GitHub Releases with a Node script, and deploy the built output to `gh-pages` from a dedicated workflow. The site does not mirror installers; it only indexes them and links directly to release assets.

**Tech Stack:** Node.js, plain HTML/CSS/JavaScript, GitHub Actions, GitHub Releases API

## Global Constraints

- Show only `desktop-v*`
- Filter out `draft` and `desktop-v*-internal-run*`
- Keep download buttons pointed at GitHub Release assets
- Split the page into `Release` and `Prerelease` sections
- Make each release card expandable with `Downloads` and `Release Notes` tabs
- Add a top-level Chinese / English language switch
- Do not mirror installers into Pages
- Do not translate raw GitHub Release bodies

---

### Task 1: Download Site Data Export

**Files:**

- Create: `scripts/export-download-site-data.mjs`
- Create: `src/lib/download-site-data.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: GitHub Releases API payload
- Produces: `download-site-dist/data/releases.json`

- [ ] Write a failing test for release filtering, asset filtering, and release/prerelease ordering
- [ ] Run the test and confirm the expected failure
- [ ] Implement minimal normalization and JSON output
- [ ] Run the test and confirm it passes

### Task 2: Static Download Site UI

**Files:**

- Create: `download-site/index.html`
- Create: `download-site/assets/app.css`
- Create: `download-site/assets/app.js`
- Create: `download-site/assets/releases.template.json`
- Create: `scripts/build-download-site.mjs`

**Interfaces:**

- Consumes: `download-site-dist/data/releases.json`
- Produces: a deployable static site directory for Pages

- [ ] Add a minimal rendering or DOM behavior test first
- [ ] Run the test and confirm it fails
- [ ] Implement the language switch, grouped sections, expandable cards, and tabs
- [ ] Build locally and confirm the static output is generated
- [ ] Run the test and confirm it passes

### Task 3: GitHub Pages Automation

**Files:**

- Create: `.github/workflows/download-site.yml`
- Modify: `.github/workflows/desktop-release.yml`
- Modify: `docs/desktop-updater-release.md`

**Interfaces:**

- Consumes: `download-site-dist/`
- Produces: deployment to the `gh-pages` branch

- [ ] Implement a dedicated Pages workflow for first deploy and later syncs
- [ ] Connect desktop release completion to the download site workflow
- [ ] Update the release documentation
- [ ] Validate workflow syntax and trigger behavior

### Task 4: First Launch Verification

**Files:**

- Modify: `README.md` or related docs if needed

**Interfaces:**

- Consumes: pushed code and workflow runs
- Produces: a reachable GitHub Pages site

- [ ] Run the download site build locally
- [ ] Push the code
- [ ] Trigger the deploy workflow
- [ ] Verify the `gh-pages` branch contents
- [ ] Verify the Pages URL renders real release data
