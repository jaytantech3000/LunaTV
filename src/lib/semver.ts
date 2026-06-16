const SEMVER_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

type SemverIdentifier = number | string;

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: SemverIdentifier[];
}

export function parseSemver(version: string): ParsedSemver {
  const match = version.trim().match(SEMVER_PATTERN);
  if (!match) {
    throw new Error(`Invalid version: ${version}`);
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: parsePrerelease(match[4]),
  };
}

export function compareSemver(leftVersion: string, rightVersion: string) {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);

  if (left.major !== right.major) {
    return compareNumbers(left.major, right.major);
  }

  if (left.minor !== right.minor) {
    return compareNumbers(left.minor, right.minor);
  }

  if (left.patch !== right.patch) {
    return compareNumbers(left.patch, right.patch);
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

function compareNumbers(left: number, right: number) {
  if (left > right) {
    return 1;
  }

  if (left < right) {
    return -1;
  }

  return 0;
}

function parsePrerelease(rawPrerelease?: string): SemverIdentifier[] {
  if (!rawPrerelease) {
    return [];
  }

  return rawPrerelease.split('.').map((identifier) => {
    if (/^\d+$/.test(identifier)) {
      return Number.parseInt(identifier, 10);
    }

    return identifier;
  });
}

function comparePrerelease(
  left: SemverIdentifier[],
  right: SemverIdentifier[]
) {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }

  if (left.length === 0) {
    return 1;
  }

  if (right.length === 0) {
    return -1;
  }

  const limit = Math.max(left.length, right.length);

  for (let index = 0; index < limit; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];

    if (leftIdentifier === undefined) {
      return -1;
    }

    if (rightIdentifier === undefined) {
      return 1;
    }

    if (leftIdentifier === rightIdentifier) {
      continue;
    }

    const leftIsNumeric = typeof leftIdentifier === 'number';
    const rightIsNumeric = typeof rightIdentifier === 'number';

    if (leftIsNumeric && rightIsNumeric) {
      return compareNumbers(leftIdentifier, rightIdentifier);
    }

    if (leftIsNumeric) {
      return -1;
    }

    if (rightIsNumeric) {
      return 1;
    }

    return leftIdentifier > rightIdentifier ? 1 : -1;
  }

  return 0;
}
