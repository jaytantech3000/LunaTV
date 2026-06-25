export type MusicPlatformKey = 'netease' | 'qq' | 'kugou';

export type MusicSectionTab =
  | 'home'
  | 'rank'
  | 'hot'
  | 'playlist'
  | 'album'
  | 'library'
  | 'search';

export type MusicCollectionKind =
  | 'playlist'
  | 'album'
  | 'rank'
  | 'artist-toplist';

export type MusicPlaybackQuality = 'standard' | 'high';

export interface MusicSource {
  key: MusicPlatformKey;
  name: string;
  provider: MusicPlatformKey;
  enabled: boolean;
  tabs: MusicSectionTab[];
  description?: string;
}

export interface MusicArtist {
  id?: string;
  name: string;
}

export interface MusicAlbum {
  id?: string;
  title: string;
  cover?: string;
}

export interface MusicTrack {
  id: string;
  source: MusicPlatformKey;
  title: string;
  artists: MusicArtist[];
  album?: MusicAlbum;
  cover?: string;
  durationMs?: number;
  playable: boolean;
  subtitle?: string;
}

export interface MusicCollectionSummary {
  id: string;
  source: MusicPlatformKey;
  kind: MusicCollectionKind;
  title: string;
  cover?: string;
  description?: string;
  trackCount?: number;
  accentColor?: string;
}

export interface MusicCollection extends MusicCollectionSummary {
  tracks: MusicTrack[];
  curator?: string;
  updatedAtLabel?: string;
}

export interface MusicHomeSection {
  id: string;
  title: string;
  tab: MusicSectionTab;
  kind: 'collection-list' | 'track-list';
  description?: string;
  collections?: MusicCollectionSummary[];
  tracks?: MusicTrack[];
}

export interface MusicHomePayload {
  source: MusicPlatformKey;
  spotlight: MusicTrack[];
  sections: MusicHomeSection[];
}

export interface MusicSearchPayload {
  source: MusicPlatformKey;
  query: string;
  tracks: MusicTrack[];
  collections: MusicCollectionSummary[];
}

export interface MusicLyricLine {
  timeMs: number;
  text: string;
  translation?: string;
}

export interface MusicLyricPayload {
  trackId: string;
  source: MusicPlatformKey;
  lines: MusicLyricLine[];
  offsetMs?: number;
}

export interface MusicTrackPayload {
  track: MusicTrack;
  streamUrl: string;
  quality: MusicPlaybackQuality;
}

export type MusicPlayMode = 'list-loop' | 'single-loop' | 'shuffle';

export interface PlayerQueueItem {
  trackId: string;
  source: MusicPlatformKey;
  title: string;
  artistsText: string;
  cover?: string;
  durationMs?: number;
  albumTitle?: string;
  subtitle?: string;
}

export function buildQueueItemFromTrack(track: MusicTrack): PlayerQueueItem {
  return {
    trackId: track.id,
    source: track.source,
    title: track.title,
    artistsText: track.artists.map((artist) => artist.name).join(' / '),
    cover: track.cover,
    durationMs: track.durationMs,
    albumTitle: track.album?.title,
    subtitle: track.subtitle,
  };
}
