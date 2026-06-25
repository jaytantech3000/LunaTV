import type { PlayerQueueItem } from './types';

function getNavigatorMediaSession() {
  if (typeof navigator === 'undefined') {
    return null;
  }

  return 'mediaSession' in navigator ? navigator.mediaSession : null;
}

export function setMusicMediaSessionMetadata(track: PlayerQueueItem | null) {
  const mediaSession = getNavigatorMediaSession();

  if (!mediaSession || typeof MediaMetadata === 'undefined') {
    return;
  }

  if (!track) {
    mediaSession.metadata = null;
    return;
  }

  mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artistsText,
    album: track.albumTitle || 'LunaTV Music',
    artwork: track.cover
      ? [
          {
            src: track.cover,
            sizes: '480x480',
            type: 'image/svg+xml',
          },
        ]
      : [],
  });
}

export function setMusicMediaSessionPlaybackState(isPlaying: boolean) {
  const mediaSession = getNavigatorMediaSession();

  if (!mediaSession) {
    return;
  }

  mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
}

export function bindMusicMediaSessionAction(
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null
) {
  const mediaSession = getNavigatorMediaSession();

  if (!mediaSession) {
    return;
  }

  try {
    mediaSession.setActionHandler(action, handler);
  } catch {
    // Ignore unsupported action handlers.
  }
}

export function setMusicMediaSessionPositionState(params: {
  durationSec: number;
  currentTimeSec: number;
}) {
  const mediaSession = getNavigatorMediaSession();

  if (!mediaSession?.setPositionState) {
    return;
  }

  const duration = Number.isFinite(params.durationSec) ? params.durationSec : 0;
  const position = Number.isFinite(params.currentTimeSec)
    ? params.currentTimeSec
    : 0;

  if (duration <= 0) {
    return;
  }

  try {
    mediaSession.setPositionState({
      duration,
      playbackRate: 1,
      position: Math.min(Math.max(position, 0), duration),
    });
  } catch {
    // Ignore unsupported position state updates.
  }
}
