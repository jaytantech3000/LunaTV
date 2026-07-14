import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function readProjectFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('desktop release workflow config', () => {
  it('keeps only the public desktop release workflow', () => {
    expect(
      existsSync(
        path.join(process.cwd(), '.github/workflows/desktop-build.yml')
      )
    ).toBe(false);

    const workflow = readProjectFile('.github/workflows/desktop-release.yml');
    expect(workflow).toContain('name: Release Desktop App');
  });

  it('removes internal-only tauri release overrides', () => {
    expect(
      existsSync(
        path.join(process.cwd(), 'src-tauri/tauri.internal.ci.conf.json')
      )
    ).toBe(false);
    expect(
      existsSync(
        path.join(
          process.cwd(),
          'src-tauri/tauri.windows.internal.ci.conf.json'
        )
      )
    ).toBe(false);
  });

  it('documents only the public desktop release flow', () => {
    const releaseDoc = readProjectFile('docs/desktop-updater-release.md');

    expect(releaseDoc).not.toContain('.github/workflows/desktop-build.yml');
    expect(releaseDoc).not.toContain('internal prerelease');
    expect(releaseDoc).toContain('from the `desktop` branch');
    expect(releaseDoc).not.toContain('from the `desktop` or `main` branch');
    expect(releaseDoc).not.toContain('other than `main`');
  });

  it('treats desktop as the only branch for page-only download-site updates', () => {
    const workflow = readProjectFile('.github/workflows/download-site.yml');

    expect(workflow).toMatch(/branches:\s*\n\s+- desktop(?:\s|$)/);
    expect(workflow).not.toMatch(
      /branches:\s*\n(?:\s+- [^\n]+\n)*\s+- main(?:\s|$)/
    );
  });
});
