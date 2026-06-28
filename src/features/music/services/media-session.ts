import type { QueueItemEntity } from '../domain/entities';

interface NavigatorWithMediaSession extends Navigator {
  mediaSession?: {
    metadata: MediaMetadata | null;
  };
}

export function bindMusicMediaSession(track: QueueItemEntity | null) {
  if (typeof navigator === 'undefined') {
    return;
  }

  const navigatorWithMediaSession = navigator as NavigatorWithMediaSession;
  if (!navigatorWithMediaSession.mediaSession) {
    return;
  }

  navigatorWithMediaSession.mediaSession.metadata = track
    ? new MediaMetadata({
        title: track.track.title,
        artist: track.track.artists.join(' / '),
        album: track.track.album,
      })
    : null;
}
