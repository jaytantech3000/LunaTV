import { changelog } from './changelog';
import {
  buildDesktopReleaseChangeSummaryFromChangelogEntry,
  buildDesktopReleaseChangeSummaryFromComparePayload,
  buildDesktopReleaseChangeSummaryFromNotes,
  extractDesktopReleaseCompareUrl,
  findDesktopReleaseChangelogEntry,
  getDesktopReleaseBaseVersion,
  getDesktopReleaseCompareApiUrl,
} from './desktop-release-notes';

describe('desktop release notes helpers', () => {
  it('extracts the compare url from full changelog notes', () => {
    const compareUrl =
      'https://github.com/jaytantech3000/LunaTV/compare/desktop-v200.0.0-beta.15...desktop-v200.0.0-beta.16';

    expect(
      extractDesktopReleaseCompareUrl(`**Full Changelog**: ${compareUrl}`)
    ).toBe(compareUrl);
    expect(getDesktopReleaseCompareApiUrl(compareUrl)).toBe(
      'https://api.github.com/repos/jaytantech3000/LunaTV/compare/desktop-v200.0.0-beta.15...desktop-v200.0.0-beta.16'
    );
  });

  it('builds grouped summaries from structured release notes', () => {
    const summary = buildDesktopReleaseChangeSummaryFromNotes(`
## Added
- 新增版本卡片摘要

## Fixed
- 修复摘要加载时的重复请求
`);

    expect(summary).toEqual({
      compareUrl: null,
      added: ['新增版本卡片摘要'],
      changed: [],
      fixed: ['修复摘要加载时的重复请求'],
      other: [],
    });
  });

  it('builds localized summaries from changelog entries', () => {
    expect(
      buildDesktopReleaseChangeSummaryFromChangelogEntry(
        changelog.find((entry) => entry.version === '200.0.0'),
        'en'
      )
    ).toEqual({
      compareUrl: null,
      added: [],
      changed: [
        'Desktop versioning now starts from an independent 200.x line.',
        'Desktop updater discovery now uses a dedicated updater manifest branch.',
        'Desktop prerelease builds now follow semver prerelease suffixes such as `200.0.0-beta.1`.',
        'Windows desktop updates now install quietly and restart automatically after confirmation.',
      ],
      fixed: [
        'Avoid conflicting update messages when the in-app updater cannot be used.',
      ],
      other: [],
    });
  });

  it('extracts the stable base version from prerelease versions', () => {
    expect(getDesktopReleaseBaseVersion('200.0.1-beta.5')).toBe('200.0.1');
    expect(getDesktopReleaseBaseVersion('200.0.0')).toBe('200.0.0');
  });

  it('can match an unreleased prerelease line to its stable changelog entry', () => {
    expect(
      findDesktopReleaseChangelogEntry(changelog, {
        releaseVersion: '200.0.1-beta.5',
        allowPrereleaseBaseMatch: true,
      })?.version
    ).toBe('200.0.1');

    expect(
      findDesktopReleaseChangelogEntry(changelog, {
        releaseVersion: '200.0.1-beta.5',
      })
    ).toBeNull();
  });

  it('classifies compare commits into added, changed, fixed, and other groups', () => {
    const compareUrl =
      'https://github.com/jaytantech3000/LunaTV/compare/desktop-v200.0.0-beta.15...desktop-v200.0.0-beta.16';

    expect(
      buildDesktopReleaseChangeSummaryFromComparePayload(
        {
          commits: [
            {
              commit: {
                message: 'feat(desktop): compact desktop release cards',
              },
            },
            {
              commit: {
                message: 'refactor(release): reuse compare parser',
              },
            },
            {
              commit: {
                message: 'fix: avoid stale release compare cache',
              },
            },
            {
              commit: {
                message: 'docs: update prerelease notes flow',
              },
            },
          ],
        },
        compareUrl
      )
    ).toEqual({
      compareUrl,
      added: ['desktop: compact desktop release cards'],
      changed: ['release: reuse compare parser'],
      fixed: ['avoid stale release compare cache'],
      other: ['update prerelease notes flow'],
    });
  });
});
