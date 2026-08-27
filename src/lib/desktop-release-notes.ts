import {
  type ChangelogEntry,
  type ChangelogLocale,
  getLocalizedChangelogItems,
} from './changelog';
import { compareSemver } from './semver';

export interface DesktopReleaseChangeSummary {
  compareUrl: string | null;
  added: string[];
  changed: string[];
  fixed: string[];
  other: string[];
}

export interface GithubCompareCommitPayload {
  commit?: {
    message?: string | null;
  } | null;
}

export interface GithubComparePayload {
  commits?: GithubCompareCommitPayload[] | null;
}

type DesktopReleaseChangeBucket = keyof Omit<
  DesktopReleaseChangeSummary,
  'compareUrl'
>;

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
  [
    'ignore opennext and wrangler local artifacts',
    '忽略 OpenNext 与 Wrangler 本地产物',
  ],
  ['restore beta release summaries', '恢复 Beta 版本摘要'],
  [
    'stabilize offline download sync and resume',
    '提升离线下载同步与恢复稳定性',
  ],
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

function createEmptySummary(
  compareUrl: string | null = null
): DesktopReleaseChangeSummary {
  return {
    compareUrl,
    added: [],
    changed: [],
    fixed: [],
    other: [],
  };
}

function stripTrailingUrlPunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/, '');
}

function normalizeCommitSubject(message: string): string {
  const lines = message
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

function humanizeScope(scope: string): string {
  return scope.trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

function containsCjkText(value: string): boolean {
  return CJK_TEXT_PATTERN.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTranslationLookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function replaceCaseInsensitive(
  value: string,
  searchValue: string,
  replacement: string
): string {
  return value.replace(
    new RegExp(escapeRegExp(searchValue), 'gi'),
    replacement
  );
}

function translatePhraseToChinese(value: string): string {
  const trimmedValue = value.trim();
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
  for (const [
    searchValue,
    replacement,
  ] of RELEASE_CHANGE_PHRASE_TRANSLATIONS_ZH) {
    translatedValue = replaceCaseInsensitive(
      translatedValue,
      searchValue,
      replacement
    );
  }

  return translatedValue.replace(/\s+/g, ' ').trim();
}

function localizeReleaseChangeScope(
  scope: string | undefined,
  locale: ChangelogLocale
): string | null {
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

function translateReleaseChangeTextToChinese(text: string): string {
  const trimmedText = text.trim();
  if (!trimmedText || containsCjkText(trimmedText)) {
    return trimmedText;
  }

  const exactTranslation = EXACT_RELEASE_CHANGE_TRANSLATIONS_ZH.get(
    normalizeTranslationLookupKey(trimmedText)
  );
  if (exactTranslation) {
    return exactTranslation;
  }

  const translationRules: Array<{
    pattern: RegExp;
    build: (match: RegExpMatchArray) => string;
  }> = [
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

function localizeReleaseChangeText(
  text: string,
  locale: ChangelogLocale
): string {
  const normalizedText = text.trim();
  if (!normalizedText || locale === 'en') {
    return normalizedText;
  }

  return translateReleaseChangeTextToChinese(normalizedText);
}

function joinChineseVerbAndObject(prefix: string, object: string): string {
  return /^[A-Za-z0-9(]/.test(object)
    ? `${prefix} ${object}`
    : `${prefix}${object}`;
}

function classifyReleaseChangeText(text: string): DesktopReleaseChangeBucket {
  const normalized = text.toLowerCase();

  if (
    normalized.includes('fix') ||
    normalized.includes('bug') ||
    normalized.includes('hotfix') ||
    normalized.includes('repair') ||
    normalized.includes('修复')
  ) {
    return 'fixed';
  }

  if (
    normalized.includes('feat') ||
    normalized.includes('add') ||
    normalized.includes('support') ||
    normalized.includes('introduce') ||
    normalized.includes('新增')
  ) {
    return 'added';
  }

  return 'changed';
}

function buildGenericChineseChangeText(
  type: string | null,
  bucket: DesktopReleaseChangeBucket
): string {
  switch (type) {
    case 'feat':
      return '新增相关能力';
    case 'fix':
      return '修复相关问题';
    case 'perf':
      return '优化运行性能';
    case 'refactor':
      return '重构相关实现';
    case 'style':
      return '调整界面与代码样式';
    case 'docs':
      return '更新项目文档';
    case 'test':
      return '补充测试覆盖';
    case 'build':
    case 'ci':
      return '调整构建与发布流程';
    case 'chore':
      return '工程维护与配置调整';
    case 'revert':
      return '回退相关变更';
    default:
      return bucket === 'fixed'
        ? '修复相关问题'
        : bucket === 'added'
        ? '新增相关能力'
        : '调整相关实现';
  }
}

function summarizeCommitMessage(
  message: string,
  locale: ChangelogLocale
): {
  bucket: DesktopReleaseChangeBucket;
  text: string;
} | null {
  const subject = normalizeCommitSubject(message);
  if (!subject) {
    return null;
  }

  const conventionalCommitMatch = subject.match(CONVENTIONAL_COMMIT_PATTERN);
  if (!conventionalCommitMatch) {
    const bucket = classifyReleaseChangeText(subject);
    const localizedText = localizeReleaseChangeText(subject, locale);
    return {
      bucket,
      text:
        locale === 'zh-CN' && !containsCjkText(localizedText)
          ? buildGenericChineseChangeText(null, bucket)
          : localizedText,
    };
  }

  const [, rawType, rawScope, , rawDescription] = conventionalCommitMatch;
  const type = rawType.toLowerCase();
  const description = rawDescription.trim();
  const localizedScope = localizeReleaseChangeScope(rawScope?.trim(), locale);
  const safeLocalizedScope =
    locale === 'zh-CN' && localizedScope && !containsCjkText(localizedScope)
      ? null
      : localizedScope;
  const prefix = safeLocalizedScope
    ? locale === 'en'
      ? `${safeLocalizedScope}: `
      : `${safeLocalizedScope}：`
    : '';

  let bucket: DesktopReleaseChangeBucket = 'other';
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

  const localizedDescription = localizeReleaseChangeText(description, locale);
  return {
    bucket,
    text: `${prefix}${
      locale === 'zh-CN' && !containsCjkText(localizedDescription)
        ? buildGenericChineseChangeText(type, bucket)
        : localizedDescription
    }`,
  };
}

function pushUniqueChange(
  summary: DesktopReleaseChangeSummary,
  bucket: DesktopReleaseChangeBucket,
  text: string
) {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return;
  }

  if (summary[bucket].includes(normalizedText)) {
    return;
  }

  summary[bucket].push(normalizedText);
}

function normalizeSummary(summary: DesktopReleaseChangeSummary) {
  return {
    ...summary,
    added: [...summary.added],
    changed: [...summary.changed],
    fixed: [...summary.fixed],
    other: [...summary.other],
  };
}

export function getDesktopReleaseBaseVersion(
  version: string | null | undefined
): string | null {
  const normalizedVersion = version?.trim();
  if (!normalizedVersion) {
    return null;
  }

  const prereleaseSeparatorIndex = normalizedVersion.indexOf('-');
  const baseVersion =
    prereleaseSeparatorIndex === -1
      ? normalizedVersion
      : normalizedVersion.slice(0, prereleaseSeparatorIndex).trim();

  if (!baseVersion) {
    return null;
  }

  try {
    compareSemver(baseVersion, baseVersion);
    return baseVersion;
  } catch {
    return null;
  }
}

export function findDesktopReleaseChangelogEntry(
  entries: readonly ChangelogEntry[],
  options: {
    releaseVersion: string | null | undefined;
    allowPrereleaseBaseMatch?: boolean;
  }
): ChangelogEntry | null {
  const normalizedReleaseVersion = options.releaseVersion?.trim();
  if (!normalizedReleaseVersion) {
    return null;
  }

  const exactEntry =
    entries.find((entry) => entry.version === normalizedReleaseVersion) || null;
  if (exactEntry) {
    return exactEntry;
  }

  if (!options.allowPrereleaseBaseMatch) {
    return null;
  }

  const baseVersion = getDesktopReleaseBaseVersion(normalizedReleaseVersion);
  if (!baseVersion || baseVersion === normalizedReleaseVersion) {
    return null;
  }

  return entries.find((entry) => entry.version === baseVersion) || null;
}

export function hasDesktopReleaseChangeItems(
  summary: DesktopReleaseChangeSummary | null | undefined
): boolean {
  if (!summary) {
    return false;
  }

  return (
    summary.added.length > 0 ||
    summary.changed.length > 0 ||
    summary.fixed.length > 0 ||
    summary.other.length > 0
  );
}

export function buildDesktopReleaseChangeSummaryFromChangelogEntry(
  entry: ChangelogEntry | null | undefined,
  locale: ChangelogLocale
): DesktopReleaseChangeSummary | null {
  if (!entry) {
    return null;
  }

  const summary = createEmptySummary();

  getLocalizedChangelogItems(entry.added, locale).forEach((item) => {
    pushUniqueChange(summary, 'added', item);
  });
  getLocalizedChangelogItems(entry.changed, locale).forEach((item) => {
    pushUniqueChange(summary, 'changed', item);
  });
  getLocalizedChangelogItems(entry.fixed, locale).forEach((item) => {
    pushUniqueChange(summary, 'fixed', item);
  });

  return hasDesktopReleaseChangeItems(summary)
    ? normalizeSummary(summary)
    : null;
}

export function extractDesktopReleaseCompareUrl(
  notes: string | null | undefined
): string | null {
  const normalizedNotes = notes?.trim();
  if (!normalizedNotes) {
    return null;
  }

  const match = normalizedNotes.match(GITHUB_COMPARE_URL_PATTERN);
  if (!match) {
    return null;
  }

  return stripTrailingUrlPunctuation(match[0]);
}

export function buildDesktopReleaseChangeSummaryFromNotes(
  notes: string | null | undefined,
  locale: ChangelogLocale = 'en'
): DesktopReleaseChangeSummary | null {
  const normalizedNotes = notes?.replace(/\r\n?/g, '\n').trim();
  if (!normalizedNotes) {
    return null;
  }

  const compareUrl = extractDesktopReleaseCompareUrl(normalizedNotes);
  const summary = createEmptySummary(compareUrl);
  let currentBucket: DesktopReleaseChangeBucket | null = null;

  for (const rawLine of normalizedNotes.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      currentBucket = null;
      continue;
    }

    const normalizedLine = line.replace(/^#+\s*/, '').trim();
    const heading = normalizedLine.toLowerCase();

    if (FULL_CHANGELOG_LINE_PATTERN.test(normalizedLine)) {
      continue;
    }

    if (heading === "what's changed" || heading === 'whats changed') {
      currentBucket = 'changed';
      continue;
    }

    if (
      heading === 'added' ||
      heading === 'new' ||
      heading === '新增' ||
      heading === '新功能'
    ) {
      currentBucket = 'added';
      continue;
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
      continue;
    }

    if (
      heading === 'fixed' ||
      heading === 'bug fixes' ||
      heading === 'fixes' ||
      heading === '修复' ||
      heading === '问题修复'
    ) {
      currentBucket = 'fixed';
      continue;
    }

    const listItemMatch = line.match(/^[-*]\s+(.+)$/);
    if (listItemMatch) {
      const itemText = listItemMatch[1].trim();
      const bucket = currentBucket || classifyReleaseChangeText(itemText);
      const localizedText = localizeReleaseChangeText(itemText, locale);
      pushUniqueChange(
        summary,
        bucket,
        locale === 'zh-CN' && !containsCjkText(localizedText)
          ? buildGenericChineseChangeText(null, bucket)
          : localizedText
      );
      continue;
    }

    if (!GITHUB_COMPARE_URL_PATTERN.test(line)) {
      const bucket = currentBucket || classifyReleaseChangeText(line);
      const localizedText = localizeReleaseChangeText(line, locale);
      pushUniqueChange(
        summary,
        bucket,
        locale === 'zh-CN' && !containsCjkText(localizedText)
          ? buildGenericChineseChangeText(null, bucket)
          : localizedText
      );
    }
  }

  return hasDesktopReleaseChangeItems(summary) || summary.compareUrl
    ? normalizeSummary(summary)
    : null;
}

export function buildDesktopReleaseChangeSummaryFromComparePayload(
  payload: GithubComparePayload,
  compareUrl: string,
  locale: ChangelogLocale = 'en'
): DesktopReleaseChangeSummary | null {
  const summary = createEmptySummary(compareUrl);

  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  commits.forEach((commit) => {
    const commitMessage = commit.commit?.message?.trim();
    if (!commitMessage) {
      return;
    }

    const summarizedCommit = summarizeCommitMessage(commitMessage, locale);
    if (!summarizedCommit) {
      return;
    }

    pushUniqueChange(summary, summarizedCommit.bucket, summarizedCommit.text);
  });

  return hasDesktopReleaseChangeItems(summary)
    ? normalizeSummary(summary)
    : null;
}

export function getDesktopReleaseCompareApiUrl(
  compareUrl: string
): string | null {
  try {
    const parsedUrl = new URL(compareUrl);
    if (parsedUrl.hostname !== 'github.com') {
      return null;
    }

    const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
    if (pathSegments.length < 4 || pathSegments[2] !== 'compare') {
      return null;
    }

    const [owner, repo, , ...rangeSegments] = pathSegments;
    const range = rangeSegments.join('/');
    if (!owner || !repo || !range) {
      return null;
    }

    return `https://api.github.com/repos/${owner}/${repo}/compare/${range}`;
  } catch {
    return null;
  }
}

export async function fetchDesktopReleaseChangeSummaryFromCompareUrl(
  compareUrl: string,
  options: {
    signal?: AbortSignal;
    locale?: ChangelogLocale;
  } = {}
): Promise<DesktopReleaseChangeSummary | null> {
  const payload = await fetchDesktopReleaseComparePayloadFromGithub(
    compareUrl,
    options.signal
  );
  return buildDesktopReleaseChangeSummaryFromComparePayload(
    payload,
    compareUrl,
    options.locale ?? 'en'
  );
}

export async function fetchDesktopReleaseComparePayloadFromGithub(
  compareUrl: string,
  signal?: AbortSignal
): Promise<GithubComparePayload> {
  const apiUrl = getDesktopReleaseCompareApiUrl(compareUrl);
  if (!apiUrl) {
    throw new Error('Invalid GitHub release compare URL.');
  }

  const response = await fetch(apiUrl, {
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch release compare details: HTTP ${response.status}`
    );
  }

  return (await response.json()) as GithubComparePayload;
}
