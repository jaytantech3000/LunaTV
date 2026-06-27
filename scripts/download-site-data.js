const DESKTOP_RELEASE_TAG_PREFIX = 'desktop-v';
const SEMVER_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const DOWNLOADABLE_ASSET_SUFFIXES = [
  '.dmg',
  '.app.tar.gz',
  '-setup.exe',
  '.msi',
  '-portable.zip',
  '.AppImage',
  '.deb',
  '.rpm',
];

const PLATFORM_LABELS = new Map([
  ['windows-x64', 'Windows x64'],
  ['windows-arm64', 'Windows arm64'],
  ['macos-x64', 'macOS Intel'],
  ['macos-arm64', 'macOS Apple Silicon'],
  ['linux-x64', 'Linux x64'],
  ['linux-arm64', 'Linux arm64'],
]);

function isValidSemver(version) {
  return SEMVER_PATTERN.test(version.trim());
}

function extractVersionFromDesktopTag(tagName) {
  const normalizedTagName = String(tagName || '').trim();
  if (!normalizedTagName.startsWith(DESKTOP_RELEASE_TAG_PREFIX)) {
    return null;
  }

  const version = normalizedTagName
    .slice(DESKTOP_RELEASE_TAG_PREFIX.length)
    .trim();
  if (
    !version ||
    version.includes('-internal-run') ||
    !isValidSemver(version)
  ) {
    return null;
  }

  return version;
}

function parseSemver(version) {
  const match = String(version || '')
    .trim()
    .match(SEMVER_PATTERN);
  if (!match) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: parsePrerelease(match[4]),
  };
}

function compareNumbers(left, right) {
  if (left > right) {
    return 1;
  }

  if (left < right) {
    return -1;
  }

  return 0;
}

function parsePrerelease(rawPrerelease) {
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

function comparePrerelease(left, right) {
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

function compareSemver(leftVersion, rightVersion) {
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

function hasDownloadableAssetSuffix(assetName) {
  return DOWNLOADABLE_ASSET_SUFFIXES.some((suffix) =>
    assetName.endsWith(suffix)
  );
}

function extractPlatformLabelFromName(assetName) {
  const match = assetName.match(
    /_(windows|macos|linux)-(x64|arm64)(?:\.dmg|\.app\.tar\.gz|-setup\.exe|\.msi|-portable\.zip|\.AppImage|\.deb|\.rpm)$/
  );
  if (!match) {
    return null;
  }

  return PLATFORM_LABELS.get(`${match[1]}-${match[2]}`) || null;
}

function resolveAssetPlatformLabel(asset) {
  const rawLabel = typeof asset.label === 'string' ? asset.label.trim() : '';
  if (rawLabel.includes(' - ')) {
    return rawLabel.split(' - ')[0].trim();
  }

  return extractPlatformLabelFromName(asset.name || '') || 'Download';
}

function normalizeDownloadableAsset(asset) {
  const fileName = typeof asset.name === 'string' ? asset.name.trim() : '';
  const downloadUrl =
    typeof asset.browser_download_url === 'string'
      ? asset.browser_download_url.trim()
      : '';

  if (!fileName || !downloadUrl) {
    return null;
  }

  if (fileName === 'latest.json' || fileName.endsWith('.sig')) {
    return null;
  }

  if (!hasDownloadableAssetSuffix(fileName)) {
    return null;
  }

  return {
    fileName,
    platformLabel: resolveAssetPlatformLabel(asset),
    downloadUrl,
    size: Number.isFinite(asset.size) ? asset.size : null,
  };
}

function getAssetSortWeight(asset) {
  const platformWeights = new Map([
    ['Windows x64', 0],
    ['Windows arm64', 1],
    ['macOS Apple Silicon', 2],
    ['macOS Intel', 3],
    ['Linux x64', 4],
    ['Linux arm64', 5],
  ]);

  return platformWeights.get(asset.platformLabel) ?? 100;
}

function sortAssets(left, right) {
  const leftWeight = getAssetSortWeight(left);
  const rightWeight = getAssetSortWeight(right);

  if (leftWeight !== rightWeight) {
    return leftWeight - rightWeight;
  }

  return left.fileName.localeCompare(right.fileName);
}

function normalizeDownloadSiteRelease(release) {
  if (release?.draft) {
    return null;
  }

  const tagName =
    typeof release.tag_name === 'string' ? release.tag_name.trim() : '';
  const version = extractVersionFromDesktopTag(tagName);
  if (!version) {
    return null;
  }

  const assets = Array.isArray(release.assets)
    ? release.assets
        .map(normalizeDownloadableAsset)
        .filter(Boolean)
        .sort(sortAssets)
    : [];
  if (assets.length === 0) {
    return null;
  }

  return {
    id: String(release.id ?? tagName),
    tagName,
    version,
    name: (typeof release.name === 'string' && release.name.trim()) || tagName,
    prerelease: release.prerelease === true,
    publishedAt:
      (typeof release.published_at === 'string' &&
        release.published_at.trim()) ||
      (typeof release.created_at === 'string' && release.created_at.trim()) ||
      null,
    htmlUrl:
      (typeof release.html_url === 'string' && release.html_url.trim()) || null,
    notes: (typeof release.body === 'string' && release.body.trim()) || null,
    assets,
  };
}

function sortReleases(left, right) {
  const versionOrder = compareSemver(right.version, left.version);
  if (versionOrder !== 0) {
    return versionOrder;
  }

  const leftPublishedAt = left.publishedAt
    ? Date.parse(left.publishedAt)
    : Number.NEGATIVE_INFINITY;
  const rightPublishedAt = right.publishedAt
    ? Date.parse(right.publishedAt)
    : Number.NEGATIVE_INFINITY;

  return rightPublishedAt - leftPublishedAt;
}

function normalizeDownloadSiteReleases(releases) {
  return releases
    .map(normalizeDownloadSiteRelease)
    .filter(Boolean)
    .sort(sortReleases);
}

function buildDownloadSitePayload({
  repository,
  releases,
  generatedAt = new Date().toISOString(),
}) {
  return {
    generatedAt,
    repository,
    releases: normalizeDownloadSiteReleases(releases),
  };
}

module.exports = {
  buildDownloadSitePayload,
  extractVersionFromDesktopTag,
  normalizeDownloadSiteReleases,
};
