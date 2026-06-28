/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import type { SavedMusicCollectionRecord } from '@/features/music/services/music-collection-profile-records';
import type { MusicPreferences } from '@/features/music/services/music-preferences-records';
import type {
  MusicFavoriteRecord,
  MusicPlayRecord,
  MusicRecentTrackRecord,
} from '@/features/music/services/music-profile-records';

import { AdminConfig } from './admin.types';
import { KvrocksStorage } from './kvrocks.db';
import { RedisStorage } from './redis.db';
import { getConfiguredStorageType } from './runtime/storage-mode';
import {
  Favorite,
  FollowRecord,
  IStorage,
  PlayRecord,
  SkipConfig,
} from './types';
import { UpstashRedisStorage } from './upstash.db';

const STORAGE_TYPE = getConfiguredStorageType();

// 创建存储实例
function createStorage(): IStorage {
  switch (STORAGE_TYPE) {
    case 'redis':
      return new RedisStorage();
    case 'upstash':
      return new UpstashRedisStorage();
    case 'kvrocks':
      return new KvrocksStorage();
    case 'localstorage':
    default:
      return null as unknown as IStorage;
  }
}

// 单例存储实例
let storageInstance: IStorage | null = null;

function getStorage(): IStorage {
  if (!storageInstance) {
    storageInstance = createStorage();
  }
  return storageInstance;
}

// 工具函数：生成存储key
export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

// 导出便捷方法
export class DbManager {
  private storage: IStorage;
  private migrationPromise: Promise<void> | null = null;

  constructor() {
    this.storage = getStorage();
    // 启动时自动触发数据迁移（异步，不阻塞构造）
    if (this.storage && typeof this.storage.migrateData === 'function') {
      this.migrationPromise = this.storage
        .migrateData()
        .then(async () => {
          // 数据结构迁移完成后，执行密码哈希迁移
          if (typeof this.storage.migratePasswords === 'function') {
            await this.storage.migratePasswords();
          }
        })
        .catch((err) => {
          console.error('数据迁移异常:', err);
        });
    }
  }

  /** 等待迁移完成（内部方法，首次调用后 migrationPromise 会被置空） */
  private async ensureMigrated(): Promise<void> {
    if (this.migrationPromise) {
      await this.migrationPromise;
      this.migrationPromise = null;
    }
  }

  // 音乐播放记录相关方法
  async getAllMusicPlayRecords(userName: string): Promise<{
    [key: string]: MusicPlayRecord;
  }> {
    await this.ensureMigrated();
    return this.storage.getAllMusicPlayRecords(userName);
  }

  async saveMusicPlayRecord(
    userName: string,
    source: string,
    id: string,
    record: MusicPlayRecord
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setMusicPlayRecord(userName, key, record);
  }

  async deleteMusicPlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deleteMusicPlayRecord(userName, key);
  }

  async deleteAllMusicPlayRecords(userName: string): Promise<void> {
    await this.storage.deleteAllMusicPlayRecords(userName);
  }

  // 音乐收藏相关方法
  async getAllMusicFavorites(
    userName: string
  ): Promise<{ [key: string]: MusicFavoriteRecord }> {
    await this.ensureMigrated();
    return this.storage.getAllMusicFavorites(userName);
  }

  async saveMusicFavorite(
    userName: string,
    source: string,
    id: string,
    favorite: MusicFavoriteRecord
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setMusicFavorite(userName, key, favorite);
  }

  async deleteMusicFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deleteMusicFavorite(userName, key);
  }

  async deleteAllMusicFavorites(userName: string): Promise<void> {
    await this.storage.deleteAllMusicFavorites(userName);
  }

  // 音乐最近播放相关方法
  async getMusicRecentTracks(
    userName: string
  ): Promise<MusicRecentTrackRecord[]> {
    await this.ensureMigrated();
    return this.storage.getMusicRecentTracks(userName);
  }

  async saveMusicRecentTracks(
    userName: string,
    records: MusicRecentTrackRecord[]
  ): Promise<void> {
    await this.storage.setMusicRecentTracks(userName, records);
  }

  async deleteAllMusicRecentTracks(userName: string): Promise<void> {
    await this.storage.deleteAllMusicRecentTracks(userName);
  }

  // 音乐搜索历史相关方法
  async getMusicSearchHistory(userName: string): Promise<string[]> {
    await this.ensureMigrated();
    return this.storage.getMusicSearchHistory(userName);
  }

  async addMusicSearchHistory(userName: string, query: string): Promise<void> {
    await this.storage.addMusicSearchHistory(userName, query);
  }

  async deleteMusicSearchHistory(
    userName: string,
    query?: string
  ): Promise<void> {
    await this.storage.deleteMusicSearchHistory(userName, query);
  }

  async getMusicPreferences(
    userName: string
  ): Promise<MusicPreferences | null> {
    await this.ensureMigrated();
    return this.storage.getMusicPreferences(userName);
  }

  async saveMusicPreferences(
    userName: string,
    preferences: MusicPreferences
  ): Promise<void> {
    await this.storage.setMusicPreferences(userName, preferences);
  }

  // 音乐已保存合集相关方法
  async getAllMusicCollections(
    userName: string
  ): Promise<{ [key: string]: SavedMusicCollectionRecord }> {
    await this.ensureMigrated();
    return this.storage.getAllMusicCollections(userName);
  }

  async saveMusicCollection(
    userName: string,
    source: string,
    id: string,
    record: SavedMusicCollectionRecord
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setMusicCollection(userName, key, record);
  }

  async deleteMusicCollection(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deleteMusicCollection(userName, key);
  }

  async deleteAllMusicCollections(userName: string): Promise<void> {
    await this.storage.deleteAllMusicCollections(userName);
  }

  // 播放记录相关方法
  async getPlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<PlayRecord | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getPlayRecord(userName, key);
  }

  async savePlayRecord(
    userName: string,
    source: string,
    id: string,
    record: PlayRecord
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setPlayRecord(userName, key, record);
  }

  async getAllPlayRecords(userName: string): Promise<{
    [key: string]: PlayRecord;
  }> {
    await this.ensureMigrated();
    return this.storage.getAllPlayRecords(userName);
  }

  async deletePlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deletePlayRecord(userName, key);
  }

  async deleteAllPlayRecords(userName: string): Promise<void> {
    await this.storage.deleteAllPlayRecords(userName);
  }

  // 收藏相关方法
  async getFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<Favorite | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getFavorite(userName, key);
  }

  async saveFavorite(
    userName: string,
    source: string,
    id: string,
    favorite: Favorite
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setFavorite(userName, key, favorite);
  }

  async getAllFavorites(
    userName: string
  ): Promise<{ [key: string]: Favorite }> {
    await this.ensureMigrated();
    return this.storage.getAllFavorites(userName);
  }

  async deleteFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deleteFavorite(userName, key);
  }

  async deleteAllFavorites(userName: string): Promise<void> {
    await this.storage.deleteAllFavorites(userName);
  }

  async isFavorited(
    userName: string,
    source: string,
    id: string
  ): Promise<boolean> {
    const favorite = await this.getFavorite(userName, source, id);
    return favorite !== null;
  }

  // 追更相关方法
  async getFollowRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<FollowRecord | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getFollowRecord(userName, key);
  }

  async saveFollowRecord(
    userName: string,
    source: string,
    id: string,
    follow: FollowRecord
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setFollowRecord(userName, key, follow);
  }

  async getAllFollowRecords(userName: string): Promise<{
    [key: string]: FollowRecord;
  }> {
    await this.ensureMigrated();
    return this.storage.getAllFollowRecords(userName);
  }

  async deleteFollowRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deleteFollowRecord(userName, key);
  }

  async deleteAllFollowRecords(userName: string): Promise<void> {
    await this.storage.deleteAllFollowRecords(userName);
  }

  // ---------- 用户相关 ----------
  async registerUser(userName: string, password: string): Promise<void> {
    await this.storage.registerUser(userName, password);
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    return this.storage.verifyUser(userName, password);
  }

  // 检查用户是否已存在
  async checkUserExist(userName: string): Promise<boolean> {
    return this.storage.checkUserExist(userName);
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    await this.storage.changePassword(userName, newPassword);
  }

  async deleteUser(userName: string): Promise<void> {
    await this.storage.deleteUser(userName);
  }

  // ---------- 搜索历史 ----------
  async getSearchHistory(userName: string): Promise<string[]> {
    return this.storage.getSearchHistory(userName);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    await this.storage.addSearchHistory(userName, keyword);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    await this.storage.deleteSearchHistory(userName, keyword);
  }

  // 获取全部用户名
  async getAllUsers(): Promise<string[]> {
    if (typeof (this.storage as any).getAllUsers === 'function') {
      return (this.storage as any).getAllUsers();
    }
    return [];
  }

  // ---------- 管理员配置 ----------
  async getAdminConfig(): Promise<AdminConfig | null> {
    if (typeof (this.storage as any).getAdminConfig === 'function') {
      return (this.storage as any).getAdminConfig();
    }
    return null;
  }

  async saveAdminConfig(config: AdminConfig): Promise<void> {
    if (typeof (this.storage as any).setAdminConfig === 'function') {
      await (this.storage as any).setAdminConfig(config);
    }
  }

  // ---------- 跳过片头片尾配置 ----------
  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    if (typeof (this.storage as any).getSkipConfig === 'function') {
      return (this.storage as any).getSkipConfig(userName, source, id);
    }
    return null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    if (typeof (this.storage as any).setSkipConfig === 'function') {
      await (this.storage as any).setSkipConfig(userName, source, id, config);
    }
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    if (typeof (this.storage as any).deleteSkipConfig === 'function') {
      await (this.storage as any).deleteSkipConfig(userName, source, id);
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    if (typeof (this.storage as any).getAllSkipConfigs === 'function') {
      return (this.storage as any).getAllSkipConfigs(userName);
    }
    return {};
  }

  // ---------- 数据清理 ----------
  async clearAllData(): Promise<void> {
    if (typeof (this.storage as any).clearAllData === 'function') {
      await (this.storage as any).clearAllData();
    } else {
      throw new Error('存储类型不支持清空数据操作');
    }
  }
}

// 导出默认实例
export const db = new DbManager();
