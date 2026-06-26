/* eslint-disable @typescript-eslint/no-var-requires */

const path = require('node:path');

const INTERNAL_ARTIFACT_LABELS = new Map([
  ['lunatv-desktop-macos-intel', 'macOS Intel'],
  ['lunatv-desktop-macos-arm64', 'macOS Apple Silicon'],
  ['lunatv-desktop-windows-x64', 'Windows x64'],
]);

const INTERNAL_ARTIFACT_ARCHITECTURES = new Map([
  ['lunatv-desktop-macos-intel', 'x64'],
  ['lunatv-desktop-macos-arm64', 'aarch64'],
  ['lunatv-desktop-windows-x64', 'x64'],
]);

const NORMALIZED_RELEASE_PATTERN =
  /^LunaTV\.Desktop_(?:(.+?)_)?(macos|windows|linux)-(x64|arm64)(\.dmg(?:\.sig)?|\.app\.tar\.gz(?:\.sig)?|-setup\.exe(?:\.sig)?|\.msi(?:\.sig)?|-portable\.zip|\.AppImage|\.deb|\.rpm)$/;
const LEGACY_RELEASE_PATTERN =
  /^LunaTV\.Desktop_(?:(.+?)_)?(aarch64|arm64|x64|x86_64)(\.dmg(?:\.sig)?|\.app\.tar\.gz(?:\.sig)?|-setup\.exe(?:\.sig)?|\.msi(?:\.sig)?|-portable\.zip|_portable\.zip|\.AppImage|\.deb|\.rpm)$/;

function getInternalReleaseLabel(artifactName) {
  if (INTERNAL_ARTIFACT_LABELS.has(artifactName)) {
    return INTERNAL_ARTIFACT_LABELS.get(artifactName);
  }

  return artifactName.replace(/^lunatv-desktop-/, '');
}

function getInternalReleaseArchitecture(artifactName) {
  return INTERNAL_ARTIFACT_ARCHITECTURES.get(artifactName) || null;
}

function normalizePublishedAssetName(baseName) {
  return baseName
    .trim()
    .replace(/^LunaTV Desktop/, 'LunaTV.Desktop')
    .replace(/\s+/g, '.')
    .replace(/\.{2,}/g, '.');
}

function insertQualifierBeforeExtension(fileName, qualifier) {
  if (!qualifier || fileName.includes(`_${qualifier}`)) {
    return fileName;
  }

  if (fileName.endsWith('.app.tar.gz.sig')) {
    return `${fileName.slice(
      0,
      -'.app.tar.gz.sig'.length
    )}_${qualifier}.app.tar.gz.sig`;
  }

  if (fileName.endsWith('.app.tar.gz')) {
    return `${fileName.slice(
      0,
      -'.app.tar.gz'.length
    )}_${qualifier}.app.tar.gz`;
  }

  if (fileName.endsWith('.tar.gz.sig')) {
    return `${fileName.slice(
      0,
      -'.tar.gz.sig'.length
    )}_${qualifier}.tar.gz.sig`;
  }

  if (fileName.endsWith('.tar.gz')) {
    return `${fileName.slice(0, -'.tar.gz'.length)}_${qualifier}.tar.gz`;
  }

  const extension = path.posix.extname(fileName);
  if (!extension) {
    return `${fileName}_${qualifier}`;
  }

  return `${fileName.slice(0, -extension.length)}_${qualifier}${extension}`;
}

function normalizeArchitecture(rawArchitecture) {
  switch (rawArchitecture) {
    case 'aarch64':
    case 'arm64':
      return 'arm64';
    case 'x86_64':
    case 'x64':
      return 'x64';
    default:
      return null;
  }
}

function normalizeSuffix(suffix) {
  if (suffix === '_portable.zip') {
    return '-portable.zip';
  }

  return suffix;
}

function resolvePlatformFromSuffix(suffix) {
  if (
    suffix === '.dmg' ||
    suffix === '.dmg.sig' ||
    suffix.startsWith('.app.tar.gz')
  ) {
    return 'macos';
  }

  if (
    suffix.startsWith('-setup.exe') ||
    suffix.startsWith('.msi') ||
    suffix.endsWith('portable.zip')
  ) {
    return 'windows';
  }

  if (suffix === '.AppImage' || suffix === '.deb' || suffix === '.rpm') {
    return 'linux';
  }

  return null;
}

function buildPlatformLabel(platform, architecture) {
  if (platform === 'macos' && architecture === 'x64') {
    return 'macOS Intel';
  }

  if (platform === 'macos' && architecture === 'arm64') {
    return 'macOS Apple Silicon';
  }

  if (platform === 'windows') {
    return `Windows ${architecture}`;
  }

  if (platform === 'linux') {
    return `Linux ${architecture}`;
  }

  return `${platform} ${architecture}`;
}

function buildReleaseAssetLabel(label, assetName) {
  return `${label} - ${assetName}`;
}

function splitLabeledAssetName(assetName) {
  const displaySeparator = ' - ';
  const displayMarker = `${displaySeparator}LunaTV.Desktop_`;
  const displayIndex = assetName.indexOf(displayMarker);
  if (displayIndex !== -1) {
    return {
      label: assetName.slice(0, displayIndex),
      bareName: assetName.slice(displayIndex + displaySeparator.length),
    };
  }

  const dottedMarker = '.-.LunaTV.Desktop_';
  const dottedIndex = assetName.indexOf(dottedMarker);
  if (dottedIndex !== -1) {
    return {
      label: assetName.slice(0, dottedIndex).replaceAll('.', ' '),
      bareName: assetName.slice(dottedIndex + '.-.'.length),
    };
  }

  return {
    label: null,
    bareName: assetName,
  };
}

function buildNormalizedBareReleaseAssetName(assetName, releaseVersion) {
  const normalizedMatch = assetName.match(NORMALIZED_RELEASE_PATTERN);
  if (normalizedMatch) {
    const [, embeddedVersion, platform, architecture, suffix] = normalizedMatch;
    return {
      normalizedName: `LunaTV.Desktop_${
        embeddedVersion || releaseVersion
      }_${platform}-${architecture}${suffix}`,
      platform,
      architecture,
    };
  }

  const legacyMatch = assetName.match(LEGACY_RELEASE_PATTERN);
  if (!legacyMatch) {
    return null;
  }

  const [, embeddedVersion, rawArchitecture, rawSuffix] = legacyMatch;
  const architecture = normalizeArchitecture(rawArchitecture);
  const platform = resolvePlatformFromSuffix(rawSuffix);
  if (!architecture || !platform) {
    return null;
  }

  const version = embeddedVersion || releaseVersion;
  const suffix = normalizeSuffix(rawSuffix);
  return {
    normalizedName: `LunaTV.Desktop_${version}_${platform}-${architecture}${suffix}`,
    platform,
    architecture,
  };
}

function buildInternalReleaseAssetFileName({ artifactName, relativePath }) {
  const baseName = normalizePublishedAssetName(
    path.posix.basename(relativePath)
  );
  return relativePath.endsWith('.app.tar.gz')
    ? insertQualifierBeforeExtension(
        baseName,
        getInternalReleaseArchitecture(artifactName)
      )
    : baseName;
}

function buildInternalReleaseAssetLabel({ artifactName, relativePath }) {
  return buildReleaseAssetLabel(
    getInternalReleaseLabel(artifactName),
    buildInternalReleaseAssetFileName({ artifactName, relativePath })
  );
}

function buildInternalReleaseAssetName(input) {
  return buildInternalReleaseAssetLabel(input);
}

function buildNormalizedReleaseAssetDescriptor({ assetName, releaseVersion }) {
  const { bareName } = splitLabeledAssetName(assetName);
  if (!bareName.startsWith('LunaTV.Desktop_')) {
    return null;
  }

  const normalizedAsset = buildNormalizedBareReleaseAssetName(
    bareName,
    releaseVersion
  );
  if (!normalizedAsset) {
    return null;
  }

  return {
    label: buildPlatformLabel(
      normalizedAsset.platform,
      normalizedAsset.architecture
    ),
    fileName: normalizedAsset.normalizedName,
  };
}

function buildNormalizedReleaseAssetFileName({ assetName, releaseVersion }) {
  return (
    buildNormalizedReleaseAssetDescriptor({
      assetName,
      releaseVersion,
    })?.fileName || null
  );
}

function buildNormalizedReleaseAssetLabel({ assetName, releaseVersion }) {
  const descriptor = buildNormalizedReleaseAssetDescriptor({
    assetName,
    releaseVersion,
  });
  if (!descriptor) {
    return null;
  }

  return buildReleaseAssetLabel(descriptor.label, descriptor.fileName);
}

function buildNormalizedReleaseAssetName({ assetName, releaseVersion }) {
  return buildNormalizedReleaseAssetLabel({ assetName, releaseVersion });
}

module.exports = {
  buildInternalReleaseAssetFileName,
  buildInternalReleaseAssetLabel,
  buildInternalReleaseAssetName,
  buildNormalizedReleaseAssetFileName,
  buildNormalizedReleaseAssetLabel,
  buildNormalizedReleaseAssetName,
};
