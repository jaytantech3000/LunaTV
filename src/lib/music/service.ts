import {
  getAudiusCollectionPayload,
  getAudiusHomePayload,
  getAudiusLyricPayload,
  getAudiusSearchPayload,
  getAudiusSource,
  getAudiusTrackPayload,
} from './audius';
import {
  getJamendoCollectionPayload,
  getJamendoHomePayload,
  getJamendoLyricPayload,
  getJamendoSearchPayload,
  getJamendoSource,
  getJamendoTrackPayload,
} from './jamendo';
import {
  getMusicCollectionPayload as getNeteaseCollectionPayload,
  getMusicHomePayload as getNeteaseHomePayload,
  getMusicLyricPayload as getNeteaseLyricPayload,
  getMusicSearchPayload as getNeteaseSearchPayload,
  getMusicTrackPayload as getNeteaseTrackPayload,
  MusicApiError,
} from './netease';
import { normalizeOptionalText } from './provider-utils';
import type {
  MusicCollection,
  MusicHomePayload,
  MusicLyricPayload,
  MusicSearchPayload,
  MusicSectionTab,
  MusicSource,
  MusicTrackPayload,
} from './types';

type ImplementedMusicPlatformKey = 'netease' | 'audius' | 'jamendo';

interface MusicProvider {
  getCollectionPayload: (params: {
    id: string | null | undefined;
  }) => Promise<MusicCollection>;
  getHomePayload: () => Promise<MusicHomePayload>;
  getLyricPayload: (params: {
    id: string | null | undefined;
  }) => Promise<MusicLyricPayload>;
  getSearchPayload: (params: {
    page: string | null | undefined;
    query: string | null | undefined;
  }) => Promise<MusicSearchPayload>;
  getSource: () => MusicSource;
  getTrackPayload: (params: {
    id: string | null | undefined;
    quality: string | null | undefined;
  }) => Promise<MusicTrackPayload>;
}

const DISABLED_MUSIC_SOURCE_TABS: MusicSectionTab[] = ['home', 'search'];

const placeholderSources: MusicSource[] = [
  {
    description: '接入中，暂未开放。',
    enabled: false,
    key: 'qq',
    name: 'QQ 音乐',
    provider: 'qq',
    tabs: DISABLED_MUSIC_SOURCE_TABS,
  },
  {
    description: '接入中，暂未开放。',
    enabled: false,
    key: 'kugou',
    name: '酷狗音乐',
    provider: 'kugou',
    tabs: DISABLED_MUSIC_SOURCE_TABS,
  },
];

const musicProviders: Record<ImplementedMusicPlatformKey, MusicProvider> = {
  audius: {
    getCollectionPayload: getAudiusCollectionPayload,
    getHomePayload: getAudiusHomePayload,
    getLyricPayload: getAudiusLyricPayload,
    getSearchPayload: getAudiusSearchPayload,
    getSource: getAudiusSource,
    getTrackPayload: getAudiusTrackPayload,
  },
  jamendo: {
    getCollectionPayload: getJamendoCollectionPayload,
    getHomePayload: getJamendoHomePayload,
    getLyricPayload: getJamendoLyricPayload,
    getSearchPayload: getJamendoSearchPayload,
    getSource: getJamendoSource,
    getTrackPayload: getJamendoTrackPayload,
  },
  netease: {
    getCollectionPayload: (params) =>
      getNeteaseCollectionPayload({
        id: params.id,
        source: 'netease',
      }),
    getHomePayload: () =>
      getNeteaseHomePayload({
        source: 'netease',
      }),
    getLyricPayload: (params) =>
      getNeteaseLyricPayload({
        id: params.id,
        source: 'netease',
      }),
    getSearchPayload: (params) =>
      getNeteaseSearchPayload({
        page: params.page,
        query: params.query,
        source: 'netease',
      }),
    getSource: () => ({
      description: 'Web 与桌面模式都已接入真实网易云公开数据。',
      enabled: true,
      key: 'netease',
      name: '网易云音乐',
      provider: 'netease',
      tabs: ['home', 'rank', 'hot', 'playlist', 'search'],
    }),
    getTrackPayload: (params) =>
      getNeteaseTrackPayload({
        id: params.id,
        quality: params.quality,
        source: 'netease',
      }),
  },
};

function resolveSourceKey(
  source: string | null | undefined
): ImplementedMusicPlatformKey {
  const normalizedSource = normalizeOptionalText(source) || 'netease';

  if (
    normalizedSource === 'netease' ||
    normalizedSource === 'audius' ||
    normalizedSource === 'jamendo'
  ) {
    return normalizedSource;
  }

  throw new MusicApiError('Unsupported music source', 400);
}

function requireProvider(source: string | null | undefined): {
  key: ImplementedMusicPlatformKey;
  provider: MusicProvider;
} {
  const key = resolveSourceKey(source);
  const provider = musicProviders[key];
  const sourceDefinition = provider.getSource();

  if (!sourceDefinition.enabled) {
    throw new MusicApiError(
      sourceDefinition.description || `${sourceDefinition.name} 暂未开放`,
      503
    );
  }

  return {
    key,
    provider,
  };
}

export function getMusicSourcesPayload(): { sources: MusicSource[] } {
  return {
    sources: [
      musicProviders.netease.getSource(),
      musicProviders.audius.getSource(),
      musicProviders.jamendo.getSource(),
      ...placeholderSources,
    ],
  };
}

export async function getMusicHomePayload(params: {
  source: string | null | undefined;
}): Promise<MusicHomePayload> {
  return requireProvider(params.source).provider.getHomePayload();
}

export async function getMusicSearchPayload(params: {
  page: string | null | undefined;
  query: string | null | undefined;
  source: string | null | undefined;
}): Promise<MusicSearchPayload> {
  return requireProvider(params.source).provider.getSearchPayload({
    page: params.page,
    query: params.query,
  });
}

export async function getMusicCollectionPayload(params: {
  id: string | null | undefined;
  source: string | null | undefined;
}): Promise<MusicCollection> {
  return requireProvider(params.source).provider.getCollectionPayload({
    id: params.id,
  });
}

export async function getMusicTrackPayload(params: {
  id: string | null | undefined;
  quality: string | null | undefined;
  source: string | null | undefined;
}): Promise<MusicTrackPayload> {
  return requireProvider(params.source).provider.getTrackPayload({
    id: params.id,
    quality: params.quality,
  });
}

export async function getMusicLyricPayload(params: {
  id: string | null | undefined;
  source: string | null | undefined;
}): Promise<MusicLyricPayload> {
  return requireProvider(params.source).provider.getLyricPayload({
    id: params.id,
  });
}
