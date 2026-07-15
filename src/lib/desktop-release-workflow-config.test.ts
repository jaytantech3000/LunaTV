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

  it('runs the CSP contract as a release preflight before any public release can exist', () => {
    const workflow = readProjectFile('.github/workflows/desktop-release.yml');

    expect(workflow).toContain('csp_preflight:');
    expect(workflow).toContain('name: Validate Tauri CSP Contract');
    expect(workflow).toContain('run: pnpm check:tauri-csp');
    expect(workflow).toMatch(
      /ensure_release:\s*[\s\S]*?needs:\s*csp_preflight/
    );
    expect(workflow).toMatch(
      /publish_release:\s*[\s\S]*?needs:\s*ensure_release/
    );
  });

  it('keeps CSP validation as the first executable release-build command', () => {
    const workflow = readProjectFile('.github/workflows/desktop-release.yml');
    const publishRelease = workflow.slice(
      workflow.indexOf('  publish_release:')
    );

    expect(publishRelease).toMatch(
      /- name: Install dependencies[\s\S]*?- name: Validate Tauri CSP contract[\s\S]*?run: pnpm check:tauri-csp[\s\S]*?- name: Sync desktop version/
    );
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

  it('keeps Windows overlay configs free of app.security overrides', () => {
    for (const relativePath of [
      'src-tauri/tauri.windows.conf.json',
      'src-tauri/tauri.windows.ci.conf.json',
    ]) {
      const config = JSON.parse(readProjectFile(relativePath)) as {
        app?: { security?: unknown };
      };

      expect(config.app?.security).toBeUndefined();
    }
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
