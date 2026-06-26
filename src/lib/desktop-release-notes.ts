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

interface GithubCompareCommitPayload {
  commit?: {
    message?: string | null;
  } | null;
}

interface GithubComparePayload {
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

function summarizeCommitMessage(message: string): {
  bucket: DesktopReleaseChangeBucket;
  text: string;
} | null {
  const subject = normalizeCommitSubject(message);
  if (!subject) {
    return null;
  }

  const conventionalCommitMatch = subject.match(CONVENTIONAL_COMMIT_PATTERN);
  if (!conventionalCommitMatch) {
    return {
      bucket: classifyReleaseChangeText(subject),
      text: subject,
    };
  }

  const [, rawType, rawScope, , rawDescription] = conventionalCommitMatch;
  const type = rawType.toLowerCase();
  const description = rawDescription.trim();
  const scope = rawScope?.trim();
  const prefix = scope ? `${humanizeScope(scope)}: ` : '';

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

  return {
    bucket,
    text: `${prefix}${description}`,
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
  notes: string | null | undefined
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
      pushUniqueChange(summary, bucket, itemText);
      continue;
    }

    if (!GITHUB_COMPARE_URL_PATTERN.test(line)) {
      const bucket = currentBucket || classifyReleaseChangeText(line);
      pushUniqueChange(summary, bucket, line);
    }
  }

  return hasDesktopReleaseChangeItems(summary) || summary.compareUrl
    ? normalizeSummary(summary)
    : null;
}

export function buildDesktopReleaseChangeSummaryFromComparePayload(
  payload: GithubComparePayload,
  compareUrl: string
): DesktopReleaseChangeSummary | null {
  const summary = createEmptySummary(compareUrl);

  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  commits.forEach((commit) => {
    const commitMessage = commit.commit?.message?.trim();
    if (!commitMessage) {
      return;
    }

    const summarizedCommit = summarizeCommitMessage(commitMessage);
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
  } = {}
): Promise<DesktopReleaseChangeSummary | null> {
  const apiUrl = getDesktopReleaseCompareApiUrl(compareUrl);
  if (!apiUrl) {
    return null;
  }

  const response = await fetch(apiUrl, {
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
    },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch release compare details: HTTP ${response.status}`
    );
  }

  const payload = (await response.json()) as GithubComparePayload;
  return buildDesktopReleaseChangeSummaryFromComparePayload(
    payload,
    compareUrl
  );
}
