import fs from 'fs';
import path from 'path';

import { AdminConfig } from '@/lib/admin.types';
import { db } from '@/lib/db';

export function readBundledDefaultConfigFile(): string {
  try {
    const examplePath = path.join(process.cwd(), 'config.example.json');
    if (fs.existsSync(examplePath)) {
      return fs.readFileSync(examplePath, 'utf-8');
    }
  } catch (error) {
    // eslint-disable-next-line no-console -- retain the bundled-config read failure for deployment diagnostics.
    console.warn('读取 config.example.json 失败:', error);
  }

  return '';
}

export function shouldBootstrapFromDefaultConfig(
  adminConfig: AdminConfig
): boolean {
  const hasConfigFile = !!adminConfig.ConfigFile?.trim();
  const hasSources = !!adminConfig.SourceConfig?.length;
  const hasCategories = !!adminConfig.CustomCategories?.length;
  const hasLives = !!adminConfig.LiveConfig?.length;

  return !hasConfigFile && !hasSources && !hasCategories && !hasLives;
}

export async function loadStoredAdminConfig(): Promise<AdminConfig | null> {
  try {
    return await db.getAdminConfig();
  } catch (error) {
    // eslint-disable-next-line no-console -- retain storage read failures so operators can diagnose bootstrap fallback.
    console.error('获取管理员配置失败:', error);
    return null;
  }
}

export async function saveStoredAdminConfig(
  adminConfig: AdminConfig
): Promise<void> {
  try {
    await db.saveAdminConfig(adminConfig);
  } catch (error) {
    // eslint-disable-next-line no-console -- retain storage write failures because callers intentionally receive no error result.
    console.error('保存管理员配置失败:', error);
  }
}

export async function loadStoredUsernames(): Promise<string[]> {
  try {
    return await db.getAllUsers();
  } catch (error) {
    // eslint-disable-next-line no-console -- retain user-list read failures so empty-list fallback is observable.
    console.error('获取用户列表失败:', error);
    return [];
  }
}
