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

const GITHUB_COMPARE_URL_PATTERN =
  /https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/compare\/[^\s)]+/i;
const CONVENTIONAL_COMMIT_PATTERN = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/i;
const FULL_CHANGELOG_LINE_PATTERN = /^\**\s*full changelog\s*\**\s*:?\s*/i;
const CJK_TEXT_PATTERN = /[\u3400-\u9fff]/;

const RELEASE_CHANGE_SCOPE_TRANSLATIONS_ZH = new Map([
  ['admin', '管理端'],
  ['app', '应用'],
  ['auth', '登录'],
  ['bootstrap', '启动配置'],
  ['cache', '缓存'],
  ['desktop', '桌面端'],
  ['follow', '追更'],
  ['music', '音乐'],
  ['player', '播放器'],
  ['profile', '资料'],
  ['release', '发布'],
  ['runtime', '运行时'],
  ['search', '搜索'],
  ['updater', '更新器'],
]);

const EXACT_RELEASE_CHANGE_TRANSLATIONS_ZH = new Map([
  ['add bilingual beta release summaries', '增加 Beta 版本摘要的中英文切换'],
  ['avoid stale release compare cache', '避免旧的版本对比缓存'],
  ['avoid startup follow record toast', '避免启动时出现追更记录错误提示'],
  ['compact desktop release cards', '精简桌面版本卡片'],
  ['restore beta release summaries', '恢复 Beta 版本摘要'],
  ['startup local auth flows', '启动阶段的本地登录流程'],
]);

const RELEASE_CHANGE_PHRASE_TRANSLATIONS_ZH = [
  ['desktop music api', '桌面音乐 API'],
  ['desktop release cards', '桌面版本卡片'],
  ['desktop updater', '桌面更新器'],
  ['follow record toast', '追更记录错误提示'],
  ['follow record', '追更记录'],
  ['follow records', '追更记录'],
  ['local auth flows', '本地登录流程'],
  ['netease routes', '网易云路由'],
  ['netease route', '网易云路由'],
  ['beta release summaries', 'Beta 版本摘要'],
  ['release compare cache', '版本对比缓存'],
  ['compare parser', '版本对比解析器'],
  ['prerelease notes flow', '预发布说明流程'],
  ['release summaries', '版本摘要'],
  ['release summary', '版本摘要'],
  ['play records', '播放记录'],
  ['play record', '播放记录'],
  ['web mocks', 'Web Mock'],
  ['web mock', 'Web Mock'],
  ['bilingual', '中英文'],
  ['desktop', '桌面端'],
  ['netease', '网易云'],
  ['prerelease', '预发布'],
  ['release', '发布'],
  ['routes', '路由'],
  ['route', '路由'],
  ['cache', '缓存'],
  ['toast', '错误提示'],
  ['notes', '说明'],
  ['note', '说明'],
  ['music', '音乐'],
  ['auth', '登录'],
  ['api', 'API'],
];

function createEmptyReleaseChangeSummary(compareUrl = null) {
  return {
    compareUrl,
    added: [],
    changed: [],
    fixed: [],
    other: [],
  };
}

function stripTrailingUrlPunctuation(value) {
  return value.replace(/[),.;!?]+$/, '');
}

function normalizeCommitSubject(message) {
  const lines = String(message || '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return '';
  }

  if (/^merge pull request\b/i.test(lines[0]) && lines[1]) {
    return lines[1];
  }

  return lines[0];
}

function humanizeScope(scope) {
  return String(scope || '')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function containsCjkText(value) {
  return CJK_TEXT_PATTERN.test(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTranslationLookupKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function replaceCaseInsensitive(value, searchValue, replacement) {
  return value.replace(
    new RegExp(escapeRegExp(searchValue), 'gi'),
    replacement
  );
}

function translatePhraseToChinese(value) {
  const trimmedValue = String(value || '').trim();
  if (!trimmedValue || containsCjkText(trimmedValue)) {
    return trimmedValue;
  }

  const normalizedValue = normalizeTranslationLookupKey(trimmedValue);
  const exactTranslation =
    EXACT_RELEASE_CHANGE_TRANSLATIONS_ZH.get(normalizedValue);
  if (exactTranslation) {
    return exactTranslation;
  }

  let translatedValue = trimmedValue;
  RELEASE_CHANGE_PHRASE_TRANSLATIONS_ZH.forEach(
    ([searchValue, replacement]) => {
      translatedValue = replaceCaseInsensitive(
        translatedValue,
        searchValue,
        replacement
      );
    }
  );

  return translatedValue.replace(/\s+/g, ' ').trim();
}

function localizeReleaseChangeScope(scope, locale) {
  if (!scope) {
    return null;
  }

  const normalizedScope = humanizeScope(scope);
  if (!normalizedScope || locale === 'en' || containsCjkText(normalizedScope)) {
    return normalizedScope;
  }

  const exactTranslation = RELEASE_CHANGE_SCOPE_TRANSLATIONS_ZH.get(
    normalizeTranslationLookupKey(normalizedScope)
  );
  if (exactTranslation) {
    return exactTranslation;
  }

  return translatePhraseToChinese(normalizedScope);
}

function joinChineseVerbAndObject(prefix, object) {
  return /^[A-Za-z0-9(]/.test(object)
    ? `${prefix} ${object}`
    : `${prefix}${object}`;
}

function translateReleaseChangeTextToChinese(text) {
  const trimmedText = String(text || '').trim();
  if (!trimmedText || containsCjkText(trimmedText)) {
    return trimmedText;
  }

  const exactTranslation = EXACT_RELEASE_CHANGE_TRANSLATIONS_ZH.get(
    normalizeTranslationLookupKey(trimmedText)
  );
  if (exactTranslation) {
    return exactTranslation;
  }

  const translationRules = [
    {
      pattern: /^replace (.+) with (.+)$/i,
      build: ([, source, target]) =>
        joinChineseVerbAndObject(
          `用${translatePhraseToChinese(target)}替换`,
          translatePhraseToChinese(source)
        ),
    },
    {
      pattern: /^power (.+) with (.+)$/i,
      build: ([, target, source]) =>
        `用${translatePhraseToChinese(source)}驱动${translatePhraseToChinese(
          target
        )}`,
    },
    {
      pattern: /^route (.+) through (.+)$/i,
      build: ([, target, source]) =>
        `通过${translatePhraseToChinese(source)}转发${translatePhraseToChinese(
          target
        )}`,
    },
    {
      pattern: /^move (.+) to (.+)$/i,
      build: ([, target, destination]) =>
        `将${translatePhraseToChinese(target)}移到${translatePhraseToChinese(
          destination
        )}`,
    },
    {
      pattern: /^restore (.+)$/i,
      build: ([, target]) =>
        joinChineseVerbAndObject('恢复', translatePhraseToChinese(target)),
    },
    {
      pattern: /^recover (.+)$/i,
      build: ([, target]) =>
        joinChineseVerbAndObject('恢复', translatePhraseToChinese(target)),
    },
    {
      pattern: /^avoid (.+)$/i,
      build: ([, target]) =>
        joinChineseVerbAndObject('避免', translatePhraseToChinese(target)),
    },
    {
      pattern: /^add (.+)$/i,
      build: ([, target]) =>
        joinChineseVerbAndObject('增加', translatePhraseToChinese(target)),
    },
    {
      pattern: /^reuse (.+)$/i,
      build: ([, target]) =>
        joinChineseVerbAndObject('复用', translatePhraseToChinese(target)),
    },
    {
      pattern: /^update (.+)$/i,
      build: ([, target]) =>
        joinChineseVerbAndObject('调整', translatePhraseToChinese(target)),
    },
    {
      pattern: /^persist (.+)$/i,
      build: ([, target]) =>
        joinChineseVerbAndObject('持久化', translatePhraseToChinese(target)),
    },
    {
      pattern: /^sync (.+)$/i,
      build: ([, target]) =>
        joinChineseVerbAndObject('同步', translatePhraseToChinese(target)),
    },
    {
      pattern: /^compact (.+)$/i,
      build: ([, target]) =>
        joinChineseVerbAndObject('精简', translatePhraseToChinese(target)),
    },
    {
      pattern: /^support (.+)$/i,
      build: ([, target]) =>
        joinChineseVerbAndObject('支持', translatePhraseToChinese(target)),
    },
  ];

  for (const rule of translationRules) {
    const match = trimmedText.match(rule.pattern);
    if (match) {
      return rule.build(match).replace(/\s+/g, ' ').trim();
    }
  }

  return translatePhraseToChinese(trimmedText);
}

function localizeReleaseChangeText(text, locale) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText || locale === 'en') {
    return normalizedText;
  }

  return translateReleaseChangeTextToChinese(normalizedText);
}

function classifyReleaseChangeText(text) {
  const normalizedText = String(text || '').toLowerCase();

  if (
    normalizedText.includes('fix') ||
    normalizedText.includes('bug') ||
    normalizedText.includes('hotfix') ||
    normalizedText.includes('repair') ||
    normalizedText.includes('修复')
  ) {
    return 'fixed';
  }

  if (
    normalizedText.includes('feat') ||
    normalizedText.includes('add') ||
    normalizedText.includes('support') ||
    normalizedText.includes('introduce') ||
    normalizedText.includes('新增')
  ) {
    return 'added';
  }

  return 'changed';
}

function summarizeCommitMessage(message, locale) {
  const subject = normalizeCommitSubject(message);
  if (!subject) {
    return null;
  }

  const conventionalCommitMatch = subject.match(CONVENTIONAL_COMMIT_PATTERN);
  if (!conventionalCommitMatch) {
    return {
      bucket: classifyReleaseChangeText(subject),
      text: localizeReleaseChangeText(subject, locale),
    };
  }

  const [, rawType, rawScope, , rawDescription] = conventionalCommitMatch;
  const type = rawType.toLowerCase();
  const description = rawDescription.trim();
  const localizedScope = localizeReleaseChangeScope(rawScope?.trim(), locale);
  const prefix = localizedScope
    ? locale === 'en'
      ? `${localizedScope}: `
      : `${localizedScope}：`
    : '';

  let bucket = 'other';
  switch (type) {
    case 'feat':
      bucket = 'added';
      break;
    case 'fix':
      bucket = 'fixed';
      break;
    case 'perf':
    case 'refactor':
    case 'style':
      bucket = 'changed';
      break;
    case 'docs':
    case 'test':
    case 'build':
    case 'ci':
    case 'chore':
    case 'revert':
      bucket = 'other';
      break;
    default:
      bucket = classifyReleaseChangeText(description);
      break;
  }

  return {
    bucket,
    text: `${prefix}${localizeReleaseChangeText(description, locale)}`,
  };
}

function pushUniqueReleaseChange(summary, bucket, text) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) {
    return;
  }

  if (summary[bucket].includes(normalizedText)) {
    return;
  }

  summary[bucket].push(normalizedText);
}

function normalizeReleaseChangeSummary(summary) {
  return {
    ...summary,
    added: [...summary.added],
    changed: [...summary.changed],
    fixed: [...summary.fixed],
    other: [...summary.other],
  };
}

function hasDownloadSiteReleaseChangeItems(summary) {
  return Boolean(
    summary &&
      (summary.added.length > 0 ||
        summary.changed.length > 0 ||
        summary.fixed.length > 0 ||
        summary.other.length > 0)
  );
}

function extractDownloadSiteReleaseCompareUrl(notes) {
  const normalizedNotes = typeof notes === 'string' ? notes.trim() : '';
  if (!normalizedNotes) {
    return null;
  }

  const match = normalizedNotes.match(GITHUB_COMPARE_URL_PATTERN);
  if (!match) {
    return null;
  }

  return stripTrailingUrlPunctuation(match[0]);
}

function buildDownloadSiteReleaseChangeSummaryFromNotes(notes, locale = 'en') {
  const normalizedNotes =
    typeof notes === 'string' ? notes.replace(/\r\n?/g, '\n').trim() : '';
  if (!normalizedNotes) {
    return null;
  }

  const compareUrl = extractDownloadSiteReleaseCompareUrl(normalizedNotes);
  const summary = createEmptyReleaseChangeSummary(compareUrl);
  let currentBucket = null;

  normalizedNotes.split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      currentBucket = null;
      return;
    }

    const normalizedLine = line.replace(/^#+\s*/, '').trim();
    const heading = normalizedLine.toLowerCase();

    if (FULL_CHANGELOG_LINE_PATTERN.test(normalizedLine)) {
      return;
    }

    if (heading === "what's changed" || heading === 'whats changed') {
      currentBucket = 'changed';
      return;
    }

    if (
      heading === 'added' ||
      heading === 'new' ||
      heading === '新增' ||
      heading === '新功能'
    ) {
      currentBucket = 'added';
      return;
    }

    if (
      heading === 'changed' ||
      heading === 'improved' ||
      heading === 'changed & improved' ||
      heading === '优化' ||
      heading === '调整' ||
      heading === '改进'
    ) {
      currentBucket = 'changed';
      return;
    }

    if (
      heading === 'fixed' ||
      heading === 'bug fixes' ||
      heading === 'fixes' ||
      heading === '修复' ||
      heading === '问题修复'
    ) {
      currentBucket = 'fixed';
      return;
    }

    const listItemMatch = line.match(/^[-*]\s+(.+)$/);
    if (listItemMatch) {
      const itemText = listItemMatch[1].trim();
      pushUniqueReleaseChange(
        summary,
        currentBucket || classifyReleaseChangeText(itemText),
        localizeReleaseChangeText(itemText, locale)
      );
      return;
    }

    if (!GITHUB_COMPARE_URL_PATTERN.test(line)) {
      pushUniqueReleaseChange(
        summary,
        currentBucket || classifyReleaseChangeText(line),
        localizeReleaseChangeText(line, locale)
      );
    }
  });

  return hasDownloadSiteReleaseChangeItems(summary) || summary.compareUrl
    ? normalizeReleaseChangeSummary(summary)
    : null;
}

function buildDownloadSiteReleaseChangeSummaryFromComparePayload(
  payload,
  compareUrl,
  locale = 'en'
) {
  const summary = createEmptyReleaseChangeSummary(compareUrl);
  const commits = Array.isArray(payload?.commits) ? payload.commits : [];

  commits.forEach((commit) => {
    const commitMessage =
      typeof commit?.commit?.message === 'string'
        ? commit.commit.message.trim()
        : '';
    if (!commitMessage) {
      return;
    }

    const summarizedCommit = summarizeCommitMessage(commitMessage, locale);
    if (!summarizedCommit) {
      return;
    }

    pushUniqueReleaseChange(
      summary,
      summarizedCommit.bucket,
      summarizedCommit.text
    );
  });

  return hasDownloadSiteReleaseChangeItems(summary)
    ? normalizeReleaseChangeSummary(summary)
    : null;
}

function buildLocalizedDownloadSiteReleaseChangeSummaryFromNotes(notes) {
  const englishSummary = buildDownloadSiteReleaseChangeSummaryFromNotes(
    notes,
    'en'
  );
  const chineseSummary = buildDownloadSiteReleaseChangeSummaryFromNotes(
    notes,
    'zh-CN'
  );

  if (!englishSummary && !chineseSummary) {
    return null;
  }

  return {
    en: englishSummary,
    'zh-CN': chineseSummary,
  };
}

function buildLocalizedDownloadSiteReleaseChangeSummaryFromComparePayload(
  payload,
  compareUrl
) {
  const englishSummary =
    buildDownloadSiteReleaseChangeSummaryFromComparePayload(
      payload,
      compareUrl,
      'en'
    );
  const chineseSummary =
    buildDownloadSiteReleaseChangeSummaryFromComparePayload(
      payload,
      compareUrl,
      'zh-CN'
    );

  if (!englishSummary && !chineseSummary) {
    return null;
  }

  return {
    en: englishSummary,
    'zh-CN': chineseSummary,
  };
}

function getDownloadSiteReleaseCompareApiUrl(compareUrl) {
  try {
    const parsedUrl = new URL(compareUrl);
    if (parsedUrl.hostname !== 'github.com') {
      return null;
    }

    const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
    if (pathSegments.length < 4 || pathSegments[2] !== 'compare') {
      return null;
    }

    const [owner, repository, , ...rangeSegments] = pathSegments;
    const range = rangeSegments.join('/');
    if (!owner || !repository || !range) {
      return null;
    }

    return `https://api.github.com/repos/${owner}/${repository}/compare/${range}`;
  } catch {
    return null;
  }
}

function getLocalizedReleaseCompareUrl(localizedSummary) {
  return (
    localizedSummary?.en?.compareUrl ||
    localizedSummary?.['zh-CN']?.compareUrl ||
    null
  );
}

function hasLocalizedReleaseChangeItems(localizedSummary) {
  return Boolean(
    hasDownloadSiteReleaseChangeItems(localizedSummary?.en) ||
      hasDownloadSiteReleaseChangeItems(localizedSummary?.['zh-CN'])
  );
}

function shouldHydrateDownloadSiteReleaseChangeSummary(localizedSummary) {
  return Boolean(
    localizedSummary &&
      getLocalizedReleaseCompareUrl(localizedSummary) &&
      !hasLocalizedReleaseChangeItems(localizedSummary)
  );
}

async function fetchDownloadSiteReleaseComparePayload(compareUrl, fetchImpl) {
  const apiUrl = getDownloadSiteReleaseCompareApiUrl(compareUrl);
  if (!apiUrl) {
    return null;
  }

  const response = await fetchImpl(apiUrl, {
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch release compare details: HTTP ${response.status}`
    );
  }

  return response.json();
}

async function hydrateDownloadSiteReleaseChangeSummaries(
  releases,
  options = {}
) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return releases;
  }

  const hydratedReleases = await Promise.all(
    releases.map(async (release) => {
      if (
        !shouldHydrateDownloadSiteReleaseChangeSummary(release.changeSummary)
      ) {
        return release;
      }

      const compareUrl = getLocalizedReleaseCompareUrl(release.changeSummary);
      if (!compareUrl) {
        return release;
      }

      try {
        const comparePayload = await fetchDownloadSiteReleaseComparePayload(
          compareUrl,
          fetchImpl
        );
        if (!comparePayload) {
          return release;
        }

        const hydratedSummary =
          buildLocalizedDownloadSiteReleaseChangeSummaryFromComparePayload(
            comparePayload,
            compareUrl
          );
        if (!hydratedSummary) {
          return release;
        }

        return {
          ...release,
          changeSummary: hydratedSummary,
        };
      } catch {
        return release;
      }
    })
  );

  return hydratedReleases;
}

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
    changeSummary: buildLocalizedDownloadSiteReleaseChangeSummaryFromNotes(
      release.body
    ),
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
  hydrateDownloadSiteReleaseChangeSummaries,
  normalizeDownloadSiteReleases,
};
