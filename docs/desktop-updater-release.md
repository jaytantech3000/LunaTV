# Desktop Updater Release

This repository uses `.github/workflows/desktop-release.yml` for desktop releases.

- `.github/workflows/desktop-release.yml`
  Listens to pushed `desktop-v*` tags, creates or updates the matching GitHub Release with `GITHUB_TOKEN`, builds signed desktop assets, and uploads `latest.json` plus updater signatures.

## Public Desktop Release Flow

Local publishing no longer needs `gh release create` or a logged-in `gh` session.

1. Create a desktop tag such as `desktop-v200.0.1-beta.16` or `desktop-v200.0.1`.
2. Push the tag: `git push origin <tag>`.
3. GitHub Actions will create or update the matching Release automatically, then upload the desktop installers and updater manifest assets.
4. After the release workflow completes, the download site is rebuilt and pushed to the `gh-pages` branch automatically.

## Download Site

- Static source lives in `download-site/`
- Build output lives in `download-site-dist/`
- Release data is exported by `scripts/export-download-site-data.mjs`
- The Pages branch is updated by `scripts/publish-download-site-branch.sh`
- `.github/workflows/download-site.yml` handles first deploys and page-only updates from the `desktop` or `main` branch
- `.github/workflows/desktop-release.yml` republishes the download site after each successful desktop release

## Required GitHub Secrets

- `TAURI_SIGNING_PRIVATE_KEY`
  The updater private key contents.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  Optional. Only needed if the private key was generated with a password.

## Local Key Material

- Private key path: `.tauri-updater/lunatv-updater.key`
- Public key path: `.tauri-updater/lunatv-updater.key.pub`

The `.tauri-updater/` directory is gitignored. The public key is already committed to `src-tauri/tauri.conf.json`.

## Repository URL Sync

- Frontend release links and remote version checks use `NEXT_PUBLIC_RELEASE_REPOSITORY`.
- Tauri updater endpoints use `LUNATV_RELEASE_REPOSITORY`.
- In GitHub Actions both default to `${{ github.repository }}` through `scripts/sync-updater-config.mjs`.

If you need to fetch raw files from a branch other than `main`, set `NEXT_PUBLIC_RELEASE_BRANCH`.
