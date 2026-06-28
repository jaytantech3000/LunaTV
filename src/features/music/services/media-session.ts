import type { QueueItemEntity } from '../domain/entities';

export function bindMusicMediaSession(track: QueueItemEntity | null) {
  if (typeof navigator === 'undefined') {
    return;
  }

  const navigatorWithMediaSession = navigator as Navigator & {
    mediaSession?: MediaSession | null;
  };
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
