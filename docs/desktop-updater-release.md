# Desktop Updater Release

This repository now uses two separate desktop workflows:

- `.github/workflows/desktop-build.yml`
  Builds unsigned internal desktop artifacts and can optionally publish an internal prerelease.
- `.github/workflows/desktop-release.yml`
  Builds release assets for a published GitHub Release, signs updater artifacts, and uploads `latest.json` plus updater signatures.

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
