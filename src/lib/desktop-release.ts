import desktopReleaseMetadata from '@/config/desktop-release.json';

export const DESKTOP_BASE_VERSION = desktopReleaseMetadata.desktopVersion;
export const DESKTOP_UPSTREAM_VERSION = desktopReleaseMetadata.upstreamVersion;
export const DESKTOP_RELEASE_REPOSITORY =
  desktopReleaseMetadata.releaseRepository;
export const DESKTOP_RELEASE_BRANCH = desktopReleaseMetadata.releaseBranch;
export const DESKTOP_UPDATER_BRANCH = desktopReleaseMetadata.updaterBranch;

export type DesktopReleaseMetadata = typeof desktopReleaseMetadata;

export { desktopReleaseMetadata };
