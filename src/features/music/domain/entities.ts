export type MusicSourceKey = 'netease';

export type LiveMusicSourceKey = MusicSourceKey;

export type MusicQueueContext =
  | 'featured'
  | 'recent'
  | 'library'
  | 'discovery'
  | 'fm';

export type MusicHomeSectionTab =
  | 'home'
  | 'rank'
  | 'hot'
  | 'playlist'
  | 'album'
  | 'artist'
  | 'daily'
  | 'fm'
  | 'library'
  | 'settings'
  | 'search';

export type MusicCollectionKind =
  | 'playlist'
  | 'album'
  | 'rank'
  | 'artist-toplist';

export type MusicPlaybackQuality = 'standard' | 'high';

export interface MusicSourceEntity {
  key: MusicSourceKey;
  name: string;
  enabled: boolean;
  tabs: MusicHomeSectionTab[];
  description?: string;
}

export interface MusicTrackEntity {
  id: string;
  source: MusicSourceKey;
  title: string;
  artists: string[];
  album: string;
  coverUrl: string;
  durationMs: number;
  stream: string;
  playable: boolean;
}

export interface QueueItemEntity {
  queueId: string;
  track: MusicTrackEntity;
  addedAt: number;
  fromContext: MusicQueueContext;
}

export interface LyricLineEntity {
  timeMs: number;
  text: string;
}

export interface LyricDocumentEntity {
  trackId: string;
  source: MusicSourceKey;
  offsetMs: number;
  lines: LyricLineEntity[];
}

export interface MusicCollectionSummaryEntity {
  id: string;
  source: MusicSourceKey;
  kind: MusicCollectionKind;
  title: string;
  coverUrl?: string;
  description?: string;
  trackCount?: number;
  accentColor?: string;
}

export interface MusicCollectionEntity {
  summary: MusicCollectionSummaryEntity;
  curator?: string;
  updatedAtLabel?: string;
  tracks: MusicTrackEntity[];
  relatedCollections?: MusicCollectionSummaryEntity[];
}

export interface MusicHomeSectionEntity {
  id: string;
  title: string;
  tab: MusicHomeSectionTab;
  kind: 'collection-list' | 'track-list';
  description?: string;
  collections?: MusicCollectionSummaryEntity[];
  tracks?: MusicTrackEntity[];
}

export interface MusicSearchResultEntity {
  source: LiveMusicSourceKey;
  query: string;
  tracks: MusicTrackEntity[];
  collections: MusicCollectionSummaryEntity[];
}

export interface MusicAccountProfileEntity {
  userId: string;
  nickname: string;
  avatarUrl?: string;
  signature?: string;
}

export interface MusicAccountEntity {
  source: LiveMusicSourceKey;
  authenticated: boolean;
  profile: MusicAccountProfileEntity | null;
  playlists: MusicCollectionSummaryEntity[];
}

export type MusicAccountQrStatus =
  | 'waiting'
  | 'scanned'
  | 'expired'
  | 'confirmed';

export interface MusicAccountQrSessionEntity {
  key: string;
  status: 'waiting';
  qrUrl: string;
  qrImageDataUrl: string;
}

export interface MusicAccountQrPollEntity {
  key: string;
  status: MusicAccountQrStatus;
  account?: MusicAccountEntity;
  message?: string;
  sessionCookieHeader?: string;
}

export interface MusicTrackPlaybackEntity {
  track: MusicTrackEntity;
  streamUrl: string;
  quality: MusicPlaybackQuality;
}

export interface MusicHomeView {
  source: LiveMusicSourceKey;
  spotlight: MusicTrackEntity[];
  sections: MusicHomeSectionEntity[];
  featuredQueue: QueueItemEntity[];
}
