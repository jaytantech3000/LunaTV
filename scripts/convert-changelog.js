#!/usr/bin / env node

/* eslint-disable */

const fs = require('fs');
const path = require('path');

function parseChangelog(content) {
  const lines = content.split('\n');
  const versions = [];
  let currentVersion = null;
  let currentSection = null;
  let inVersionContent = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // 匹配版本行: ## [X.Y.Z] - YYYY-MM-DD
    const versionMatch = trimmedLine.match(
      /^## \[([0-9A-Za-z.-]+)\] - (\d{4}-\d{2}-\d{2})$/
    );
    if (versionMatch) {
      if (currentVersion) {
        versions.push(currentVersion);
      }

      currentVersion = {
        version: versionMatch[1],
        date: versionMatch[2],
        added: [],
        changed: [],
        fixed: [],
        content: [], // 用于存储原始内容，当没有分类时使用
      };
      currentSection = null;
      inVersionContent = true;
      continue;
    }

    // 如果遇到下一个版本或到达文件末尾，停止处理当前版本
    if (inVersionContent && currentVersion) {
      // 匹配章节标题
      if (trimmedLine === '### Added') {
        currentSection = 'added';
        continue;
      } else if (trimmedLine === '### Changed') {
        currentSection = 'changed';
        continue;
      } else if (trimmedLine === '### Fixed') {
        currentSection = 'fixed';
        continue;
      }

      // 匹配条目: - 内容
      if (trimmedLine.startsWith('- ') && currentSection) {
        const entry = trimmedLine.substring(2);
        currentVersion[currentSection].push(entry);
      } else if (
        trimmedLine &&
        !trimmedLine.startsWith('#') &&
        !trimmedLine.startsWith('###')
      ) {
        currentVersion.content.push(trimmedLine);
      }
    }
  }

  // 添加最后一个版本
  if (currentVersion) {
    versions.push(currentVersion);
  }

  // 后处理：如果某个版本没有分类内容，但有 content，则将 content 放到 changed 中
  versions.forEach((version) => {
    const hasCategories =
      version.added.length > 0 ||
      version.changed.length > 0 ||
      version.fixed.length > 0;
    if (!hasCategories && version.content.length > 0) {
      version.changed = version.content;
    }
    // 清理 content 字段
    delete version.content;
  });

  return { versions };
}

function escapeTypeScriptString(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function renderEntries(entries, emptyComment) {
  if (entries.length === 0) {
    return `        ${emptyComment}`;
  }

  return entries
    .map((entry) => `        '${escapeTypeScriptString(entry)}',`)
    .join('\n');
}

function pairLocalizedVersions(zhVersions, enVersions) {
  const enVersionMap = new Map(
    enVersions.map((version) => [version.version, version])
  );

  return zhVersions.map((zhVersion) => {
    const enVersion = enVersionMap.get(zhVersion.version);

    if (enVersion && enVersion.date !== zhVersion.date) {
      console.warn(
        `Warning: version ${zhVersion.version} has mismatched dates between CHANGELOG and CHANGELOG.en`
      );
    }

    return {
      version: zhVersion.version,
      date: zhVersion.date,
      zhCN: zhVersion,
      en: enVersion || { ...zhVersion },
    };
  });
}

function generateTypeScript(zhChangelogData, enChangelogData) {
  const entries = pairLocalizedVersions(
    zhChangelogData.versions,
    enChangelogData.versions
  )
    .map((version) => {
      return `  {
    version: '${version.version}',
    date: '${version.date}',
    added: {
      zhCN: [
${renderEntries(version.zhCN.added, '// 无新增内容')}
      ],
      en: [
${renderEntries(version.en.added, '// No added entries')}
      ],
    },
    changed: {
      zhCN: [
${renderEntries(version.zhCN.changed, '// 无变更内容')}
      ],
      en: [
${renderEntries(version.en.changed, '// No changed entries')}
      ],
    },
    fixed: {
      zhCN: [
${renderEntries(version.zhCN.fixed, '// 无修复内容')}
      ],
      en: [
${renderEntries(version.en.fixed, '// No fixed entries')}
      ],
    },
  }`;
    })
    .join(',\n');

  return `// 此文件由 scripts/convert-changelog.js 自动生成
// 请勿手动编辑

export type ChangelogLocale = 'zh-CN' | 'en';

export interface LocalizedChangelogItems {
  zhCN: string[];
  en: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  added: LocalizedChangelogItems;
  changed: LocalizedChangelogItems;
  fixed: LocalizedChangelogItems;
}

export function getLocalizedChangelogItems(
  items: LocalizedChangelogItems,
  locale: ChangelogLocale
) {
  if (locale === 'en') {
    return items.en.length > 0 ? items.en : items.zhCN;
  }

  return items.zhCN.length > 0 ? items.zhCN : items.en;
}

export const changelog: ChangelogEntry[] = [
${entries}
];

export default changelog;
`;
}

function updateVersionFile(version) {
  const versionTxtPath = path.join(process.cwd(), 'VERSION.txt');
  try {
    fs.writeFileSync(versionTxtPath, version, 'utf8');
    console.log(`✅ 已更新 VERSION.txt: ${version}`);
  } catch (error) {
    console.error(`❌ 无法更新 VERSION.txt:`, error.message);
    process.exit(1);
  }
}

function updateVersionTs(version) {
  const versionTsPath = path.join(process.cwd(), 'src/lib/version.ts');
  try {
    let content = fs.readFileSync(versionTsPath, 'utf8');

    // 替换 CURRENT_VERSION 常量
    const updatedContent = content.replace(
      /const CURRENT_VERSION = ['"`][^'"`]+['"`];/,
      `const CURRENT_VERSION = '${version}';`
    );

    fs.writeFileSync(versionTsPath, updatedContent, 'utf8');
    console.log(`✅ 已更新 version.ts: ${version}`);
  } catch (error) {
    console.error(`❌ 无法更新 version.ts:`, error.message);
    process.exit(1);
  }
}

function updateJsonVersion(filePath, version, label) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const document = JSON.parse(content);
    document.version = version;
    fs.writeFileSync(
      filePath,
      `${JSON.stringify(document, null, 2)}\n`,
      'utf8'
    );
    console.log(`Updated ${label}: ${version}`);
  } catch (error) {
    console.error(`Failed to update ${label}:`, error.message);
    process.exit(1);
  }
}

function updateWorkspaceCargoVersion(version) {
  const cargoTomlPath = path.join(process.cwd(), 'Cargo.toml');
  try {
    const content = fs.readFileSync(cargoTomlPath, 'utf8');
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    let inWorkspacePackage = false;
    let updated = false;

    const updatedLines = lines.map((line) => {
      const trimmedLine = line.trim();

      if (/^\[.*\]$/.test(trimmedLine)) {
        inWorkspacePackage = trimmedLine === '[workspace.package]';
        return line;
      }

      if (inWorkspacePackage && /^\s*version\s*=\s*"/.test(line) && !updated) {
        updated = true;
        return line.replace(/(\s*version\s*=\s*")[^"]+(".*)/, `$1${version}$2`);
      }

      return line;
    });

    if (!updated) {
      throw new Error('Could not find [workspace.package] version field');
    }

    fs.writeFileSync(cargoTomlPath, updatedLines.join(eol), 'utf8');
    console.log(`Updated Cargo.toml(workspace): ${version}`);
  } catch (error) {
    console.error(`Failed to update Cargo.toml(workspace):`, error.message);
    process.exit(1);
  }
}

function syncRuntimeVersion(version) {
  updateVersionTs(version);
  updateJsonVersion(
    path.join(process.cwd(), 'package.json'),
    version,
    'package.json'
  );
  updateJsonVersion(
    path.join(process.cwd(), 'src-tauri/tauri.conf.json'),
    version,
    'src-tauri/tauri.conf.json'
  );
  updateWorkspaceCargoVersion(version);
}

function main() {
  try {
    const changelogPath = path.join(process.cwd(), 'CHANGELOG');
    const changelogEnPath = path.join(process.cwd(), 'CHANGELOG.en');
    const outputPath = path.join(process.cwd(), 'src/lib/changelog.ts');

    console.log('正在读取 CHANGELOG 文件...');
    const changelogContent = fs.readFileSync(changelogPath, 'utf-8');
    const changelogEnContent = fs.existsSync(changelogEnPath)
      ? fs.readFileSync(changelogEnPath, 'utf-8')
      : changelogContent;

    console.log('正在解析 CHANGELOG 内容...');
    const changelogData = parseChangelog(changelogContent);
    const changelogEnData = parseChangelog(changelogEnContent);

    if (changelogData.versions.length === 0) {
      console.error('❌ 未在 CHANGELOG 中找到任何版本');
      process.exit(1);
    }

    // 获取最新版本号（CHANGELOG中的第一个版本）
    const latestVersion = changelogData.versions[0].version;
    console.log(`🔢 最新版本: ${latestVersion}`);

    console.log('正在生成 TypeScript 文件...');
    const tsContent = generateTypeScript(changelogData, changelogEnData);

    // 确保输出目录存在
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, tsContent, 'utf-8');

    // 读取 VERSION.txt 并同步到 version.ts
    const versionTxtPath = path.join(process.cwd(), 'VERSION.txt');
    const versionFromFile = fs.readFileSync(versionTxtPath, 'utf8').trim();
    console.log(`📄 VERSION.txt 版本: ${versionFromFile}`);
    syncRuntimeVersion(versionFromFile);

    // 检查是否在 GitHub Actions 环境中运行
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

    if (isGitHubActions) {
      // 在 GitHub Actions 中，更新 VERSION.txt 为 CHANGELOG 最新版本
      console.log('正在更新 VERSION.txt...');
      updateVersionFile(latestVersion);
      syncRuntimeVersion(latestVersion);
    }

    console.log(`✅ 成功生成 ${outputPath}`);
    console.log(`📊 版本统计:`);
    changelogData.versions.forEach((version) => {
      console.log(
        `   ${version.version} (${version.date}): +${version.added.length} ~${version.changed.length} !${version.fixed.length}`
      );
    });

    console.log('\n🎉 转换完成!');
  } catch (error) {
    console.error('❌ 转换失败:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
