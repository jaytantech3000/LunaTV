/* eslint-disable @typescript-eslint/no-var-requires */

interface DesktopReleaseDescriptorModule {
  buildDesktopReleaseDescriptor(input: { tagName: string }): {
    version: string;
    title: string;
    prerelease: boolean;
    draft: boolean;
  };
}

const desktopReleaseDescriptorModule =
  require('../../scripts/desktop-release-tag.js') as DesktopReleaseDescriptorModule;

describe('desktop release tag helpers', () => {
  it('builds stable release metadata from a desktop tag', () => {
    expect(
      desktopReleaseDescriptorModule.buildDesktopReleaseDescriptor({
        tagName: 'desktop-v200.0.1',
      })
    ).toEqual({
      version: '200.0.1',
      title: 'LunaTV Desktop 200.0.1',
      prerelease: false,
      draft: false,
    });
  });

  it('builds prerelease metadata from a desktop beta tag', () => {
    expect(
      desktopReleaseDescriptorModule.buildDesktopReleaseDescriptor({
        tagName: 'desktop-v200.0.1-beta.16',
      })
    ).toEqual({
      version: '200.0.1-beta.16',
      title: 'LunaTV Desktop 200.0.1 Beta 16',
      prerelease: true,
      draft: false,
    });
  });

  it('rejects unsupported desktop tags early', () => {
    expect(() =>
      desktopReleaseDescriptorModule.buildDesktopReleaseDescriptor({
        tagName: 'v200.0.1',
      })
    ).toThrow('Unsupported desktop release tag: v200.0.1');
  });
});
