/* eslint-disable @typescript-eslint/no-var-requires */

interface DesktopReleaseAssetNamingModule {
  buildInternalReleaseAssetFileName(input: {
    artifactName: string;
    relativePath: string;
  }): string;
  buildInternalReleaseAssetLabel(input: {
    artifactName: string;
    relativePath: string;
  }): string;
  buildInternalReleaseAssetName(input: {
    artifactName: string;
    relativePath: string;
  }): string;
  buildNormalizedReleaseAssetFileName(input: {
    assetName: string;
    releaseVersion: string;
  }): string | null;
  buildNormalizedReleaseAssetLabel(input: {
    assetName: string;
    releaseVersion: string;
  }): string | null;
  buildNormalizedReleaseAssetName(input: {
    assetName: string;
    releaseVersion: string;
  }): string | null;
}

// Jest loads the shared script through CommonJS so the release scripts can reuse it unchanged.
const assetNamingModule =
  require('../../scripts/desktop-release-asset-naming.js') as DesktopReleaseAssetNamingModule;

describe('desktop release asset naming', () => {
  it('builds safe internal release filenames without platform labels', () => {
    expect(
      assetNamingModule.buildInternalReleaseAssetFileName({
        artifactName: 'lunatv-desktop-macos-intel',
        relativePath: 'dmg/LunaTV Desktop_200.0.1_x64.dmg',
      })
    ).toBe('LunaTV.Desktop_200.0.1_x64.dmg');

    expect(
      assetNamingModule.buildInternalReleaseAssetFileName({
        artifactName: 'lunatv-desktop-macos-arm64',
        relativePath: 'macos/LunaTV Desktop.app.tar.gz',
      })
    ).toBe('LunaTV.Desktop_aarch64.app.tar.gz');
  });

  it('adds a human-readable platform label to internal prerelease assets', () => {
    expect(
      assetNamingModule.buildInternalReleaseAssetLabel({
        artifactName: 'lunatv-desktop-macos-intel',
        relativePath: 'dmg/LunaTV Desktop_200.0.1_x64.dmg',
      })
    ).toBe('macOS Intel - LunaTV.Desktop_200.0.1_x64.dmg');

    expect(
      assetNamingModule.buildInternalReleaseAssetLabel({
        artifactName: 'lunatv-desktop-macos-arm64',
        relativePath: 'macos/LunaTV Desktop.app.tar.gz',
      })
    ).toBe('macOS Apple Silicon - LunaTV.Desktop_aarch64.app.tar.gz');

    expect(
      assetNamingModule.buildInternalReleaseAssetName({
        artifactName: 'lunatv-desktop-windows-x64',
        relativePath: 'portable/LunaTV Desktop_200.0.1_x64_portable.zip',
      })
    ).toBe('Windows x64 - LunaTV.Desktop_200.0.1_x64_portable.zip');
  });

  it('builds safe normalized release filenames for updater urls', () => {
    expect(
      assetNamingModule.buildNormalizedReleaseAssetFileName({
        assetName: 'LunaTV.Desktop_200.0.1_x64-setup.exe',
        releaseVersion: '200.0.1',
      })
    ).toBe('LunaTV.Desktop_200.0.1_windows-x64-setup.exe');

    expect(
      assetNamingModule.buildNormalizedReleaseAssetFileName({
        assetName: 'Windows x64 - LunaTV.Desktop_200.0.1_windows-x64-setup.exe',
        releaseVersion: '200.0.1',
      })
    ).toBe('LunaTV.Desktop_200.0.1_windows-x64-setup.exe');

    expect(
      assetNamingModule.buildNormalizedReleaseAssetFileName({
        assetName: 'Windows.x64.-.LunaTV.Desktop_200.0.1_windows-x64-setup.exe',
        releaseVersion: '200.0.1',
      })
    ).toBe('LunaTV.Desktop_200.0.1_windows-x64-setup.exe');
  });

  it('adds a human-readable platform label to normalized release assets', () => {
    expect(
      assetNamingModule.buildNormalizedReleaseAssetLabel({
        assetName: 'LunaTV.Desktop_200.0.1_x64-setup.exe',
        releaseVersion: '200.0.1',
      })
    ).toBe('Windows x64 - LunaTV.Desktop_200.0.1_windows-x64-setup.exe');

    expect(
      assetNamingModule.buildNormalizedReleaseAssetName({
        assetName: 'LunaTV.Desktop_200.0.1_aarch64.dmg',
        releaseVersion: '200.0.1',
      })
    ).toBe('macOS Apple Silicon - LunaTV.Desktop_200.0.1_macos-arm64.dmg');
  });

  it('keeps already-prefixed normalized release assets stable', () => {
    expect(
      assetNamingModule.buildNormalizedReleaseAssetLabel({
        assetName: 'Windows x64 - LunaTV.Desktop_200.0.1_windows-x64-setup.exe',
        releaseVersion: '200.0.1',
      })
    ).toBe('Windows x64 - LunaTV.Desktop_200.0.1_windows-x64-setup.exe');
  });
});
