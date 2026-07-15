#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import {
  assertValidSemver,
  parseCliArgs,
  parseReleaseVersionFromTag,
  readDesktopReleaseMetadata,
} from './desktop-release-utils.mjs';

function readTopLevelJsonVersionField(filePath, content) {
  const sourceFile = ts.parseJsonText(filePath, content);
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error(`Could not parse JSON in ${filePath}`);
  }

  const rootObject = sourceFile.statements[0]?.expression;
  if (!rootObject || !ts.isObjectLiteralExpression(rootObject)) {
    throw new Error(`Could not find a top-level version field in ${filePath}`);
  }

  const versionProperties = rootObject.properties.filter(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === 'version') ||
        (ts.isStringLiteral(property.name) && property.name.text === 'version'))
  );

  if (
    versionProperties.length !== 1 ||
    !ts.isStringLiteral(versionProperties[0].initializer)
  ) {
    throw new Error(
      `Could not find an unambiguous top-level version field in ${filePath}`
    );
  }

  const versionLiteral = versionProperties[0].initializer;
  return {
    end: versionLiteral.end,
    start: versionLiteral.getStart(sourceFile),
    value: versionLiteral.text,
  };
}

function planJsonVersionWrite(filePath, content, version) {
  const versionField = readTopLevelJsonVersionField(filePath, content);
  if (versionField.value === version) {
    return null;
  }

  return `${content.slice(0, versionField.start)}${JSON.stringify(
    version
  )}${content.slice(versionField.end)}`;
}

function planWorkspaceCargoVersion(content, version) {
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

  const updatedContent = updatedLines.join(eol);
  return content === updatedContent ? null : updatedContent;
}

function readVersionModuleField(filePath, content) {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error(`Could not parse TypeScript in ${filePath}`);
  }

  const versionDeclarations = sourceFile.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement)) {
      return [];
    }

    return statement.declarationList.declarations.filter(
      (declaration) =>
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'CURRENT_VERSION'
    );
  });

  if (versionDeclarations.length === 0) {
    return null;
  }

  if (
    versionDeclarations.length > 1 ||
    !ts.isStringLiteral(versionDeclarations[0].initializer)
  ) {
    throw new Error(
      `Could not find an unambiguous CURRENT_VERSION string in ${filePath}`
    );
  }

  const versionLiteral = versionDeclarations[0].initializer;
  const start = versionLiteral.getStart(sourceFile);
  return {
    end: versionLiteral.end,
    quote: content[start],
    start,
    value: versionLiteral.text,
  };
}

function planVersionModule(filePath, currentContent, version) {
  const versionField = readVersionModuleField(filePath, currentContent);
  if (!versionField) {
    const eol = currentContent.includes('\r\n') ? '\r\n' : '\n';
    return [
      '/* eslint-disable no-console */',
      '',
      `const CURRENT_VERSION = '${version}';`,
      '',
      'export { CURRENT_VERSION };',
      '',
    ].join(eol);
  }

  if (versionField.value === version) {
    return null;
  }

  const versionLiteral =
    versionField.quote === "'" ? `'${version}'` : JSON.stringify(version);
  return `${currentContent.slice(
    0,
    versionField.start
  )}${versionLiteral}${currentContent.slice(versionField.end)}`;
}

function planVersionText(currentContent, version) {
  const eol = currentContent.includes('\r\n') ? '\r\n' : '\n';
  const content = `${version}${eol}`;
  return currentContent === content ? null : content;
}

function resolveVersion(args, metadata) {
  const explicitVersion = args.get('version');
  if (explicitVersion) {
    return assertValidSemver(explicitVersion, 'desktop release version');
  }

  const releaseTag = args.get('tag');
  if (releaseTag) {
    return assertValidSemver(
      parseReleaseVersionFromTag(releaseTag),
      'desktop release version'
    );
  }

  return assertValidSemver(metadata.desktopVersion, 'desktop base version');
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const metadata = await readDesktopReleaseMetadata(projectRoot);
  const version = resolveVersion(args, metadata);

  const packageJsonPath = path.join(projectRoot, 'package.json');
  const tauriConfigPath = path.join(
    projectRoot,
    'src-tauri',
    'tauri.conf.json'
  );
  const cargoTomlPath = path.join(projectRoot, 'Cargo.toml');
  const versionModulePath = path.join(projectRoot, 'src', 'lib', 'version.ts');
  const versionTextPath = path.join(projectRoot, 'VERSION.txt');
  const [
    packageJsonContent,
    tauriConfigContent,
    cargoTomlContent,
    versionModuleContent,
    versionTextContent,
  ] = await Promise.all([
    fs.readFile(packageJsonPath, 'utf8'),
    fs.readFile(tauriConfigPath, 'utf8'),
    fs.readFile(cargoTomlPath, 'utf8'),
    fs.readFile(versionModulePath, 'utf8'),
    fs.readFile(versionTextPath, 'utf8'),
  ]);
  const plannedWrites = [
    [
      packageJsonPath,
      planJsonVersionWrite(packageJsonPath, packageJsonContent, version),
    ],
    [
      tauriConfigPath,
      planJsonVersionWrite(tauriConfigPath, tauriConfigContent, version),
    ],
    [cargoTomlPath, planWorkspaceCargoVersion(cargoTomlContent, version)],
    [
      versionModulePath,
      planVersionModule(versionModulePath, versionModuleContent, version),
    ],
    [versionTextPath, planVersionText(versionTextContent, version)],
  ];

  for (const [filePath, content] of plannedWrites) {
    if (content !== null) {
      await fs.writeFile(filePath, content, 'utf8');
    }
  }

  console.log(`Synced desktop version: ${version}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
