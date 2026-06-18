import { compareSemver } from '@/lib/semver';

export function isNewerVersion(
  candidateVersion: string | null | undefined,
  baselineVersion: string | null | undefined
) {
  if (!candidateVersion || !baselineVersion) {
    return false;
  }

  if (candidateVersion === baselineVersion) {
    return false;
  }

  try {
    return compareSemver(candidateVersion, baselineVersion) > 0;
  } catch (_) {
    return candidateVersion !== baselineVersion;
  }
}
