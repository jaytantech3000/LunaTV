import type {
  LyricDocumentEntity,
  MusicHomeView,
  QueueItemEntity,
} from '../domain/entities';
import type { MusicRepository } from '../domain/repositories';

const FEATURED_QUEUE: QueueItemEntity[] = [
  {
    queueId: 'fixture-1',
    addedAt: 1,
    fromContext: 'featured',
    track: {
      id: 'track-1',
      source: 'fixture',
      title: 'Neon Harbour',
      artists: ['Luna Ensemble'],
      album: 'Afterglow',
      coverUrl: '/logo.png',
      durationMs: 215000,
      stream: '/fixtures/music/neon-harbour.mp3',
      playable: true,
    },
  },
  {
    queueId: 'fixture-2',
    addedAt: 2,
    fromContext: 'featured',
    track: {
      id: 'track-2',
      source: 'fixture',
      title: 'Signal Bloom',
      artists: ['Night Drive'],
      album: 'Soft Static',
      coverUrl: '/logo.png',
      durationMs: 194000,
      stream: '/fixtures/music/signal-bloom.mp3',
      playable: true,
    },
  },
  {
    queueId: 'fixture-3',
    addedAt: 3,
    fromContext: 'featured',
    track: {
      id: 'track-3',
      source: 'fixture',
      title: 'Glass Sunrise',
      artists: ['Arc Radio'],
      album: 'Morning Loop',
      coverUrl: '/logo.png',
      durationMs: 228000,
      stream: '/fixtures/music/glass-sunrise.mp3',
      playable: true,
    },
  },
];

export function createFixtureRepository(): MusicRepository {
  return {
    async getHomeView(): Promise<MusicHomeView> {
      return {
        sections: [
          { id: 'home', title: 'Home' },
          { id: 'explore', title: 'Explore' },
          { id: 'library', title: 'Library' },
        ],
        featuredQueue: FEATURED_QUEUE,
      };
    },
    async getLyrics(trackId: string): Promise<LyricDocumentEntity> {
      return {
        trackId,
        source: 'fixture',
        offsetMs: 0,
        lines: [
          { timeMs: 0, text: 'Lights on the harbour line' },
          { timeMs: 12000, text: 'We move with the midnight tide' },
        ],
      };
    },
    async getQueueByContext(): Promise<QueueItemEntity[]> {
      return FEATURED_QUEUE;
    },
  };
}
