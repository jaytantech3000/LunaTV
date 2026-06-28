export type MusicSource = 'fixture';

export type MusicSectionId = 'home' | 'explore' | 'library';

export type MusicQueueContext = 'featured' | 'recent' | 'library';

export interface MusicTrackEntity {
  id: string;
  source: MusicSource;
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
  source: MusicSource;
  offsetMs: number;
  lines: LyricLineEntity[];
}

export interface MusicSectionEntity {
  id: MusicSectionId;
  title: string;
}

export interface MusicHomeView {
  sections: MusicSectionEntity[];
  featuredQueue: QueueItemEntity[];
}
