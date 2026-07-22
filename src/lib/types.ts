import { AdminConfig } from './admin.types';
import type {
  ProfileSyncCommitRequest,
  ProfileSyncCommitResult,
} from './profile-sync/merge-storage';

// 播放记录数据结构
export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  year: string;
  index: number; // 第几集
  total_episodes: number; // 总集数
  play_time: number; // 播放进度（秒）
  total_time: number; // 总进度（秒）
  save_time: number; // 记录保存时间（时间戳）
  search_title: string; // 搜索时使用的标题
  playback_mode?: 'online' | 'offline';
  offline_content_id?: string;
  is_adult?: boolean;
}

// 收藏数据结构
export interface Favorite {
  source_name: string;
  total_episodes: number; // 总集数
  title: string;
  year: string;
  cover: string;
  save_time: number; // 记录保存时间（时间戳）
  search_title: string; // 搜索时使用的标题
  playback_mode?: 'online' | 'offline';
  offline_content_id?: string;
  is_adult?: boolean;
  origin?: 'vod' | 'live';
}

// 追更数据结构
export interface FollowRecord {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  search_title?: string;
  followed_at: number; // 开启追更时间
  followed_episode_count: number; // 开启追更时的真实集数
  acknowledged_episode_count: number; // 用户已确认看到的最新集数
  latest_episode_count: number; // 最近一次已知的最新集数
  last_checked_at: number; // 最近检查时间
}

// 存储接口
export interface IStorage {
  getProfileSyncRevision(userName: string): Promise<string>;
  commitProfileSyncMerge(
    request: ProfileSyncCommitRequest
  ): Promise<ProfileSyncCommitResult | null>;

  // 播放记录相关
  getPlayRecord(userName: string, key: string): Promise<PlayRecord | null>;
  setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void>;
  getAllPlayRecords(userName: string): Promise<{ [key: string]: PlayRecord }>;
  deletePlayRecord(userName: string, key: string): Promise<void>;
  deleteAllPlayRecords(userName: string): Promise<void>;

  // 收藏相关
  getFavorite(userName: string, key: string): Promise<Favorite | null>;
  setFavorite(userName: string, key: string, favorite: Favorite): Promise<void>;
  getAllFavorites(userName: string): Promise<{ [key: string]: Favorite }>;
  deleteFavorite(userName: string, key: string): Promise<void>;
  deleteAllFavorites(userName: string): Promise<void>;

  // 追更相关
  getFollowRecord(userName: string, key: string): Promise<FollowRecord | null>;
  setFollowRecord(
    userName: string,
    key: string,
    follow: FollowRecord
  ): Promise<void>;
  getAllFollowRecords(userName: string): Promise<{
    [key: string]: FollowRecord;
  }>;
  deleteFollowRecord(userName: string, key: string): Promise<void>;
  deleteAllFollowRecords(userName: string): Promise<void>;

  // 用户相关
  registerUser(userName: string, password: string): Promise<void>;
  verifyUser(userName: string, password: string): Promise<boolean>;
  // 检查用户是否存在（无需密码）
  checkUserExist(userName: string): Promise<boolean>;
  // 修改用户密码
  changePassword(userName: string, newPassword: string): Promise<void>;
  // 删除用户（包括密码、搜索历史、播放记录、收藏夹）
  deleteUser(userName: string): Promise<void>;

  // 搜索历史相关
  getSearchHistory(userName: string): Promise<string[]>;
  addSearchHistory(userName: string, keyword: string): Promise<void>;
  deleteSearchHistory(userName: string, keyword?: string): Promise<void>;

  // 用户列表
  getAllUsers(): Promise<string[]>;

  // 管理员配置相关
  getAdminConfig(): Promise<AdminConfig | null>;
  setAdminConfig(config: AdminConfig): Promise<void>;

  // 跳过片头片尾配置相关
  getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null>;
  setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void>;
  deleteSkipConfig(userName: string, source: string, id: string): Promise<void>;
  getAllSkipConfigs(userName: string): Promise<{ [key: string]: SkipConfig }>;

  // 数据迁移（旧扁平 key → Hash 结构）
  migrateData?(): Promise<void>;

  // 密码迁移（明文 → 加盐哈希）
  migratePasswords?(): Promise<void>;

  // 数据清理相关
  clearAllData(): Promise<void>;
}

// 搜索结果数据结构
export interface SearchResult {
  id: string;
  title: string;
  poster: string;
  episodes: string[];
  episodes_titles: string[];
  remarks?: string;
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
  douban_id?: number;
}

// 豆瓣数据结构
export interface DoubanItem {
  id: string;
  title: string;
  poster: string;
  rate: string;
  year: string;
  playType?: 'movie' | 'tv';
}

export interface DoubanResult {
  code: number;
  message: string;
  list: DoubanItem[];
}

// 跳过片头片尾配置数据结构
export interface SkipConfig {
  enable: boolean; // 是否启用跳过片头片尾
  intro_time: number; // 片头时间（秒）
  outro_time: number; // 片尾时间（秒）
}
