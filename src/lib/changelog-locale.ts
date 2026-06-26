import { type ChangelogLocale } from './changelog';

export const CHANGELOG_LOCALE_STORAGE_KEY =
  'lunatv:version-panel:changelog-locale';

export const CHANGELOG_LOCALE_OPTIONS = [
  {
    label: '中文',
    value: 'zh-CN',
  },
  {
    label: 'English',
    value: 'en',
  },
] as const;

export function normalizeChangelogLocale(
  value: string | null | undefined
): ChangelogLocale {
  return value === 'en' ? 'en' : 'zh-CN';
}

export function readChangelogLocalePreference(): ChangelogLocale {
  if (typeof window === 'undefined') {
    return 'zh-CN';
  }

  return normalizeChangelogLocale(
    window.localStorage.getItem(CHANGELOG_LOCALE_STORAGE_KEY)
  );
}

export function persistChangelogLocalePreference(locale: ChangelogLocale) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(CHANGELOG_LOCALE_STORAGE_KEY, locale);
}
