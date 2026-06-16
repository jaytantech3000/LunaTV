import {
  DESKTOP_RELEASE_BRANCH,
  DESKTOP_RELEASE_REPOSITORY,
  DESKTOP_UPDATER_BRANCH,
} from '@/lib/desktop-release';

const DEFAULT_RELEASE_REPOSITORY = DESKTOP_RELEASE_REPOSITORY;
const DEFAULT_RELEASE_BRANCH = DESKTOP_RELEASE_BRANCH;
const DEFAULT_UPDATER_BRANCH = DESKTOP_UPDATER_BRANCH;

function readNextPublicEnvValue(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getReleaseRepository() {
  return (
    readNextPublicEnvValue('NEXT_PUBLIC_RELEASE_REPOSITORY') ||
    DEFAULT_RELEASE_REPOSITORY
  );
}

export function getReleaseBranch() {
  return (
    readNextPublicEnvValue('NEXT_PUBLIC_RELEASE_BRANCH') ||
    DEFAULT_RELEASE_BRANCH
  );
}

export function getUpdaterBranch() {
  return (
    readNextPublicEnvValue('NEXT_PUBLIC_UPDATER_BRANCH') ||
    DEFAULT_UPDATER_BRANCH
  );
}

export function getProjectPageUrl(repository = getReleaseRepository()) {
  return `https://github.com/${repository}`;
}

export function getReleasePageUrl(repository = getReleaseRepository()) {
  return `${getProjectPageUrl(repository)}/releases`;
}

export function getVersionFileUrl(
  repository = getReleaseRepository(),
  branch = getUpdaterBranch()
) {
  return `https://raw.githubusercontent.com/${repository}/${branch}/VERSION.txt`;
}

export function getChangelogFileUrl(
  locale: 'zh-CN' | 'en' = 'zh-CN',
  repository = getReleaseRepository(),
  branch = getReleaseBranch()
) {
  const changelogFile = locale === 'en' ? 'CHANGELOG.en' : 'CHANGELOG';
  return `https://raw.githubusercontent.com/${repository}/${branch}/${changelogFile}`;
}

export function getLatestUpdaterManifestUrl(
  repository = getReleaseRepository(),
  branch = getUpdaterBranch()
) {
  return `https://raw.githubusercontent.com/${repository}/${branch}/latest.json`;
}
