import {
  getChangelogFileUrl,
  getProjectPageUrl,
  getReleaseBranch,
  getReleaseRepository,
  getUpdaterBranch,
  getVersionFileUrl,
} from './release-urls';

const mutableEnv = process.env as Record<string, string | undefined>;

function restoreEnvValue(key: string, value: string | undefined) {
  if (value === undefined) {
    delete mutableEnv[key];
    return;
  }

  mutableEnv[key] = value;
}

describe('release url helpers', () => {
  const originalEnv = {
    NEXT_PUBLIC_RELEASE_BRANCH: mutableEnv.NEXT_PUBLIC_RELEASE_BRANCH,
    NEXT_PUBLIC_RELEASE_REPOSITORY:
      mutableEnv.NEXT_PUBLIC_RELEASE_REPOSITORY,
    NEXT_PUBLIC_UPDATER_BRANCH: mutableEnv.NEXT_PUBLIC_UPDATER_BRANCH,
  };

  afterEach(() => {
    restoreEnvValue(
      'NEXT_PUBLIC_RELEASE_BRANCH',
      originalEnv.NEXT_PUBLIC_RELEASE_BRANCH
    );
    restoreEnvValue(
      'NEXT_PUBLIC_RELEASE_REPOSITORY',
      originalEnv.NEXT_PUBLIC_RELEASE_REPOSITORY
    );
    restoreEnvValue(
      'NEXT_PUBLIC_UPDATER_BRANCH',
      originalEnv.NEXT_PUBLIC_UPDATER_BRANCH
    );
  });

  it('defaults to the public luna release line', () => {
    delete mutableEnv.NEXT_PUBLIC_RELEASE_BRANCH;
    delete mutableEnv.NEXT_PUBLIC_RELEASE_REPOSITORY;
    delete mutableEnv.NEXT_PUBLIC_UPDATER_BRANCH;

    expect(getReleaseRepository()).toBe('MoonTechLab/LunaTV');
    expect(getReleaseBranch()).toBe('luna');
    expect(getUpdaterBranch()).toBe('luna');
    expect(getProjectPageUrl()).toBe('https://github.com/MoonTechLab/LunaTV');
    expect(getVersionFileUrl()).toBe(
      'https://raw.githubusercontent.com/MoonTechLab/LunaTV/luna/VERSION.txt'
    );
  });

  it('allows explicit repository and branch overrides', () => {
    mutableEnv.NEXT_PUBLIC_RELEASE_REPOSITORY = 'demo/ForkTV';
    mutableEnv.NEXT_PUBLIC_RELEASE_BRANCH = 'nova';
    mutableEnv.NEXT_PUBLIC_UPDATER_BRANCH = 'release-metadata';

    expect(getReleaseRepository()).toBe('demo/ForkTV');
    expect(getReleaseBranch()).toBe('nova');
    expect(getUpdaterBranch()).toBe('release-metadata');
    expect(getChangelogFileUrl('en')).toBe(
      'https://raw.githubusercontent.com/demo/ForkTV/nova/CHANGELOG.en'
    );
    expect(getVersionFileUrl()).toBe(
      'https://raw.githubusercontent.com/demo/ForkTV/release-metadata/VERSION.txt'
    );
  });
});
