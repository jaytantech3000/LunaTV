const DEFAULT_RELEASE_REPOSITORY = 'MoonTechLab/LunaTV';
const DEFAULT_RELEASE_BRANCH = 'luna';

function readNextPublicEnvValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getReleaseRepository(): string {
  return (
    readNextPublicEnvValue('NEXT_PUBLIC_RELEASE_REPOSITORY') ||
    DEFAULT_RELEASE_REPOSITORY
  );
}

export function getReleaseBranch(): string {
  return (
    readNextPublicEnvValue('NEXT_PUBLIC_RELEASE_BRANCH') ||
    DEFAULT_RELEASE_BRANCH
  );
}

export function getUpdaterBranch(): string {
  return (
    readNextPublicEnvValue('NEXT_PUBLIC_UPDATER_BRANCH') || getReleaseBranch()
  );
}

export function getProjectPageUrl(repository = getReleaseRepository()): string {
  return `https://github.com/${repository}`;
}

export function getVersionFileUrl(
  repository = getReleaseRepository(),
  branch = getUpdaterBranch()
): string {
  return `https://raw.githubusercontent.com/${repository}/${branch}/VERSION.txt`;
}

export function getChangelogFileUrl(
  locale: 'zh-CN' | 'en' = 'zh-CN',
  repository = getReleaseRepository(),
  branch = getReleaseBranch()
): string {
  const changelogFile = locale === 'en' ? 'CHANGELOG.en' : 'CHANGELOG';
  return `https://raw.githubusercontent.com/${repository}/${branch}/${changelogFile}`;
}
