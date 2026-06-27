# LunaTV Download Site Design

**Goal**

Build a unified download site on GitHub Pages that lists `desktop-v*` releases from this repository, separates release and prerelease builds, supports Chinese and English UI copy, and updates automatically after the desktop release workflow finishes.

**Scope**

- Show only `desktop-v*`
- Filter out `draft` and `desktop-v*-internal-run*`
- Keep download buttons pointed at GitHub Release assets
- Split the page into `Release` and `Prerelease` sections
- Make each release card expandable with `Downloads` and `Release Notes` tabs
- Add a top-level Chinese / English language switch

**Out of Scope**

- Do not mirror installers into Pages
- Do not translate raw GitHub Release bodies
- Do not statically export the existing Next.js downloads page

**Data Source**

The only source of truth is the GitHub Releases API. During site build, the workflow fetches releases, normalizes them, and writes a static `releases.json`.

**Page Structure**

- Top bar: site title, repository link, Chinese / English switch
- Main sections: `Release`, `Prerelease`
- Release card: title, version, publish time, open GitHub Release link
- Expanded content:
  - `Downloads`: end-user downloadable assets
  - `Release Notes`: raw GitHub Release notes

**Asset Filtering**

Keep:

- Windows setup
- macOS dmg
- macOS app.tar.gz
- Future Linux end-user installers

Filter out:

- `latest.json`
- `.sig`
- Other helper metadata files

**Technical Approach**

- Static source directory: `download-site/`
- Build output directory: `download-site-dist/`
- Data export script: fetch GitHub Releases, reuse existing semver and tag parsing, generate `download-site-dist/data/releases.json`
- Deployment: GitHub Actions pushes `download-site-dist/` to the `gh-pages` branch

**Automation Flow**

- Add a dedicated download site deployment workflow
- Triggers:
  - manual `workflow_dispatch`
  - automatic run after `Release Desktop App` succeeds
  - push to the main branch when download site code changes, for first launch and page updates

**Failure Handling**

- If GitHub API fetching fails, fail the workflow instead of overwriting production with an empty site
- If a release has no displayable assets, hide that release
- If a section is empty, show a clear empty-state message

**Acceptance Criteria**

- GitHub Pages is reachable
- The page groups builds into release and prerelease sections
- Release cards can expand
- `Downloads` and `Release Notes` tabs switch correctly
- The language switch updates UI copy
- New releases appear automatically after the release workflow completes
