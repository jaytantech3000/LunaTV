/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion */

import { AdminConfig } from './admin.types';
import {
  normalizeAudioSpikeProtectionLevel,
  normalizeBooleanSetting,
  normalizeVisualEnhancementLevel,
} from './player-enhancement-types';
import {
  loadStoredAdminConfig,
  loadStoredUsernames,
  readBundledDefaultConfigFile,
  saveStoredAdminConfig,
  shouldBootstrapFromDefaultConfig,
} from './runtime/config-source';

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
  ua?: string;
  referer?: string;
  disable_ad_filter?: boolean;
}

export interface LiveCfg {
  name: string;
  url: string;
  ua?: string;
  epg?: string; // 节目单
}

interface ConfigFileStruct {
  cache_time?: number;
  api_site?: {
    [key: string]: ApiSite;
  };
  custom_category?: {
    name?: string;
    type: 'movie' | 'tv';
    query: string;
  }[];
  lives?: {
    [key: string]: LiveCfg;
  };
  player_enhancements?: {
    audio_spike_protection_level?: unknown;
    audio_dynamic_protection?: unknown;
    audio_fixed_ceiling?: unknown;
    visual_enhancement_level?: unknown;
    audio_spike_protection?: unknown;
    audio_defaults_migrated_v2?: unknown;
    visual_enhancement?: unknown;
  };
}

export const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    pagePath: '?ac=videolist&wd={query}&pg={page}',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

// 在模块加载时根据环境决定配置来源
let cachedConfig: AdminConfig;

function getDefaultPlayerEnhancementConfig(): NonNullable<
  AdminConfig['PlayerEnhancementConfig']
> {
  const audioSpikeProtectionLevel = normalizeAudioSpikeProtectionLevel(
    process.env.NEXT_PUBLIC_PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL ??
      process.env.NEXT_PUBLIC_PLAYER_AUDIO_SPIKE_PROTECTION,
    'off'
  );
  const audioDynamicProtection = normalizeBooleanSetting(
    process.env.NEXT_PUBLIC_PLAYER_AUDIO_DYNAMIC_PROTECTION,
    audioSpikeProtectionLevel !== 'off'
  );
  const audioFixedCeiling = normalizeBooleanSetting(
    process.env.NEXT_PUBLIC_PLAYER_AUDIO_FIXED_CEILING,
    audioSpikeProtectionLevel !== 'off'
  );
  const visualEnhancementLevel = normalizeVisualEnhancementLevel(
    process.env.NEXT_PUBLIC_PLAYER_VISUAL_ENHANCEMENT_LEVEL ??
      process.env.NEXT_PUBLIC_PLAYER_VISUAL_ENHANCEMENT,
    'off'
  );

  return {
    AudioSpikeProtection: audioSpikeProtectionLevel !== 'off',
    AudioSpikeProtectionLevel: audioSpikeProtectionLevel,
    AudioDynamicProtection: audioDynamicProtection,
    AudioFixedCeiling: audioFixedCeiling,
    VisualEnhancement: visualEnhancementLevel !== 'off',
    VisualEnhancementLevel: visualEnhancementLevel,
  };
}

function matchesLegacyDefaultAudioEnhancementState(params: {
  level: unknown;
  dynamicProtection: unknown;
  fixedCeiling: unknown;
}): boolean {
  const audioSpikeProtectionLevel = normalizeAudioSpikeProtectionLevel(
    params.level,
    'off'
  );
  const audioDynamicProtection = normalizeBooleanSetting(
    params.dynamicProtection,
    audioSpikeProtectionLevel !== 'off'
  );
  const audioFixedCeiling = normalizeBooleanSetting(
    params.fixedCeiling,
    audioSpikeProtectionLevel !== 'off'
  );

  return (
    audioSpikeProtectionLevel === 'standard' &&
    audioDynamicProtection &&
    audioFixedCeiling
  );
}

function migrateLegacyDefaultPlayerEnhancementFileConfig(
  fileConfig: ConfigFileStruct
): boolean {
  const settings = fileConfig.player_enhancements;
  if (!settings) {
    return false;
  }

  if (normalizeBooleanSetting(settings.audio_defaults_migrated_v2, false)) {
    return false;
  }

  if (
    matchesLegacyDefaultAudioEnhancementState({
      level:
        settings.audio_spike_protection_level ??
        settings.audio_spike_protection,
      dynamicProtection: settings.audio_dynamic_protection,
      fixedCeiling: settings.audio_fixed_ceiling,
    })
  ) {
    fileConfig.player_enhancements = {
      ...settings,
      audio_spike_protection_level: 'off',
      audio_spike_protection: false,
      audio_dynamic_protection: false,
      audio_fixed_ceiling: false,
      audio_defaults_migrated_v2: true,
    };

    return true;
  }

  fileConfig.player_enhancements = {
    ...settings,
    audio_defaults_migrated_v2: true,
  };

  return true;
}

function migrateLegacyDefaultPlayerEnhancementConfig(
  config?: AdminConfig['PlayerEnhancementConfig']
): AdminConfig['PlayerEnhancementConfig'] | undefined {
  if (
    !config ||
    !matchesLegacyDefaultAudioEnhancementState({
      level: config.AudioSpikeProtectionLevel ?? config.AudioSpikeProtection,
      dynamicProtection: config.AudioDynamicProtection,
      fixedCeiling: config.AudioFixedCeiling,
    })
  ) {
    return config;
  }

  return {
    ...config,
    AudioSpikeProtection: false,
    AudioSpikeProtectionLevel: 'off',
    AudioDynamicProtection: false,
    AudioFixedCeiling: false,
  };
}

function resolvePlayerEnhancementConfig(
  fileConfig: ConfigFileStruct,
  fallbackConfig?: AdminConfig['PlayerEnhancementConfig']
): NonNullable<AdminConfig['PlayerEnhancementConfig']> {
  const defaultConfig = getDefaultPlayerEnhancementConfig();
  const fallbackAudioLevel = normalizeAudioSpikeProtectionLevel(
    fallbackConfig?.AudioSpikeProtectionLevel ??
      fallbackConfig?.AudioSpikeProtection ??
      defaultConfig.AudioSpikeProtectionLevel,
    defaultConfig.AudioSpikeProtectionLevel
  );
  const fallbackAudioDynamicProtection = normalizeBooleanSetting(
    fallbackConfig?.AudioDynamicProtection,
    fallbackAudioLevel !== 'off'
  );
  const fallbackAudioFixedCeiling = normalizeBooleanSetting(
    fallbackConfig?.AudioFixedCeiling,
    fallbackAudioLevel !== 'off'
  );
  const fallbackVisualLevel = normalizeVisualEnhancementLevel(
    fallbackConfig?.VisualEnhancementLevel ??
      fallbackConfig?.VisualEnhancement ??
      defaultConfig.VisualEnhancementLevel,
    defaultConfig.VisualEnhancementLevel
  );
  const audioSpikeProtectionLevel = normalizeAudioSpikeProtectionLevel(
    fileConfig.player_enhancements?.audio_spike_protection_level ??
      fileConfig.player_enhancements?.audio_spike_protection ??
      fallbackAudioLevel,
    fallbackAudioLevel
  );
  const hasExplicitAudioLevel =
    fileConfig.player_enhancements?.audio_spike_protection_level !==
      undefined ||
    fileConfig.player_enhancements?.audio_spike_protection !== undefined;
  const audioDynamicProtection = normalizeBooleanSetting(
    fileConfig.player_enhancements?.audio_dynamic_protection,
    hasExplicitAudioLevel
      ? audioSpikeProtectionLevel !== 'off'
      : fallbackAudioDynamicProtection
  );
  const audioFixedCeiling = normalizeBooleanSetting(
    fileConfig.player_enhancements?.audio_fixed_ceiling,
    hasExplicitAudioLevel
      ? audioSpikeProtectionLevel !== 'off'
      : fallbackAudioFixedCeiling
  );
  const visualEnhancementLevel = normalizeVisualEnhancementLevel(
    fileConfig.player_enhancements?.visual_enhancement_level ??
      fileConfig.player_enhancements?.visual_enhancement ??
      fallbackVisualLevel,
    fallbackVisualLevel
  );

  return {
    AudioSpikeProtection: audioSpikeProtectionLevel !== 'off',
    AudioSpikeProtectionLevel: audioSpikeProtectionLevel,
    AudioDynamicProtection: audioDynamicProtection,
    AudioFixedCeiling: audioFixedCeiling,
    VisualEnhancement: visualEnhancementLevel !== 'off',
    VisualEnhancementLevel: visualEnhancementLevel,
  };
}

// 从配置文件补充管理员配置
export function refineConfig(adminConfig: AdminConfig): AdminConfig {
  let fileConfig: ConfigFileStruct;
  try {
    fileConfig = JSON.parse(adminConfig.ConfigFile) as ConfigFileStruct;
  } catch (e) {
    fileConfig = {} as ConfigFileStruct;
  }

  const fileConfigMigrated =
    migrateLegacyDefaultPlayerEnhancementFileConfig(fileConfig);
  adminConfig.PlayerEnhancementConfig =
    migrateLegacyDefaultPlayerEnhancementConfig(
      adminConfig.PlayerEnhancementConfig
    );
  if (fileConfigMigrated) {
    adminConfig.ConfigFile = JSON.stringify(fileConfig, null, 2);
  }

  // 合并文件中的源信息
  const apiSitesFromFile = Object.entries(fileConfig.api_site || []);
  const currentApiSites = new Map(
    (adminConfig.SourceConfig || []).map((s) => [s.key, s])
  );

  apiSitesFromFile.forEach(([key, site]) => {
    const existingSource = currentApiSites.get(key);
    if (existingSource) {
      // 如果已存在，只覆盖来自配置文件的字段
      existingSource.name = site.name;
      existingSource.api = site.api;
      existingSource.detail = site.detail;
      existingSource.ua = site.ua;
      existingSource.referer = site.referer;
      existingSource.disable_ad_filter =
        site.disable_ad_filter ?? existingSource.disable_ad_filter ?? false;
      existingSource.from = 'config';
    } else {
      // 如果不存在，创建新条目
      currentApiSites.set(key, {
        key,
        name: site.name,
        api: site.api,
        detail: site.detail,
        ua: site.ua,
        referer: site.referer,
        disable_ad_filter: site.disable_ad_filter ?? false,
        from: 'config',
        disabled: false,
      });
    }
  });

  // 检查现有源是否在 fileConfig.api_site 中，如果不在则标记为 custom
  const apiSitesFromFileKey = new Set(apiSitesFromFile.map(([key]) => key));
  currentApiSites.forEach((source) => {
    if (!apiSitesFromFileKey.has(source.key)) {
      source.from = 'custom';
    }
  });

  // 将 Map 转换回数组
  adminConfig.SourceConfig = Array.from(currentApiSites.values());

  // 覆盖 CustomCategories
  const customCategoriesFromFile = fileConfig.custom_category || [];
  const currentCustomCategories = new Map(
    (adminConfig.CustomCategories || []).map((c) => [c.query + c.type, c])
  );

  customCategoriesFromFile.forEach((category) => {
    const key = category.query + category.type;
    const existedCategory = currentCustomCategories.get(key);
    if (existedCategory) {
      existedCategory.name = category.name;
      existedCategory.query = category.query;
      existedCategory.type = category.type;
      existedCategory.from = 'config';
    } else {
      currentCustomCategories.set(key, {
        name: category.name,
        type: category.type,
        query: category.query,
        from: 'config',
        disabled: false,
      });
    }
  });

  // 检查现有 CustomCategories 是否在 fileConfig.custom_category 中，如果不在则标记为 custom
  const customCategoriesFromFileKeys = new Set(
    customCategoriesFromFile.map((c) => c.query + c.type)
  );
  currentCustomCategories.forEach((category) => {
    if (!customCategoriesFromFileKeys.has(category.query + category.type)) {
      category.from = 'custom';
    }
  });

  // 将 Map 转换回数组
  adminConfig.CustomCategories = Array.from(currentCustomCategories.values());

  const livesFromFile = Object.entries(fileConfig.lives || []);
  const currentLives = new Map(
    (adminConfig.LiveConfig || []).map((l) => [l.key, l])
  );
  livesFromFile.forEach(([key, site]) => {
    const existingLive = currentLives.get(key);
    if (existingLive) {
      existingLive.name = site.name;
      existingLive.url = site.url;
      existingLive.ua = site.ua;
      existingLive.epg = site.epg;
    } else {
      // 如果不存在，创建新条目
      currentLives.set(key, {
        key,
        name: site.name,
        url: site.url,
        ua: site.ua,
        epg: site.epg,
        channelNumber: 0,
        from: 'config',
        disabled: false,
      });
    }
  });

  // 检查现有 LiveConfig 是否在 fileConfig.lives 中，如果不在则标记为 custom
  const livesFromFileKeys = new Set(livesFromFile.map(([key]) => key));
  currentLives.forEach((live) => {
    if (!livesFromFileKeys.has(live.key)) {
      live.from = 'custom';
    }
  });

  // 将 Map 转换回数组
  adminConfig.LiveConfig = Array.from(currentLives.values());
  adminConfig.PlayerEnhancementConfig = resolvePlayerEnhancementConfig(
    fileConfig,
    adminConfig.PlayerEnhancementConfig
  );

  return adminConfig;
}

async function getInitConfig(
  configFile: string,
  subConfig: {
    URL: string;
    AutoUpdate: boolean;
    LastCheck: string;
  } = {
    URL: '',
    AutoUpdate: false,
    LastCheck: '',
  }
): Promise<AdminConfig> {
  let cfgFile: ConfigFileStruct;
  try {
    cfgFile = JSON.parse(configFile) as ConfigFileStruct;
  } catch (e) {
    cfgFile = {} as ConfigFileStruct;
  }
  const configFileMigrated =
    migrateLegacyDefaultPlayerEnhancementFileConfig(cfgFile);
  const adminConfig: AdminConfig = {
    ConfigFile: configFileMigrated
      ? JSON.stringify(cfgFile, null, 2)
      : configFile,
    ConfigSubscribtion: subConfig,
    SiteConfig: {
      SiteName: process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTV',
      Announcement:
        process.env.ANNOUNCEMENT ||
        '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
      SearchDownstreamMaxPage:
        Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
      SiteInterfaceCacheTime: cfgFile.cache_time || 7200,
      DoubanProxyType:
        process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'cmliussss-cdn-tencent',
      DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
      DoubanImageProxyType:
        process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE ||
        'cmliussss-cdn-tencent',
      DoubanImageProxy: process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '',
      DisableYellowFilter:
        process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
      FluidSearch: process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false',
      EnableWebLive: false,
      EnableWebMusic: false,
    },
    UserConfig: {
      Users: [],
    },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
    AdFilterConfig: {
      enabled: true,
    },
    PlayerEnhancementConfig: resolvePlayerEnhancementConfig(cfgFile),
  };

  // 补充用户信息
  const userNames = await loadStoredUsernames();
  const allUsers = userNames
    .filter((u) => u !== process.env.USERNAME)
    .map((u) => ({
      username: u,
      role: 'user',
      banned: false,
    }));
  allUsers.unshift({
    username: process.env.USERNAME!,
    role: 'owner',
    banned: false,
  });
  adminConfig.UserConfig.Users = allUsers as any;

  // 从配置文件中补充源信息
  Object.entries(cfgFile.api_site || []).forEach(([key, site]) => {
    adminConfig.SourceConfig.push({
      key: key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      ua: site.ua,
      referer: site.referer,
      disable_ad_filter: site.disable_ad_filter ?? false,
      from: 'config',
      disabled: false,
    });
  });

  // 从配置文件中补充自定义分类信息
  cfgFile.custom_category?.forEach((category) => {
    adminConfig.CustomCategories.push({
      name: category.name || category.query,
      type: category.type,
      query: category.query,
      from: 'config',
      disabled: false,
    });
  });

  // 从配置文件中补充直播源信息
  Object.entries(cfgFile.lives || []).forEach(([key, live]) => {
    if (!adminConfig.LiveConfig) {
      adminConfig.LiveConfig = [];
    }
    adminConfig.LiveConfig.push({
      key,
      name: live.name,
      url: live.url,
      ua: live.ua,
      epg: live.epg,
      channelNumber: 0,
      from: 'config',
      disabled: false,
    });
  });

  return adminConfig;
}

export async function getConfig(): Promise<AdminConfig> {
  // 直接使用内存缓存
  if (cachedConfig) {
    return cachedConfig;
  }

  const defaultConfigFile = readBundledDefaultConfigFile();

  let adminConfig = await loadStoredAdminConfig();

  // db 中无配置，执行一次初始化
  if (!adminConfig) {
    adminConfig = await getInitConfig(defaultConfigFile);
  } else if (
    defaultConfigFile &&
    shouldBootstrapFromDefaultConfig(adminConfig)
  ) {
    adminConfig.ConfigFile = defaultConfigFile;
    adminConfig = refineConfig(adminConfig);
  }
  adminConfig = configSelfCheck(adminConfig);
  cachedConfig = adminConfig;

  await saveStoredAdminConfig(cachedConfig);

  return cachedConfig;
}

export function configSelfCheck(adminConfig: AdminConfig): AdminConfig {
  let fileConfig: ConfigFileStruct;
  try {
    fileConfig = JSON.parse(adminConfig.ConfigFile || '{}') as ConfigFileStruct;
  } catch (e) {
    fileConfig = {} as ConfigFileStruct;
  }
  const fileConfigMigrated =
    migrateLegacyDefaultPlayerEnhancementFileConfig(fileConfig);
  adminConfig.PlayerEnhancementConfig =
    migrateLegacyDefaultPlayerEnhancementConfig(
      adminConfig.PlayerEnhancementConfig
    );
  if (fileConfigMigrated) {
    adminConfig.ConfigFile = JSON.stringify(fileConfig, null, 2);
  }

  // 确保必要的属性存在和初始化
  if (!adminConfig.UserConfig) {
    adminConfig.UserConfig = { Users: [] };
  }
  if (
    !adminConfig.UserConfig.Users ||
    !Array.isArray(adminConfig.UserConfig.Users)
  ) {
    adminConfig.UserConfig.Users = [];
  }
  if (!adminConfig.SourceConfig || !Array.isArray(adminConfig.SourceConfig)) {
    adminConfig.SourceConfig = [];
  }
  adminConfig.SourceConfig = adminConfig.SourceConfig.map((source) => ({
    ...source,
    disable_ad_filter: source.disable_ad_filter ?? false,
  }));
  if (
    !adminConfig.CustomCategories ||
    !Array.isArray(adminConfig.CustomCategories)
  ) {
    adminConfig.CustomCategories = [];
  }
  if (!adminConfig.LiveConfig || !Array.isArray(adminConfig.LiveConfig)) {
    adminConfig.LiveConfig = [];
  }
  if (!adminConfig.SiteConfig) {
    adminConfig.SiteConfig = {
      SiteName: process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTV',
      Announcement:
        process.env.ANNOUNCEMENT ||
        '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
      SearchDownstreamMaxPage:
        Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
      SiteInterfaceCacheTime: 7200,
      DoubanProxyType:
        process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'cmliussss-cdn-tencent',
      DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
      DoubanImageProxyType:
        process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE ||
        'cmliussss-cdn-tencent',
      DoubanImageProxy: process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '',
      DisableYellowFilter:
        process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
      FluidSearch: process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false',
      EnableWebLive: false,
      EnableWebMusic: false,
    };
  } else {
    adminConfig.SiteConfig.EnableWebLive =
      adminConfig.SiteConfig.EnableWebLive ?? false;
    adminConfig.SiteConfig.EnableWebMusic =
      adminConfig.SiteConfig.EnableWebMusic ?? false;
  }
  if (
    !adminConfig.AdFilterConfig ||
    typeof adminConfig.AdFilterConfig.enabled !== 'boolean'
  ) {
    adminConfig.AdFilterConfig = { enabled: true };
  }
  adminConfig.PlayerEnhancementConfig = resolvePlayerEnhancementConfig(
    fileConfig,
    adminConfig.PlayerEnhancementConfig
  );

  // 站长变更自检
  const ownerUser = process.env.USERNAME;

  // 去重
  const seenUsernames = new Set<string>();
  adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter((user) => {
    if (seenUsernames.has(user.username)) {
      return false;
    }
    seenUsernames.add(user.username);
    return true;
  });
  // 过滤站长
  const originOwnerCfg = adminConfig.UserConfig.Users.find(
    (u) => u.username === ownerUser
  );
  adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter(
    (user) => user.username !== ownerUser
  );
  // 其他用户不得拥有 owner 权限
  adminConfig.UserConfig.Users.forEach((user) => {
    if (user.role === 'owner') {
      user.role = 'user';
    }
  });
  // 重新添加回站长
  adminConfig.UserConfig.Users.unshift({
    username: ownerUser!,
    role: 'owner',
    banned: false,
    enabledApis: originOwnerCfg?.enabledApis || undefined,
    tags: originOwnerCfg?.tags || undefined,
  });

  // 采集源去重
  const seenSourceKeys = new Set<string>();
  adminConfig.SourceConfig = adminConfig.SourceConfig.filter((source) => {
    if (seenSourceKeys.has(source.key)) {
      return false;
    }
    seenSourceKeys.add(source.key);
    return true;
  });

  // 自定义分类去重
  const seenCustomCategoryKeys = new Set<string>();
  adminConfig.CustomCategories = adminConfig.CustomCategories.filter(
    (category) => {
      if (seenCustomCategoryKeys.has(category.query + category.type)) {
        return false;
      }
      seenCustomCategoryKeys.add(category.query + category.type);
      return true;
    }
  );

  // 直播源去重
  const seenLiveKeys = new Set<string>();
  adminConfig.LiveConfig = adminConfig.LiveConfig.filter((live) => {
    if (seenLiveKeys.has(live.key)) {
      return false;
    }
    seenLiveKeys.add(live.key);
    return true;
  });

  return adminConfig;
}

export async function resetConfig() {
  let originConfig = await loadStoredAdminConfig();
  if (!originConfig) {
    originConfig = {} as AdminConfig;
  }
  const adminConfig = await getInitConfig(
    originConfig.ConfigFile,
    originConfig.ConfigSubscribtion
  );
  cachedConfig = adminConfig;
  await saveStoredAdminConfig(adminConfig);

  return;
}

export async function getCacheTime(config?: AdminConfig): Promise<number> {
  const nextConfig = config || (await getConfig());
  return nextConfig.SiteConfig.SiteInterfaceCacheTime || 7200;
}

export async function getAvailableApiSites(
  user?: string,
  config?: AdminConfig
): Promise<ApiSite[]> {
  const nextConfig = config || (await getConfig());
  const allApiSites = nextConfig.SourceConfig.filter((s) => !s.disabled);

  if (!user) {
    return allApiSites;
  }

  const userConfig = nextConfig.UserConfig.Users.find(
    (u) => u.username === user
  );
  if (!userConfig) {
    return allApiSites;
  }

  // 优先根据用户自己的 enabledApis 配置查找
  if (userConfig.enabledApis && userConfig.enabledApis.length > 0) {
    const userApiSitesSet = new Set(userConfig.enabledApis);
    return allApiSites
      .filter((s) => userApiSitesSet.has(s.key))
      .map((s) => ({
        key: s.key,
        name: s.name,
        api: s.api,
        detail: s.detail,
        ua: s.ua,
        referer: s.referer,
        disable_ad_filter: s.disable_ad_filter,
      }));
  }

  // 如果没有 enabledApis 配置，则根据 tags 查找
  if (
    userConfig.tags &&
    userConfig.tags.length > 0 &&
    nextConfig.UserConfig.Tags
  ) {
    const enabledApisFromTags = new Set<string>();

    // 遍历用户的所有 tags，收集对应的 enabledApis
    userConfig.tags.forEach((tagName) => {
      const tagConfig = nextConfig.UserConfig.Tags?.find(
        (t) => t.name === tagName
      );
      if (tagConfig && tagConfig.enabledApis) {
        tagConfig.enabledApis.forEach((apiKey) =>
          enabledApisFromTags.add(apiKey)
        );
      }
    });

    if (enabledApisFromTags.size > 0) {
      return allApiSites
        .filter((s) => enabledApisFromTags.has(s.key))
        .map((s) => ({
          key: s.key,
          name: s.name,
          api: s.api,
          detail: s.detail,
          ua: s.ua,
          referer: s.referer,
          disable_ad_filter: s.disable_ad_filter,
        }));
    }
  }

  // 如果都没有配置，返回所有可用的 API 站点
  return allApiSites;
}

export async function setCachedConfig(config: AdminConfig) {
  cachedConfig = config;
}
