import type { AdminConfig } from './admin.types';
import { hashPassword, isHashed, verifyPassword } from './password';
import {
  type ProfileSyncCommitRequest,
  type ProfileSyncCommitResult,
  PROFILE_SYNC_ADMIN_SETTINGS_INITIAL_REVISION,
  PROFILE_SYNC_INITIAL_REVISION,
} from './profile-sync/merge-storage';
import type {
  Favorite,
  FollowRecord,
  IStorage,
  PlayRecord,
  SkipConfig,
} from './types';

interface D1ResultMeta {
  changes?: number;
}

interface D1Result<T> {
  results: T[];
  meta: D1ResultMeta;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: D1ResultMeta }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

type D1DatabaseProvider = () => Promise<D1Database>;

interface ProfileState {
  playRecords: Record<string, PlayRecord>;
  favorites: Record<string, Favorite>;
  follows: Record<string, FollowRecord>;
  searchHistory: string[];
  skipConfigs: Record<string, SkipConfig>;
}

interface ProfileRow {
  data_json: string;
  revision: number;
}

interface AdminStateRow {
  config_json: string | null;
  revision: number;
}

const SEARCH_HISTORY_LIMIT = 20;
const PROFILE_MUTATION_RETRIES = 5;

function emptyProfileState(): ProfileState {
  return {
    playRecords: {},
    favorites: {},
    follows: {},
    searchHistory: [],
    skipConfigs: {},
  };
}

function cloneProfileState(state: ProfileState): ProfileState {
  return JSON.parse(JSON.stringify(state)) as ProfileState;
}

function parseProfileState(value: string): ProfileState {
  try {
    const parsed = JSON.parse(value) as Partial<ProfileState>;
    return {
      playRecords: parsed.playRecords ?? {},
      favorites: parsed.favorites ?? {},
      follows: parsed.follows ?? {},
      searchHistory: Array.isArray(parsed.searchHistory)
        ? parsed.searchHistory.filter(
            (keyword): keyword is string => typeof keyword === 'string'
          )
        : [],
      skipConfigs: parsed.skipConfigs ?? {},
    };
  } catch {
    return emptyProfileState();
  }
}

function parseRevision(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error('Invalid profile revision');
  }

  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) {
    throw new Error('Profile revision exceeds safe integer range');
  }

  return revision;
}

function getChangedCount(result: { meta: D1ResultMeta }): number {
  return result.meta.changes ?? 0;
}

async function getCloudflareD1Database(): Promise<D1Database> {
  const { getCloudflareContext } = await import('@opennextjs/cloudflare');
  const { env } = await getCloudflareContext({ async: true });
  const database = (env as unknown as { MOONTV_DB?: D1Database }).MOONTV_DB;

  if (!database) {
    throw new Error('MOONTV_DB D1 binding is not configured');
  }

  return database;
}

export class D1Storage implements IStorage {
  private databasePromise: Promise<D1Database> | undefined;

  constructor(
    private readonly databaseProvider: D1DatabaseProvider = getCloudflareD1Database
  ) {}

  private getDatabase(): Promise<D1Database> {
    if (!this.databasePromise) {
      this.databasePromise = this.databaseProvider();
    }

    return this.databasePromise;
  }

  private async ensureProfile(
    database: D1Database,
    username: string
  ): Promise<void> {
    await database
      .prepare(
        'INSERT OR IGNORE INTO moontv_profiles (username, data_json, revision) VALUES (?, ?, 0)'
      )
      .bind(username, JSON.stringify(emptyProfileState()))
      .run();
  }

  private async readProfile(
    database: D1Database,
    username: string
  ): Promise<{ state: ProfileState; revision: number }> {
    const row = await database
      .prepare(
        'SELECT data_json, revision FROM moontv_profiles WHERE username = ?'
      )
      .bind(username)
      .first<ProfileRow>();

    if (!row) {
      return { state: emptyProfileState(), revision: 0 };
    }

    return {
      state: parseProfileState(row.data_json),
      revision: Number(row.revision) || 0,
    };
  }

  private async mutateProfile(
    username: string,
    mutation: (state: ProfileState) => void
  ): Promise<void> {
    const database = await this.getDatabase();
    await this.ensureProfile(database, username);

    for (let attempt = 0; attempt < PROFILE_MUTATION_RETRIES; attempt += 1) {
      const current = await this.readProfile(database, username);
      const next = cloneProfileState(current.state);
      mutation(next);

      const result = await database
        .prepare(
          'UPDATE moontv_profiles SET data_json = ?, revision = revision + 1 WHERE username = ? AND revision = ?'
        )
        .bind(JSON.stringify(next), username, current.revision)
        .run();

      if (getChangedCount(result) === 1) {
        return;
      }
    }

    throw new Error('Concurrent profile update could not be committed');
  }

  async getProfileSyncRevision(userName: string): Promise<string> {
    const database = await this.getDatabase();
    const row = await database
      .prepare('SELECT revision FROM moontv_profiles WHERE username = ?')
      .bind(userName)
      .first<{ revision: number }>();

    return String(row?.revision ?? PROFILE_SYNC_INITIAL_REVISION);
  }

  async getAdminSettingsRevision(): Promise<string> {
    const database = await this.getDatabase();
    const row = await database
      .prepare('SELECT revision FROM moontv_admin_state WHERE id = 1')
      .first<{ revision: number }>();

    return String(
      row?.revision ?? PROFILE_SYNC_ADMIN_SETTINGS_INITIAL_REVISION
    );
  }

  async commitProfileSyncMerge(
    request: ProfileSyncCommitRequest
  ): Promise<ProfileSyncCommitResult | null> {
    const database = await this.getDatabase();
    const expectedProfileRevision = parseRevision(request.expectedRevision);
    const nextState = await this.profileStateForSync(request);

    await this.ensureProfile(database, request.username);

    if (!request.adminSettings) {
      const result = await database
        .prepare(
          'UPDATE moontv_profiles SET data_json = ?, revision = revision + 1 WHERE username = ? AND revision = ?'
        )
        .bind(
          JSON.stringify(nextState),
          request.username,
          expectedProfileRevision
        )
        .run();

      if (getChangedCount(result) !== 1) {
        return null;
      }

      return { revision: String(expectedProfileRevision + 1) };
    }

    const expectedAdminRevision = parseRevision(
      request.adminSettings.expectedRevision
    );

    await database
      .prepare(
        'INSERT OR IGNORE INTO moontv_admin_state (id, config_json, revision) VALUES (1, NULL, 0)'
      )
      .run();

    const profileUpdate = database
      .prepare(
        'UPDATE moontv_profiles SET data_json = ?, revision = revision + 1 WHERE username = ? AND revision = ? AND EXISTS (SELECT 1 FROM moontv_admin_state WHERE id = 1 AND revision = ?)'
      )
      .bind(
        JSON.stringify(nextState),
        request.username,
        expectedProfileRevision,
        expectedAdminRevision
      );
    const adminUpdate = database
      .prepare(
        'UPDATE moontv_admin_state SET config_json = ?, revision = revision + 1 WHERE id = 1 AND revision = ? AND EXISTS (SELECT 1 FROM moontv_profiles WHERE username = ? AND revision = ?)'
      )
      .bind(
        JSON.stringify(request.adminSettings.config),
        expectedAdminRevision,
        request.username,
        expectedProfileRevision + 1
      );
    const [profileResult] = await database.batch<unknown>([
      profileUpdate,
      adminUpdate,
    ]);

    if (getChangedCount(profileResult) !== 1) {
      return null;
    }

    return { revision: String(expectedProfileRevision + 1) };
  }

  private async profileStateForSync(
    request: ProfileSyncCommitRequest
  ): Promise<ProfileState> {
    const database = await this.getDatabase();
    const current = await this.readProfile(database, request.username);
    const next = cloneProfileState(current.state);

    if (request.domains.includes('playRecords')) {
      next.playRecords = request.mergedSnapshot.playRecords;
    }
    if (request.domains.includes('favorites')) {
      next.favorites = request.mergedSnapshot.favorites;
    }
    if (request.domains.includes('follows')) {
      next.follows = request.mergedSnapshot.follows;
    }
    if (request.domains.includes('searchHistory')) {
      next.searchHistory = request.mergedSnapshot.searchHistory.slice(
        0,
        SEARCH_HISTORY_LIMIT
      );
    }
    if (request.domains.includes('skipConfigs')) {
      next.skipConfigs = request.mergedSnapshot.skipConfigs;
    }

    return next;
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const database = await this.getDatabase();
    const { state } = await this.readProfile(database, userName);
    return state.playRecords[key] ?? null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await this.mutateProfile(userName, (state) => {
      state.playRecords[key] = record;
    });
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const database = await this.getDatabase();
    const { state } = await this.readProfile(database, userName);
    return state.playRecords;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await this.mutateProfile(userName, (state) => {
      delete state.playRecords[key];
    });
  }

  async deleteAllPlayRecords(userName: string): Promise<void> {
    await this.mutateProfile(userName, (state) => {
      state.playRecords = {};
    });
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const database = await this.getDatabase();
    const { state } = await this.readProfile(database, userName);
    return state.favorites[key] ?? null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await this.mutateProfile(userName, (state) => {
      state.favorites[key] = favorite;
    });
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const database = await this.getDatabase();
    const { state } = await this.readProfile(database, userName);
    return state.favorites;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await this.mutateProfile(userName, (state) => {
      delete state.favorites[key];
    });
  }

  async deleteAllFavorites(userName: string): Promise<void> {
    await this.mutateProfile(userName, (state) => {
      state.favorites = {};
    });
  }

  async getFollowRecord(
    userName: string,
    key: string
  ): Promise<FollowRecord | null> {
    const database = await this.getDatabase();
    const { state } = await this.readProfile(database, userName);
    return state.follows[key] ?? null;
  }

  async setFollowRecord(
    userName: string,
    key: string,
    follow: FollowRecord
  ): Promise<void> {
    await this.mutateProfile(userName, (state) => {
      state.follows[key] = follow;
    });
  }

  async getAllFollowRecords(
    userName: string
  ): Promise<Record<string, FollowRecord>> {
    const database = await this.getDatabase();
    const { state } = await this.readProfile(database, userName);
    return state.follows;
  }

  async deleteFollowRecord(userName: string, key: string): Promise<void> {
    await this.mutateProfile(userName, (state) => {
      delete state.follows[key];
    });
  }

  async deleteAllFollowRecords(userName: string): Promise<void> {
    await this.mutateProfile(userName, (state) => {
      state.follows = {};
    });
  }

  async registerUser(userName: string, password: string): Promise<void> {
    const database = await this.getDatabase();
    const passwordHash = isHashed(password) ? password : hashPassword(password);
    await database
      .prepare(
        'INSERT INTO moontv_users (username, password_hash) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash'
      )
      .bind(userName, passwordHash)
      .run();
    await this.ensureProfile(database, userName);
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const database = await this.getDatabase();
    const row = await database
      .prepare('SELECT password_hash FROM moontv_users WHERE username = ?')
      .bind(userName)
      .first<{ password_hash: string }>();

    if (!row) {
      return false;
    }

    const verified = verifyPassword(password, row.password_hash);
    if (verified && !isHashed(row.password_hash)) {
      await database
        .prepare('UPDATE moontv_users SET password_hash = ? WHERE username = ?')
        .bind(hashPassword(password), userName)
        .run();
    }

    return verified;
  }

  async checkUserExist(userName: string): Promise<boolean> {
    const database = await this.getDatabase();
    const row = await database
      .prepare('SELECT 1 AS exists_value FROM moontv_users WHERE username = ?')
      .bind(userName)
      .first<{ exists_value: number }>();
    return Boolean(row);
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    const database = await this.getDatabase();
    await database
      .prepare('UPDATE moontv_users SET password_hash = ? WHERE username = ?')
      .bind(hashPassword(newPassword), userName)
      .run();
  }

  async deleteUser(userName: string): Promise<void> {
    const database = await this.getDatabase();
    await database.batch<unknown>([
      database
        .prepare('DELETE FROM moontv_users WHERE username = ?')
        .bind(userName),
      database
        .prepare('DELETE FROM moontv_profiles WHERE username = ?')
        .bind(userName),
    ]);
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const database = await this.getDatabase();
    const { state } = await this.readProfile(database, userName);
    return state.searchHistory;
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const normalizedKeyword = keyword.trim();
    if (!normalizedKeyword) {
      return;
    }

    await this.mutateProfile(userName, (state) => {
      state.searchHistory = [
        normalizedKeyword,
        ...state.searchHistory.filter((entry) => entry !== normalizedKeyword),
      ].slice(0, SEARCH_HISTORY_LIMIT);
    });
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    await this.mutateProfile(userName, (state) => {
      if (!keyword) {
        state.searchHistory = [];
        return;
      }

      state.searchHistory = state.searchHistory.filter(
        (entry) => entry !== keyword
      );
    });
  }

  async getAllUsers(): Promise<string[]> {
    const database = await this.getDatabase();
    const result = await database
      .prepare('SELECT username FROM moontv_users ORDER BY username ASC')
      .all<{ username: string }>();
    return result.results.map((row) => row.username);
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const database = await this.getDatabase();
    const row = await database
      .prepare('SELECT config_json FROM moontv_admin_state WHERE id = 1')
      .first<AdminStateRow>();

    if (!row?.config_json) {
      return null;
    }

    try {
      return JSON.parse(row.config_json) as AdminConfig;
    } catch {
      throw new Error('Stored admin configuration is invalid JSON');
    }
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    const database = await this.getDatabase();
    await database
      .prepare(
        'INSERT INTO moontv_admin_state (id, config_json, revision) VALUES (1, ?, 1) ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, revision = moontv_admin_state.revision + 1'
      )
      .bind(JSON.stringify(config))
      .run();
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    const database = await this.getDatabase();
    const { state } = await this.readProfile(database, userName);
    return state.skipConfigs[`${source}+${id}`] ?? null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    await this.mutateProfile(userName, (state) => {
      state.skipConfigs[`${source}+${id}`] = config;
    });
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await this.mutateProfile(userName, (state) => {
      delete state.skipConfigs[`${source}+${id}`];
    });
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<Record<string, SkipConfig>> {
    const database = await this.getDatabase();
    const { state } = await this.readProfile(database, userName);
    return state.skipConfigs;
  }

  async clearAllData(): Promise<void> {
    const database = await this.getDatabase();
    await database.batch<unknown>([
      database.prepare('DELETE FROM moontv_users'),
      database.prepare('DELETE FROM moontv_profiles'),
      database.prepare('DELETE FROM moontv_admin_state'),
    ]);
  }
}
