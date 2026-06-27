const STABLE_DESKTOP_RELEASE_TAG_PATTERN = /^desktop-v(\d+\.\d+\.\d+)$/;
const BETA_DESKTOP_RELEASE_TAG_PATTERN =
  /^desktop-v((\d+\.\d+\.\d+)-beta\.(\d+))$/;

function normalizeTagName(tagName) {
  const normalizedTagName = String(tagName || '').trim();
  if (!normalizedTagName) {
    throw new Error('Desktop release tag is required');
  }

  return normalizedTagName;
}

function buildDesktopReleaseDescriptor({ tagName }) {
  const normalizedTagName = normalizeTagName(tagName);
  const stableMatch = normalizedTagName.match(
    STABLE_DESKTOP_RELEASE_TAG_PATTERN
  );
  if (stableMatch) {
    const [, version] = stableMatch;
    return {
      version,
      title: `LunaTV Desktop ${version}`,
      prerelease: false,
      draft: false,
    };
  }

  const betaMatch = normalizedTagName.match(BETA_DESKTOP_RELEASE_TAG_PATTERN);
  if (betaMatch) {
    const [, version, baseVersion, sequence] = betaMatch;
    return {
      version,
      title: `LunaTV Desktop ${baseVersion} Beta ${sequence}`,
      prerelease: true,
      draft: false,
    };
  }

  throw new Error(`Unsupported desktop release tag: ${normalizedTagName}`);
}

module.exports = {
  buildDesktopReleaseDescriptor,
};
