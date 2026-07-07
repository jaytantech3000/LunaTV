(function attachDownloadSite(globalObject, factory) {
  const api = factory(globalObject);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalObject.LunaTVDownloadSite = api;
})(
  typeof window !== 'undefined' ? window : globalThis,
  function createApi(globalObject) {
    const LOCALE_STORAGE_KEY = 'lunatv-download-site:locale';
    const THEME_STORAGE_KEY = 'lunatv-download-site:theme';
    const SYSTEM_DARK_THEME_QUERY = '(prefers-color-scheme: dark)';
    const DATA_URL = './data/releases.json';

    const COPY = {
      'zh-CN': {
        eyebrow: 'LunaTV 桌面下载站',
        heroTitle: 'Build Ledger',
        heroSubtitle:
          '统一查看正式版和预发布版，直接跳转到 GitHub 官方安装包。',
        repoLink: '查看 GitHub Releases',
        releaseSectionTitle: '正式版',
        releaseSectionDescription: '稳定可用的桌面版本。',
        prereleaseSectionTitle: '预发布',
        prereleaseSectionDescription: '用于测试与提前体验的新构建。',
        downloadsTab: '下载列表',
        releaseNotesTab: '发布说明',
        emptyReleaseSection: '暂时没有可用的正式版。',
        emptyPrereleaseSection: '暂时没有可用的预发布版。',
        openRelease: '打开 Release 页面',
        downloadAction: '下载',
        publishedAtLabel: '发布时间',
        unknownPublishedAt: '时间未知',
        generatedAtLabel: '页面数据更新时间',
        loading: '正在读取版本数据...',
        errorTitle: '版本数据加载失败',
        errorBody: '请稍后刷新，或直接前往 GitHub Releases 查看下载。',
        releaseNotesEmpty: '这个版本暂时没有发布说明。',
        changeCompareLabel: '完整对比',
        changeAddedLabel: '新增功能',
        changeChangedLabel: '优化调整',
        changeFixedLabel: '问题修复',
        changeOtherLabel: '其他调整',
        changeCompareOnlyHint:
          '当前 release 只记录了 compare 链接，可通过“完整对比”查看本次提交详情。',
        footerLabel: '最后同步',
        switchToDarkTheme: '切换到暗夜主题',
        switchToLightTheme: '切换到浅色主题',
      },
      en: {
        eyebrow: 'LunaTV Desktop Download Site',
        heroTitle: 'Build Ledger',
        heroSubtitle:
          'Browse stable and prerelease builds in one place and jump straight to the official GitHub installers.',
        repoLink: 'Open GitHub Releases',
        releaseSectionTitle: 'Release',
        releaseSectionDescription: 'Stable desktop builds.',
        prereleaseSectionTitle: 'Prerelease',
        prereleaseSectionDescription:
          'Preview builds for testing and early access.',
        downloadsTab: 'Downloads',
        releaseNotesTab: 'Release Notes',
        emptyReleaseSection: 'No stable builds are available right now.',
        emptyPrereleaseSection: 'No prerelease builds are available right now.',
        openRelease: 'Open Release Page',
        downloadAction: 'Download',
        publishedAtLabel: 'Published',
        unknownPublishedAt: 'Unknown',
        generatedAtLabel: 'Site data updated',
        loading: 'Loading release data...',
        errorTitle: 'Failed to load release data',
        errorBody: 'Refresh later or open GitHub Releases directly.',
        releaseNotesEmpty: 'This release does not include notes yet.',
        changeCompareLabel: 'Full compare',
        changeAddedLabel: 'Added',
        changeChangedLabel: 'Changed',
        changeFixedLabel: 'Fixed',
        changeOtherLabel: 'Other',
        changeCompareOnlyHint:
          'This release only includes a compare link. Use “Full compare” to inspect the commit details.',
        footerLabel: 'Last synced',
        switchToDarkTheme: 'Switch to dark theme',
        switchToLightTheme: 'Switch to light theme',
      },
    };

    function getCopy(locale, key) {
      return COPY[locale][key];
    }

    function createElement(documentRef, tagName, className, textContent) {
      const element = documentRef.createElement(tagName);
      if (className) {
        element.className = className;
      }
      if (textContent !== undefined) {
        element.textContent = textContent;
      }
      return element;
    }

    function readStoredLocale() {
      try {
        const locale = globalObject.localStorage?.getItem(LOCALE_STORAGE_KEY);
        return locale === 'zh-CN' ? 'zh-CN' : 'en';
      } catch (_) {
        return 'en';
      }
    }

    function persistLocale(locale) {
      try {
        globalObject.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
      } catch (_) {
        return;
      }
    }

    function readStoredTheme() {
      try {
        const theme = globalObject.localStorage?.getItem(THEME_STORAGE_KEY);
        return theme === 'dark' || theme === 'light' ? theme : null;
      } catch (_) {
        return null;
      }
    }

    function persistTheme(theme) {
      try {
        globalObject.localStorage?.setItem(THEME_STORAGE_KEY, theme);
      } catch (_) {
        return;
      }
    }

    function resolveSystemTheme() {
      if (typeof globalObject.matchMedia !== 'function') {
        return 'light';
      }

      return globalObject.matchMedia(SYSTEM_DARK_THEME_QUERY).matches
        ? 'dark'
        : 'light';
    }

    function resolveVisitorPlatform() {
      const platformDetails = [
        globalObject.navigator?.userAgentData?.platform,
        globalObject.navigator?.platform,
        globalObject.navigator?.userAgent,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (!platformDetails || /(iphone|ipad|android)/.test(platformDetails)) {
        return 'unknown';
      }

      if (/(win)/.test(platformDetails)) {
        return 'windows';
      }

      if (/(mac|darwin|os x)/.test(platformDetails)) {
        return 'macos';
      }

      if (/(linux|x11)/.test(platformDetails)) {
        return 'linux';
      }

      return 'unknown';
    }

    function assetMatchesPlatform(asset, platform) {
      if (!asset || platform === 'unknown') {
        return false;
      }

      const fileName = String(asset.fileName || '').toLowerCase();
      const platformLabel = String(asset.platformLabel || '').toLowerCase();
      const haystack = `${platformLabel} ${fileName}`;

      if (platform === 'windows') {
        return /windows|\.exe|\.msi|setup/.test(haystack);
      }

      if (platform === 'macos') {
        return /macos|osx|darwin|\.dmg|\.pkg|\.app\.tar\.gz/.test(haystack);
      }

      if (platform === 'linux') {
        return (
          /linux|\.appimage|\.deb|\.rpm/.test(haystack) ||
          (/\.tar\.gz/.test(fileName) &&
            !/\.app\.tar\.gz/.test(fileName) &&
            !/macos|osx|darwin/.test(haystack))
        );
      }

      return false;
    }

    function formatPublishedAt(value, locale) {
      if (!value) {
        return getCopy(locale, 'unknownPublishedAt');
      }

      try {
        return new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }).format(new Date(value));
      } catch (_) {
        return value;
      }
    }

    function formatGeneratedAt(value, locale) {
      if (!value) {
        return '';
      }

      try {
        return new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(value));
      } catch (_) {
        return value;
      }
    }

    function formatFileSize(size, locale) {
      if (!size || !Number.isFinite(size)) {
        return '';
      }

      const units = ['B', 'KB', 'MB', 'GB'];
      let value = size;
      let unitIndex = 0;

      while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
      }

      return `${new Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
        maximumFractionDigits: value >= 10 ? 0 : 1,
      }).format(value)} ${units[unitIndex]}`;
    }

    function splitReleases(releases) {
      return {
        release: releases.filter((release) => !release.prerelease),
        prerelease: releases.filter((release) => release.prerelease),
      };
    }

    function selectReleaseChangeSummary(release, locale) {
      const localizedSummary = release?.changeSummary;
      if (!localizedSummary || typeof localizedSummary !== 'object') {
        return null;
      }

      return (
        localizedSummary[locale] ||
        localizedSummary.en ||
        localizedSummary['zh-CN'] ||
        null
      );
    }

    function createReleaseChangeSummary(documentRef, release, locale) {
      const summary = selectReleaseChangeSummary(release, locale);
      if (!summary) {
        return null;
      }

      const hasSubstantiveChanges = Boolean(
        summary.added?.length ||
          summary.changed?.length ||
          summary.fixed?.length
      );
      const changeGroups = [
        {
          key: 'added',
          label: getCopy(locale, 'changeAddedLabel'),
          items: Array.isArray(summary.added) ? summary.added : [],
        },
        {
          key: 'changed',
          label: getCopy(locale, 'changeChangedLabel'),
          items: Array.isArray(summary.changed) ? summary.changed : [],
        },
        {
          key: 'fixed',
          label: getCopy(locale, 'changeFixedLabel'),
          items: Array.isArray(summary.fixed) ? summary.fixed : [],
        },
        {
          key: 'other',
          label: getCopy(locale, 'changeOtherLabel'),
          items:
            hasSubstantiveChanges || !Array.isArray(summary.other)
              ? []
              : summary.other,
        },
      ].filter((group) => group.items.length > 0);

      if (changeGroups.length === 0 && !summary.compareUrl) {
        return null;
      }

      const container = createElement(
        documentRef,
        'div',
        'release-card__change-summary'
      );

      if (summary.compareUrl) {
        const header = createElement(
          documentRef,
          'div',
          'release-card__change-summary-header'
        );
        const compareLink = createElement(
          documentRef,
          'a',
          'release-card__change-compare',
          getCopy(locale, 'changeCompareLabel')
        );
        compareLink.href = summary.compareUrl;
        compareLink.target = '_blank';
        compareLink.rel = 'noreferrer';
        header.appendChild(compareLink);
        container.appendChild(header);
      }

      if (changeGroups.length > 0) {
        const groups = createElement(
          documentRef,
          'div',
          'release-card__change-groups'
        );

        changeGroups.forEach((group) => {
          const groupElement = createElement(
            documentRef,
            'section',
            'release-card__change-group'
          );
          const label = createElement(
            documentRef,
            'span',
            'release-card__change-group-label',
            group.label
          );
          label.dataset.tone = group.key;

          const list = createElement(
            documentRef,
            'ul',
            'release-card__change-list'
          );
          group.items.forEach((item) => {
            const listItem = createElement(
              documentRef,
              'li',
              'release-card__change-item'
            );
            const dot = createElement(
              documentRef,
              'span',
              'release-card__change-dot'
            );
            dot.dataset.tone = group.key;
            dot.setAttribute('aria-hidden', 'true');
            const text = createElement(
              documentRef,
              'span',
              'release-card__change-text',
              item
            );
            listItem.append(dot, text);
            list.appendChild(listItem);
          });

          groupElement.append(label, list);
          groups.appendChild(groupElement);
        });

        container.appendChild(groups);
        return container;
      }

      const hint = createElement(
        documentRef,
        'p',
        'release-card__change-hint',
        getCopy(locale, 'changeCompareOnlyHint')
      );
      container.appendChild(hint);
      return container;
    }

    function createReleaseNotesContent(documentRef, release, locale) {
      const summary = createReleaseChangeSummary(documentRef, release, locale);
      if (summary) {
        return summary;
      }

      return createElement(
        documentRef,
        'pre',
        'release-card__notes',
        release.notes || getCopy(locale, 'releaseNotesEmpty')
      );
    }

    function createAssetItem(documentRef, asset, locale, visitorPlatform) {
      const item = createElement(documentRef, 'li', 'asset-item');
      const matchesVisitorPlatform = assetMatchesPlatform(
        asset,
        visitorPlatform
      );
      item.dataset.platformMatch = matchesVisitorPlatform ? 'true' : 'false';

      const meta = createElement(documentRef, 'div', 'asset-item__meta');
      const platform = createElement(
        documentRef,
        'span',
        'asset-item__platform',
        asset.platformLabel
      );
      platform.dataset.platformMatch = matchesVisitorPlatform
        ? 'true'
        : 'false';
      const fileName = createElement(
        documentRef,
        'span',
        'asset-item__name',
        asset.fileName
      );
      meta.append(platform, fileName);

      const actions = createElement(documentRef, 'div', 'asset-item__actions');
      const size = createElement(
        documentRef,
        'span',
        'asset-item__size',
        formatFileSize(asset.size, locale)
      );
      const link = createElement(
        documentRef,
        'a',
        'asset-item__link',
        getCopy(locale, 'downloadAction')
      );
      link.href = asset.downloadUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.dataset.platformMatch = matchesVisitorPlatform ? 'true' : 'false';
      actions.append(size, link);

      item.append(meta, actions);
      return item;
    }

    function activateTab(tabButtons, tabPanels, nextTab) {
      tabButtons.forEach((button) => {
        const active = button.dataset.tab === nextTab;
        button.dataset.active = active ? 'true' : 'false';
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });

      tabPanels.forEach((panel) => {
        panel.hidden = panel.dataset.tabPanel !== nextTab;
      });
    }

    function createReleaseCard(documentRef, release, locale, visitorPlatform) {
      const details = createElement(documentRef, 'details', 'release-card');
      const summary = createElement(
        documentRef,
        'summary',
        'release-card__summary'
      );
      const heading = createElement(
        documentRef,
        'div',
        'release-card__heading'
      );
      const name = createElement(
        documentRef,
        'h3',
        'release-card__title',
        release.name
      );
      const version = createElement(
        documentRef,
        'p',
        'release-card__version',
        `v${release.version}`
      );
      heading.append(name, version);

      const meta = createElement(
        documentRef,
        'div',
        'release-card__summary-meta'
      );
      const published = createElement(
        documentRef,
        'span',
        'release-card__published',
        `${getCopy(locale, 'publishedAtLabel')}: ${formatPublishedAt(
          release.publishedAt,
          locale
        )}`
      );
      meta.append(published);

      summary.append(heading, meta);

      const body = createElement(documentRef, 'div', 'release-card__body');
      const actions = createElement(
        documentRef,
        'div',
        'release-card__body-actions'
      );
      const link = createElement(
        documentRef,
        'a',
        'release-card__release-link',
        getCopy(locale, 'openRelease')
      );
      link.href = release.htmlUrl || '#';
      link.target = '_blank';
      link.rel = 'noreferrer';
      actions.appendChild(link);

      const tabs = createElement(documentRef, 'div', 'release-card__tabs');
      const downloadsTab = createElement(
        documentRef,
        'button',
        'release-card__tab',
        getCopy(locale, 'downloadsTab')
      );
      downloadsTab.type = 'button';
      downloadsTab.dataset.tab = 'downloads';

      const notesTab = createElement(
        documentRef,
        'button',
        'release-card__tab',
        getCopy(locale, 'releaseNotesTab')
      );
      notesTab.type = 'button';
      notesTab.dataset.tab = 'notes';
      tabs.append(downloadsTab, notesTab);

      const downloadsPanel = createElement(
        documentRef,
        'div',
        'release-card__panel'
      );
      downloadsPanel.dataset.tabPanel = 'downloads';
      const downloadsHeading = createElement(
        documentRef,
        'h4',
        'release-card__section-heading',
        getCopy(locale, 'downloadsTab')
      );
      const downloadsList = createElement(documentRef, 'ul', 'asset-list');
      release.assets.forEach((asset) => {
        downloadsList.appendChild(
          createAssetItem(documentRef, asset, locale, visitorPlatform)
        );
      });
      downloadsPanel.append(downloadsHeading, downloadsList);

      const notesPanel = createElement(
        documentRef,
        'div',
        'release-card__panel'
      );
      notesPanel.dataset.tabPanel = 'notes';
      const notesHeading = createElement(
        documentRef,
        'h4',
        'release-card__section-heading release-card__notes-heading',
        getCopy(locale, 'releaseNotesTab')
      );
      const notes = createReleaseNotesContent(documentRef, release, locale);
      notesPanel.append(notesHeading, notes);

      const tabButtons = [downloadsTab, notesTab];
      const tabPanels = [downloadsPanel, notesPanel];

      tabButtons.forEach((button) => {
        button.addEventListener('click', () => {
          activateTab(tabButtons, tabPanels, button.dataset.tab || 'downloads');
        });
      });
      activateTab(tabButtons, tabPanels, 'downloads');

      body.append(actions, tabs, downloadsPanel, notesPanel);
      details.append(summary, body);
      return details;
    }

    function renderReleaseSection(
      documentRef,
      slot,
      releases,
      locale,
      visitorPlatform,
      emptyKey
    ) {
      slot.innerHTML = '';

      if (!releases.length) {
        slot.appendChild(
          createElement(
            documentRef,
            'p',
            'empty-state',
            getCopy(locale, emptyKey)
          )
        );
        return;
      }

      releases.forEach((release) => {
        slot.appendChild(
          createReleaseCard(documentRef, release, locale, visitorPlatform)
        );
      });
    }

    function createDownloadSiteApp(documentRef) {
      const storedTheme = readStoredTheme();
      const state = {
        locale: readStoredLocale(),
        theme: storedTheme || resolveSystemTheme(),
        themeSource: storedTheme ? 'user' : 'system',
        visitorPlatform: resolveVisitorPlatform(),
        payload: {
          generatedAt: null,
          repository: 'jaytantech3000/LunaTV',
          releases: [],
        },
      };

      function applyTheme() {
        documentRef.documentElement.dataset.theme = state.theme;
        documentRef.documentElement.style.colorScheme = state.theme;
      }

      function applyCopy() {
        documentRef.documentElement.lang = state.locale;
        documentRef.querySelectorAll('[data-copy]').forEach((element) => {
          const key = element.getAttribute('data-copy');
          if (!key) {
            return;
          }

          element.textContent = getCopy(state.locale, key);
        });

        documentRef
          .querySelectorAll('[data-locale-button]')
          .forEach((button) => {
            const active =
              button.getAttribute('data-locale-button') === state.locale;
            button.setAttribute('data-active', active ? 'true' : 'false');
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
          });

        const repoLink = documentRef.querySelector('[data-role="repo-link"]');
        if (repoLink) {
          repoLink.textContent = getCopy(state.locale, 'repoLink');
        }

        const generatedAt = documentRef.querySelector(
          '[data-role="generated-at"]'
        );
        if (generatedAt) {
          generatedAt.textContent = formatGeneratedAt(
            state.payload.generatedAt,
            state.locale
          );
        }

        const themeToggle = documentRef.querySelector('[data-theme-toggle]');
        if (themeToggle) {
          const nextThemeLabel =
            state.theme === 'dark'
              ? getCopy(state.locale, 'switchToLightTheme')
              : getCopy(state.locale, 'switchToDarkTheme');
          themeToggle.setAttribute('aria-label', nextThemeLabel);
          themeToggle.setAttribute('title', nextThemeLabel);
          themeToggle.setAttribute(
            'aria-pressed',
            state.theme === 'dark' ? 'true' : 'false'
          );
          themeToggle.setAttribute('data-theme-mode', state.theme);
        }
      }

      function render(payload) {
        state.payload = {
          generatedAt: payload.generatedAt || null,
          repository: payload.repository || 'jaytantech3000/LunaTV',
          releases: Array.isArray(payload.releases) ? payload.releases : [],
        };

        const grouped = splitReleases(state.payload.releases);
        const releaseSlot = documentRef.querySelector(
          '[data-slot="release-list"]'
        );
        const prereleaseSlot = documentRef.querySelector(
          '[data-slot="prerelease-list"]'
        );

        if (releaseSlot) {
          renderReleaseSection(
            documentRef,
            releaseSlot,
            grouped.release,
            state.locale,
            state.visitorPlatform,
            'emptyReleaseSection'
          );
        }

        if (prereleaseSlot) {
          renderReleaseSection(
            documentRef,
            prereleaseSlot,
            grouped.prerelease,
            state.locale,
            state.visitorPlatform,
            'emptyPrereleaseSection'
          );
        }

        const repoLink = documentRef.querySelector('[data-role="repo-link"]');
        if (repoLink) {
          repoLink.href = `https://github.com/${state.payload.repository}/releases`;
        }

        applyCopy();
      }

      function setTheme(nextTheme, source) {
        state.theme = nextTheme === 'dark' ? 'dark' : 'light';
        state.themeSource = source === 'system' ? 'system' : 'user';

        if (state.themeSource === 'user') {
          persistTheme(state.theme);
        }

        applyTheme();
        applyCopy();
      }

      function setLocale(locale) {
        state.locale = locale === 'zh-CN' ? 'zh-CN' : 'en';
        persistLocale(state.locale);
        render(state.payload);
      }

      function renderLoading() {
        const releaseSlot = documentRef.querySelector(
          '[data-slot="release-list"]'
        );
        const prereleaseSlot = documentRef.querySelector(
          '[data-slot="prerelease-list"]'
        );
        if (releaseSlot) {
          releaseSlot.innerHTML = `<p class="empty-state">${getCopy(
            state.locale,
            'loading'
          )}</p>`;
        }
        if (prereleaseSlot) {
          prereleaseSlot.innerHTML = '';
        }
        applyCopy();
      }

      function renderError() {
        const releaseSlot = documentRef.querySelector(
          '[data-slot="release-list"]'
        );
        const prereleaseSlot = documentRef.querySelector(
          '[data-slot="prerelease-list"]'
        );
        if (releaseSlot) {
          releaseSlot.innerHTML = `<div class="error-state"><strong>${getCopy(
            state.locale,
            'errorTitle'
          )}</strong><p>${getCopy(state.locale, 'errorBody')}</p></div>`;
        }
        if (prereleaseSlot) {
          prereleaseSlot.innerHTML = '';
        }
        applyCopy();
      }

      async function load() {
        renderLoading();

        try {
          const response = await globalObject.fetch(DATA_URL, {
            cache: 'no-store',
          });
          if (!response.ok) {
            throw new Error(`Failed to fetch release data: ${response.status}`);
          }

          render(await response.json());
        } catch (_) {
          renderError();
        }
      }

      documentRef.querySelectorAll('[data-locale-button]').forEach((button) => {
        button.addEventListener('click', () => {
          setLocale(button.getAttribute('data-locale-button') || 'en');
        });
      });

      const themeToggle = documentRef.querySelector('[data-theme-toggle]');
      if (themeToggle) {
        themeToggle.addEventListener('click', () => {
          setTheme(state.theme === 'dark' ? 'light' : 'dark', 'user');
        });
      }

      if (typeof globalObject.matchMedia === 'function') {
        const colorSchemeMediaQuery = globalObject.matchMedia(
          SYSTEM_DARK_THEME_QUERY
        );
        const applySystemTheme = (event) => {
          if (state.themeSource !== 'system') {
            return;
          }

          setTheme(event.matches ? 'dark' : 'light', 'system');
        };

        if (typeof colorSchemeMediaQuery.addEventListener === 'function') {
          colorSchemeMediaQuery.addEventListener('change', applySystemTheme);
        } else if (typeof colorSchemeMediaQuery.addListener === 'function') {
          colorSchemeMediaQuery.addListener(applySystemTheme);
        }
      }

      applyTheme();
      applyCopy();

      return {
        render,
        setLocale,
        setTheme,
        load,
      };
    }

    function bootstrapDownloadSite() {
      if (!globalObject.document) {
        return;
      }

      const root = globalObject.document.getElementById('download-site-app');
      if (!root) {
        return;
      }

      const app = createDownloadSiteApp(globalObject.document);
      app.load();
    }

    if (globalObject.document) {
      if (globalObject.document.readyState === 'loading') {
        globalObject.document.addEventListener(
          'DOMContentLoaded',
          bootstrapDownloadSite,
          {
            once: true,
          }
        );
      } else {
        bootstrapDownloadSite();
      }
    }

    return {
      COPY,
      createDownloadSiteApp,
    };
  }
);
