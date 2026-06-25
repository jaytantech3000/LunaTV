import {
  type MusicCollection,
  type MusicCollectionKind,
  type MusicCollectionSummary,
  type MusicHomePayload,
  type MusicLyricPayload,
  type MusicPlatformKey,
  type MusicSearchPayload,
  type MusicSource,
  type MusicTrack,
} from './types';

interface MockTrackRecord extends MusicTrack {
  toneSeed: number;
}

interface MockSourceCatalog {
  source: MusicSource;
  spotlight: MockTrackRecord[];
  sections: MusicHomePayload['sections'];
  collections: MusicCollection[];
  tracks: MockTrackRecord[];
}

const COMMON_TABS: MusicSource['tabs'] = [
  'home',
  'rank',
  'hot',
  'playlist',
  'search',
];

function toDataSvg(title: string, from: string, to: string, badge: string) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${from}" />
          <stop offset="100%" stop-color="${to}" />
        </linearGradient>
      </defs>
      <rect width="480" height="480" rx="48" fill="url(#bg)" />
      <circle cx="384" cy="96" r="68" fill="rgba(255,255,255,0.13)" />
      <circle cx="122" cy="390" r="88" fill="rgba(255,255,255,0.11)" />
      <text x="40" y="88" fill="rgba(255,255,255,0.75)" font-size="28" font-family="Inter,Arial,sans-serif">${badge}</text>
      <text x="40" y="292" fill="#ffffff" font-size="42" font-weight="700" font-family="Inter,Arial,sans-serif">${title}</text>
      <text x="40" y="340" fill="rgba(255,255,255,0.78)" font-size="24" font-family="Inter,Arial,sans-serif">LunaTV Music Demo</text>
    </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}

function buildTrack(params: {
  source: MusicPlatformKey;
  id: string;
  title: string;
  artist: string;
  albumTitle: string;
  cover: string;
  subtitle: string;
  durationMs: number;
  toneSeed: number;
}): MockTrackRecord {
  return {
    id: params.id,
    source: params.source,
    title: params.title,
    artists: [{ name: params.artist }],
    album: {
      id: `${params.id}-album`,
      title: params.albumTitle,
      cover: params.cover,
    },
    cover: params.cover,
    durationMs: params.durationMs,
    playable: true,
    subtitle: params.subtitle,
    toneSeed: params.toneSeed,
  };
}

function buildLyric(track: MockTrackRecord): MusicLyricPayload {
  const baseLines = [
    '夜色沿着节拍漫过窗台',
    '把旧日噪点熬成新的星海',
    '城市在低频里慢慢松开',
    '此刻只剩下心跳继续对白',
    '人群退去之后风景才醒来',
    '每一次回声都把情绪摊开',
    '让旋律像潮汐一样覆盖',
    '最后在晨光里安静落袋',
  ];

  return {
    trackId: track.id,
    source: track.source,
    lines: baseLines.map((text, index) => ({
      timeMs: index * 12000,
      text,
      translation: index % 2 === 0 ? `${track.title} · ${track.artists[0].name}` : undefined,
    })),
  };
}

function buildCatalog(params: {
  key: MusicPlatformKey;
  name: string;
  badge: string;
  description: string;
  colors: [string, string][];
  collectionAccent: string[];
}) {
  const trackSeeds = [
    {
      title: '霓虹夜航',
      artist: 'Luna Drive',
      albumTitle: 'Midnight Circuits',
      subtitle: '夜色电子 / 合成浪潮',
      durationMs: 188000,
      toneSeed: 5,
    },
    {
      title: '晴空慢板',
      artist: '北岸信号',
      albumTitle: 'Blue Afternoon',
      subtitle: '晴朗器乐 / 慢拍律动',
      durationMs: 214000,
      toneSeed: 7,
    },
    {
      title: '失重咖啡馆',
      artist: 'Aurora Lane',
      albumTitle: 'Low Gravity',
      subtitle: '轻爵士 / 夜间氛围',
      durationMs: 201000,
      toneSeed: 11,
    },
    {
      title: '回声天台',
      artist: 'Sora Kids',
      albumTitle: 'Skyline Postcards',
      subtitle: '日系流行 / 夏夜街景',
      durationMs: 176000,
      toneSeed: 13,
    },
    {
      title: '潮汐邮差',
      artist: 'Wave Bureau',
      albumTitle: 'Coastline Letters',
      subtitle: '城市民谣 / 海岸线',
      durationMs: 223000,
      toneSeed: 17,
    },
    {
      title: '热岛电车',
      artist: 'Mirage Metro',
      albumTitle: 'Heat Route',
      subtitle: '律动流行 / 热岛夜行',
      durationMs: 194000,
      toneSeed: 19,
    },
    {
      title: '云层之下',
      artist: 'Polar Youth',
      albumTitle: 'Shelter Signal',
      subtitle: '独立摇滚 / 雨幕公路',
      durationMs: 231000,
      toneSeed: 23,
    },
    {
      title: '玻璃雨停',
      artist: 'Afterglow Club',
      albumTitle: 'Soft Reflections',
      subtitle: '柔光流行 / 清晨复位',
      durationMs: 207000,
      toneSeed: 29,
    },
  ];

  const tracks = trackSeeds.map((seed, index) =>
    buildTrack({
      source: params.key,
      id: `${params.key}-track-${index + 1}`,
      title: seed.title,
      artist: seed.artist,
      albumTitle: seed.albumTitle,
      cover: toDataSvg(
        seed.title,
        params.colors[index % params.colors.length][0],
        params.colors[index % params.colors.length][1],
        params.badge
      ),
      subtitle: seed.subtitle,
      durationMs: seed.durationMs,
      toneSeed: seed.toneSeed,
    })
  );

  const buildCollection = (
    id: string,
    title: string,
    kind: MusicCollectionKind,
    description: string,
    trackIndexes: number[],
    accentColor: string
  ): MusicCollection => ({
    id,
    source: params.key,
    kind,
    title,
    cover: toDataSvg(title, accentColor, '#101828', params.badge),
    description,
    trackCount: trackIndexes.length,
    accentColor,
    curator: `${params.name} 编辑部`,
    updatedAtLabel: '刚刚更新',
    tracks: trackIndexes.map((index) => tracks[index]),
  });

  const collections = [
    buildCollection(
      `${params.key}-rank-city`,
      '城市夜航榜',
      'rank',
      '适合夜间通勤与加速思考的电气榜单。',
      [0, 5, 3, 6, 2],
      params.collectionAccent[0]
    ),
    buildCollection(
      `${params.key}-rank-soft`,
      '柔光新声榜',
      'rank',
      '把细节留给耳机，把情绪留给黄昏。',
      [7, 1, 4, 2, 3],
      params.collectionAccent[1]
    ),
    buildCollection(
      `${params.key}-playlist-focus`,
      '写代码时听什么',
      'playlist',
      '低干扰、高专注、持续推进的工作型歌单。',
      [1, 2, 0, 7, 6, 4],
      params.collectionAccent[2]
    ),
    buildCollection(
      `${params.key}-playlist-rain`,
      '雨后街景备忘录',
      'playlist',
      '潮湿、透明、略带反光感的夜色拼贴。',
      [7, 6, 4, 3, 2],
      params.collectionAccent[3]
    ),
  ];

  const toSummary = (collection: MusicCollection): MusicCollectionSummary => ({
    id: collection.id,
    source: collection.source,
    kind: collection.kind,
    title: collection.title,
    cover: collection.cover,
    description: collection.description,
    trackCount: collection.trackCount,
    accentColor: collection.accentColor,
  });

  const sections: MusicHomePayload['sections'] = [
    {
      id: `${params.key}-section-home`,
      title: '为今晚准备的声音',
      tab: 'home',
      kind: 'track-list',
      description: params.description,
      tracks: tracks.slice(0, 4),
    },
    {
      id: `${params.key}-section-rank`,
      title: '榜单雷达',
      tab: 'rank',
      kind: 'collection-list',
      description: '选一张榜单，直接开始整组播放。',
      collections: collections
        .filter((collection) => collection.kind === 'rank')
        .map(toSummary),
    },
    {
      id: `${params.key}-section-hot`,
      title: '热门单曲',
      tab: 'hot',
      kind: 'track-list',
      description: '用最短时间进入当前平台的热度中心。',
      tracks: [tracks[0], tracks[5], tracks[2], tracks[3], tracks[7], tracks[4]],
    },
    {
      id: `${params.key}-section-playlist`,
      title: '策展歌单',
      tab: 'playlist',
      kind: 'collection-list',
      description: '适合整段场景聆听的精选集合。',
      collections: collections
        .filter((collection) => collection.kind === 'playlist')
        .map(toSummary),
    },
  ];

  return {
    source: {
      key: params.key,
      name: params.name,
      provider: params.key,
      enabled: true,
      tabs: COMMON_TABS,
      description: params.description,
    },
    spotlight: [tracks[0], tracks[1], tracks[2]],
    sections,
    collections,
    tracks,
  } satisfies MockSourceCatalog;
}

const catalog = [
  buildCatalog({
    key: 'netease',
    name: '网易云音乐',
    badge: 'NETEASE',
    description: '更偏夜间情绪、合成质感和歌单氛围的试听样本。',
    colors: [
      ['#ff5f6d', '#ffc371'],
      ['#7b61ff', '#5ce1e6'],
      ['#36d1dc', '#5b86e5'],
      ['#f093fb', '#f5576c'],
    ],
    collectionAccent: ['#ff5f6d', '#7b61ff', '#0ea5e9', '#0f766e'],
  }),
  buildCatalog({
    key: 'qq',
    name: 'QQ 音乐',
    badge: 'QQ MUSIC',
    description: '更偏通勤流行、清爽律动和高对比度的试听样本。',
    colors: [
      ['#34d399', '#0f172a'],
      ['#22d3ee', '#0ea5e9'],
      ['#fbbf24', '#f97316'],
      ['#4ade80', '#2563eb'],
    ],
    collectionAccent: ['#22c55e', '#0ea5e9', '#f97316', '#0f172a'],
  }),
  buildCatalog({
    key: 'kugou',
    name: '酷狗音乐',
    badge: 'KUGOU',
    description: '更偏现场感、节奏驱动和直给型听感的试听样本。',
    colors: [
      ['#60a5fa', '#1d4ed8'],
      ['#f472b6', '#9333ea'],
      ['#f97316', '#ef4444'],
      ['#10b981', '#0f766e'],
    ],
    collectionAccent: ['#2563eb', '#9333ea', '#f97316', '#0f766e'],
  }),
];

function getSourceCatalog(source: MusicPlatformKey) {
  return catalog.find((item) => item.source.key === source) || catalog[0];
}

export function getMockMusicSources(): MusicSource[] {
  return catalog.map((item) => item.source);
}

export function getMockMusicHome(source: MusicPlatformKey): MusicHomePayload {
  const sourceCatalog = getSourceCatalog(source);
  return {
    source: sourceCatalog.source.key,
    spotlight: sourceCatalog.spotlight,
    sections: sourceCatalog.sections,
  };
}

export function getMockMusicCollection(
  source: MusicPlatformKey,
  id: string
): MusicCollection | null {
  const sourceCatalog = getSourceCatalog(source);
  return sourceCatalog.collections.find((collection) => collection.id === id) || null;
}

export function getMockMusicTrack(
  source: MusicPlatformKey,
  id: string
): MockTrackRecord | null {
  const sourceCatalog = getSourceCatalog(source);
  return sourceCatalog.tracks.find((track) => track.id === id) || null;
}

export function getMockMusicSearch(
  source: MusicPlatformKey,
  query: string
): MusicSearchPayload {
  const normalizedQuery = query.trim().toLowerCase();
  const sourceCatalog = getSourceCatalog(source);

  if (!normalizedQuery) {
    return {
      source,
      query,
      tracks: [],
      collections: sourceCatalog.collections.slice(0, 2).map((collection) => ({
        id: collection.id,
        source: collection.source,
        kind: collection.kind,
        title: collection.title,
        cover: collection.cover,
        description: collection.description,
        trackCount: collection.trackCount,
        accentColor: collection.accentColor,
      })),
    };
  }

  const tracks = sourceCatalog.tracks.filter((track) => {
    const text = [
      track.title,
      track.artists.map((artist) => artist.name).join(' '),
      track.album?.title,
      track.subtitle,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return text.includes(normalizedQuery);
  });

  const collections = sourceCatalog.collections
    .filter((collection) => {
      const text = [collection.title, collection.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return text.includes(normalizedQuery);
    })
    .map((collection) => ({
      id: collection.id,
      source: collection.source,
      kind: collection.kind,
      title: collection.title,
      cover: collection.cover,
      description: collection.description,
      trackCount: collection.trackCount,
      accentColor: collection.accentColor,
    }));

  return {
    source,
    query,
    tracks,
    collections,
  };
}

export function getMockMusicLyric(
  source: MusicPlatformKey,
  id: string
): MusicLyricPayload | null {
  const track = getMockMusicTrack(source, id);
  if (!track) {
    return null;
  }

  return buildLyric(track);
}

export function getMockTrackToneSeed(
  source: MusicPlatformKey,
  id: string
): number | null {
  return getMockMusicTrack(source, id)?.toneSeed || null;
}
