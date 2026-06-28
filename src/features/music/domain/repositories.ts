import type {
  LyricDocumentEntity,
  MusicHomeView,
  MusicQueueContext,
  QueueItemEntity,
} from './entities';

export interface MusicRepository {
  getHomeView(): Promise<MusicHomeView>;
  getLyrics(trackId: string): Promise<LyricDocumentEntity>;
  getQueueByContext(context: MusicQueueContext): Promise<QueueItemEntity[]>;
}
