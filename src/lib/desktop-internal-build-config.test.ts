import { readFileSync } from 'node:fs';
import path from 'node:path';

function readProjectFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('desktop internal build config', () => {
  it('uses internal tauri override configs in the desktop build workflow', () => {
    const workflow = readProjectFile('.github/workflows/desktop-build.yml');

    expect(workflow).toContain(
      'pnpm exec tauri build --ci --config src-tauri/tauri.internal.ci.conf.json'
    );
    expect(workflow).toContain(
      'pnpm exec tauri build --ci --bundles nsis --config src-tauri/tauri.windows.internal.ci.conf.json'
    );
  });

  it('disables updater artifacts for internal tauri configs', () => {
    const macosConfig = JSON.parse(
      readProjectFile('src-tauri/tauri.internal.ci.conf.json')
    ) as {
      bundle?: {
        createUpdaterArtifacts?: boolean;
      };
    };
    const windowsConfig = JSON.parse(
      readProjectFile('src-tauri/tauri.windows.internal.ci.conf.json')
    ) as {
      build?: {
        beforeBuildCommand?: string | null;
      };
      bundle?: {
        createUpdaterArtifacts?: boolean;
      };
    };

    expect(macosConfig.bundle?.createUpdaterArtifacts).toBe(false);
    expect(windowsConfig.bundle?.createUpdaterArtifacts).toBe(false);
    expect(windowsConfig.build?.beforeBuildCommand).toBeNull();
  });
});
