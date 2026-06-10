# Desktop Internal Release

Desktop internal releases are published from the existing `Build Desktop App` GitHub Actions workflow.

## Trigger

1. Open `Actions` -> `Build Desktop App`.
2. Click `Run workflow`.
3. Enable `internal_release`.
4. Run the workflow from the branch you want to package.

## Output

When all desktop matrix jobs pass, GitHub Actions will:

- create an unsigned prerelease
- attach the built desktop assets for macOS Intel, macOS Apple Silicon, and Windows x64
- attach `SHA256SUMS.txt`
- attach `release-metadata.json`

## Naming

- Tag: `desktop-v<tauri-version>-internal-run<run-number>-a<run-attempt>`
- Title: `LunaTV Desktop <tauri-version> Internal #<run-number>.<run-attempt>`

The release version comes from `src-tauri/tauri.conf.json`.

## Notes

- macOS builds are unsigned and not notarized.
- Windows installers are unsigned.
- This flow is for internal testing only, not public release.
- Code signing and notarization should be added later without changing the internal-release tag format.
