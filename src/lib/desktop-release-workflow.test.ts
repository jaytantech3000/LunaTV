import { readFileSync } from 'node:fs';
import path from 'node:path';

function readProjectFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('desktop release workflow', () => {
  it('continues downstream release publishing when at least one platform build succeeds', () => {
    const workflow = readProjectFile('.github/workflows/desktop-release.yml');

    expect(workflow).toContain('release_outcome:');
    expect(workflow).toContain("should_publish == 'true'");
    expect(workflow).toContain('needs: [publish_release, release_outcome]');
  });

  it('skips downstream publishing only when every platform build fails', () => {
    const workflow = readProjectFile('.github/workflows/desktop-release.yml');

    expect(workflow).toContain("job.conclusion === 'success'");
    expect(workflow).toContain("successCount > 0 ? 'true' : 'false'");
  });

  it('publishes a neutral partial-failure summary check when only some platforms succeed', () => {
    const workflow = readProjectFile('.github/workflows/desktop-release.yml');

    expect(workflow).toContain('publish_release_summary:');
    expect(workflow).toContain('checks: write');
    expect(workflow).toContain('github.rest.checks.create');
    expect(workflow).toContain('successCount === publishJobs.length');
    expect(workflow).toContain("? 'success'");
    expect(workflow).toContain(": 'neutral'");
    expect(workflow).toContain('Partial failure:');
  });
});
