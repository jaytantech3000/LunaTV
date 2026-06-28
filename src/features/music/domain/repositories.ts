import type {
  LiveMusicSourceKey,
  LyricDocumentEntity,
  MusicAccountEntity,
  MusicAccountQrPollEntity,
  MusicAccountQrSessionEntity,
  MusicCollectionEntity,
  MusicCollectionKind,
  MusicCollectionSummaryEntity,
  MusicHomeView,
  MusicPlaybackQuality,
  MusicSearchResultEntity,
  MusicSourceEntity,
  MusicTrackEntity,
  MusicTrackPlaybackEntity,
} from './entities';

export interface MusicSourceRepository {
  getSources(): Promise<MusicSourceEntity[]>;
}

export interface MusicDiscoveryRepository {
  getHomeView(
    source: LiveMusicSourceKey,
    options?: {
      sessionCookie?: string | null;
    }
  ): Promise<MusicHomeView>;
  search(
    source: LiveMusicSourceKey,
    query: string,
    page?: number
  ): Promise<MusicSearchResultEntity>;
  getPersonalFm(
    source: LiveMusicSourceKey,
    options?: {
      sessionCookie?: string | null;
    }
  ): Promise<MusicTrackEntity[]>;
  trashPersonalFmTrack(
    source: LiveMusicSourceKey,
    trackId: string,
    options?: {
      sessionCookie?: string | null;
    }
  ): Promise<MusicTrackEntity[]>;
}

export interface MusicCollectionRepository {
  getCollection(
    source: LiveMusicSourceKey,
    id: string,
    kind?: MusicCollectionKind
  ): Promise<MusicCollectionEntity>;
}

export interface MusicTrackRepository {
  getTrackPlayback(
    source: LiveMusicSourceKey,
    id: string,
    quality?: MusicPlaybackQuality
  ): Promise<MusicTrackPlaybackEntity>;
}

export interface MusicLyricRepository {
  getLyrics(
    source: LiveMusicSourceKey,
    trackId: string
  ): Promise<LyricDocumentEntity>;
}

export interface MusicStreamRepository {
  buildStreamPath(
    source: LiveMusicSourceKey,
    trackId: string,
    quality?: MusicPlaybackQuality
  ): string;
  createStreamResponse(request: Request): Promise<Response>;
}

export interface MusicAccountRepository {
  getAccount(
    source: LiveMusicSourceKey,
    sessionCookie?: string | null
  ): Promise<MusicAccountEntity>;
  getLikedTracks(
    source: LiveMusicSourceKey,
    options?: {
      sessionCookie?: string | null;
    }
  ): Promise<MusicTrackEntity[]>;
  setTrackLiked(
    source: LiveMusicSourceKey,
    trackId: string,
    liked: boolean,
    options?: {
      sessionCookie?: string | null;
    }
  ): Promise<MusicTrackEntity[]>;
  setPlaylistSubscribed(
    source: LiveMusicSourceKey,
    playlistId: string,
    subscribed: boolean,
    options?: {
      sessionCookie?: string | null;
    }
  ): Promise<MusicCollectionSummaryEntity[]>;
  getRecentTracks(
    source: LiveMusicSourceKey,
    options?: {
      sessionCookie?: string | null;
    }
  ): Promise<MusicTrackEntity[]>;
  reportTrackPlayed(
    source: LiveMusicSourceKey,
    trackId: string,
    options?: {
      sessionCookie?: string | null;
    }
  ): Promise<MusicTrackEntity[]>;
  createQrSession(
    source: LiveMusicSourceKey
  ): Promise<MusicAccountQrSessionEntity>;
  pollQrSession(
    source: LiveMusicSourceKey,
    key: string
  ): Promise<MusicAccountQrPollEntity>;
}

export interface MusicProviderRepositorySet {
  sourceRepository: MusicSourceRepository;
  discoveryRepository: MusicDiscoveryRepository;
  collectionRepository: MusicCollectionRepository;
  trackRepository: MusicTrackRepository;
  lyricRepository: MusicLyricRepository;
  streamRepository: MusicStreamRepository;
  accountRepository: MusicAccountRepository;
}
