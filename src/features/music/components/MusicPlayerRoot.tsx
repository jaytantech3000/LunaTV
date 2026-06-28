'use client';

/* eslint-disable no-console */

import { useEffect, useRef } from 'react';

import { MusicFullPlayer } from './MusicFullPlayer';
import { MusicMiniPlayer } from './MusicMiniPlayer';
import { createAudioEngine } from '../services/audio-engine';
import {
  bindDesktopMusicTrayControls,
  syncDesktopMusicTrayState,
} from '../services/desktop-music-tray';
import { bindMusicKeyboardShortcuts } from '../services/keyboard-shortcuts';
import { bindMusicMediaSession } from '../services/media-session';
import { buildMusicDownloadId } from '../services/music-download-records';
import {
  fetchMusicLyricDocument,
  fetchMusicTrackPlayback,
} from '../services/music-api-client';
import { resolveDownloadedMusicTrackPlaybackUrl } from '../services/music-downloads';
import {
  buildMusicPlaybackSessionSnapshot,
  getMusicPlaybackSession,
  saveMusicPlaybackSession,
} from '../services/music-playback-session';
import { saveMusicPlayRecord } from '../services/music-profile';
import { useLyricsStore } from '../state/lyrics-store';
import { useMusicDataStore } from '../state/music-data-store';
import { useMusicDownloadStore } from '../state/music-download-store';
import { useMusicLibraryStore } from '../state/music-library-store';
import {
  selectCurrentQueueItem,
  usePlaybackStore,
} from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

function resolveRootErrorMessage(
  error: unknown,
  fallbackMessage: string
): string {
  if (error instanceof Error) {
    return error.message || fallbackMessage;
  }

  return fallbackMessage;
}

function resolveActiveLineIndex(positionMs: number): number {
  const lyrics = useLyricsStore.getState().lyrics;

  if (!lyrics || lyrics.lines.length === 0) {
    return -1;
  }

  for (let index = lyrics.lines.length - 1; index >= 0; index -= 1) {
    if (positionMs >= lyrics.lines[index].timeMs) {
      return index;
    }
  }

  return 0;
}

function resolveBufferedMs(audio: HTMLAudioElement): number {
  if (audio.buffered.length === 0) {
    return 0;
  }

  const lastRangeIndex = audio.buffered.length - 1;
  const bufferedMs = audio.buffered.end(lastRangeIndex) * 1000;

  if (!Number.isFinite(bufferedMs)) {
    return 0;
  }

  return Math.max(bufferedMs, 0);
}

function resolveMediaDurationMs(
  audio: HTMLAudioElement,
  fallbackDurationMs: number
): number {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    return Math.max(Math.round(audio.duration * 1000), 0);
  }

  return Math.max(fallbackDurationMs, 0);
}

function resolveMediaPositionMs(
  audio: HTMLAudioElement,
  fallbackPositionMs: number
): number {
  if (Number.isFinite(audio.currentTime) && audio.currentTime >= 0) {
    return Math.max(Math.round(audio.currentTime * 1000), 0);
  }

  return Math.max(fallbackPositionMs, 0);
}

function isLocalAssetStream(stream: string): boolean {
  return stream.startsWith('asset:');
}

function persistActiveTrackPlayback(
  audio: HTMLAudioElement,
  completed: boolean
): void {
  const playbackState = usePlaybackStore.getState();
  const currentQueueItem = selectCurrentQueueItem(playbackState);

  if (!currentQueueItem) {
    return;
  }

  const durationMs = resolveMediaDurationMs(
    audio,
    Math.max(playbackState.durationMs, currentQueueItem.track.durationMs)
  );
  const rawPositionMs = completed
    ? durationMs
    : resolveMediaPositionMs(audio, playbackState.positionMs);
  const normalizedCompleted =
    completed ||
    (durationMs > 0 && Math.abs(durationMs - rawPositionMs) <= 1000);
  const playTimeMs = normalizedCompleted ? durationMs : rawPositionMs;
  const normalizedDurationMs = durationMs > 0 ? durationMs : playTimeMs;

  if (playTimeMs <= 0 && !normalizedCompleted) {
    return;
  }

  void saveMusicPlayRecord(currentQueueItem.track, {
    playedAt: Date.now(),
    playTimeMs,
    durationMs: normalizedDurationMs,
    completed: normalizedCompleted,
  }).catch((error) => {
    console.error('记录本地续播进度失败', error);
  });
}

function persistPlaybackSessionSnapshot(
  audio: HTMLAudioElement | null | undefined
): void {
  const playbackState = usePlaybackStore.getState();
  const currentQueueItem = selectCurrentQueueItem(playbackState);
  const fallbackDurationMs = currentQueueItem
    ? Math.max(playbackState.durationMs, currentQueueItem.track.durationMs)
    : 0;
  const canReadPositionFromAudio = Boolean(
    audio && currentQueueItem?.track.stream
  );
  const snapshot = buildMusicPlaybackSessionSnapshot({
    queue: playbackState.queue,
    currentTrackId: playbackState.currentTrackId,
    positionMs: currentQueueItem
      ? canReadPositionFromAudio && audio
        ? resolveMediaPositionMs(audio, playbackState.positionMs)
        : Math.max(playbackState.positionMs, 0)
      : 0,
    durationMs:
      canReadPositionFromAudio && audio
        ? resolveMediaDurationMs(audio, fallbackDurationMs)
        : fallbackDurationMs,
    savedAt: Date.now(),
  });

  void saveMusicPlaybackSession(snapshot).catch((error) => {
    console.error('记录播放现场快照失败', error);
  });
}

function openMusicRouteFromTray(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const shouldNavigate =
    window.location.pathname !== '/music' ||
    window.location.search.length > 0 ||
    window.location.hash.length > 0;

  if (!shouldNavigate) {
    return;
  }

  window.history.pushState({ source: 'music-tray' }, '', '/music');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export default function MusicPlayerRoot() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recentTrackKeyRef = useRef<string | null>(null);
  const playbackSessionRestoreAttemptedRef = useRef(false);
  const playbackSessionReadyRef = useRef(false);
  const pendingRestoreSeekRef = useRef<{
    trackId: string;
    positionMs: number;
  } | null>(null);
  const currentTrack = usePlaybackStore(selectCurrentQueueItem);
  const queue = usePlaybackStore((state) => state.queue);
  const currentTrackId = usePlaybackStore((state) => state.currentTrackId);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const advancePlayback = useMusicDataStore((state) => state.advancePlayback);
  const hydrateDownloads = useMusicDownloadStore(
    (state) => state.hydrateDownloads
  );
  const preferredPlaybackQuality = useMusicDataStore(
    (state) => state.preferredPlaybackQuality
  );
  const playState = usePlaybackStore((state) => state.playState);
  const volume = usePlaybackStore((state) => state.volume);
  const muted = usePlaybackStore((state) => state.muted);
  const requestedSeekMs = usePlaybackStore((state) => state.requestedSeekMs);
  const currentTrackSource = currentTrack?.track.source ?? null;
  const currentTrackStream = currentTrack?.track.stream ?? '';
  const currentTrackDurationMs = currentTrack?.track.durationMs ?? 0;
  const reportRecentTrack = useMusicLibraryStore(
    (state) => state.reportRecentTrack
  );
  const queueSessionSignature = queue
    .map((item) => `${item.queueId}:${item.track.id}`)
    .join('|');

  useEffect(() => {
    void hydrateDownloads();
  }, [hydrateDownloads]);

  useEffect(() => {
    if (playbackSessionRestoreAttemptedRef.current) {
      return;
    }

    playbackSessionRestoreAttemptedRef.current = true;
    let cancelled = false;

    const restorePlaybackSession = async () => {
      const activePlaybackState = usePlaybackStore.getState();

      if (
        activePlaybackState.queue.length > 0 ||
        activePlaybackState.currentTrackId
      ) {
        playbackSessionReadyRef.current = true;
        persistPlaybackSessionSnapshot(audioRef.current);
        return;
      }

      try {
        const session = await getMusicPlaybackSession();

        if (cancelled) {
          return;
        }

        const latestPlaybackState = usePlaybackStore.getState();
        if (
          latestPlaybackState.queue.length > 0 ||
          latestPlaybackState.currentTrackId
        ) {
          playbackSessionReadyRef.current = true;
          persistPlaybackSessionSnapshot(audioRef.current);
          return;
        }

        if (!session.currentTrackId || session.queue.length === 0) {
          return;
        }

        const restoredTrack =
          session.queue.find(
            (item) => item.track.id === session.currentTrackId
          ) ?? null;

        usePlaybackStore.setState({
          queue: session.queue,
          currentTrackId: session.currentTrackId,
          playState: 'paused',
          positionMs: session.positionMs,
          durationMs: restoredTrack?.track.durationMs ?? session.durationMs,
          bufferedMs: 0,
          requestedSeekMs: null,
          error: null,
        });
        usePlayerSurfaceStore.getState().showMiniPlayer();

        if (session.positionMs > 0) {
          pendingRestoreSeekRef.current = {
            trackId: session.currentTrackId,
            positionMs: session.positionMs,
          };
        }
      } catch (error) {
        console.error('恢复播放现场快照失败', error);
      } finally {
        if (!cancelled) {
          playbackSessionReadyRef.current = true;
        }
      }
    };

    void restorePlaybackSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!audioRef.current) {
      return;
    }

    const engine = createAudioEngine(audioRef.current);
    engine.syncDuration(currentTrackDurationMs);
    engine.syncPosition(0);
  }, [currentTrackDurationMs, currentTrackId]);

  useEffect(() => {
    const pendingRestoreSeek = pendingRestoreSeekRef.current;

    if (
      !pendingRestoreSeek ||
      !audioRef.current ||
      !currentTrackId ||
      !currentTrackStream ||
      pendingRestoreSeek.trackId !== currentTrackId
    ) {
      return;
    }

    usePlaybackStore.getState().requestSeek(pendingRestoreSeek.positionMs);
    pendingRestoreSeekRef.current = null;
  }, [currentTrackId, currentTrackStream]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !currentTrack || !currentTrackSource || !currentTrackId) {
      return;
    }

    const engine = createAudioEngine(audio);
    const lyricsTrackId = useLyricsStore.getState().lyrics?.trackId ?? null;
    let disposed = false;

    const needsLyrics = lyricsTrackId !== currentTrackId;

    if (currentTrackStream) {
      engine.load(currentTrackStream);
    }

    void (async () => {
      let resolvedStream = currentTrackStream;

      if (!isLocalAssetStream(resolvedStream)) {
        try {
          const localStream =
            await resolveDownloadedMusicTrackPlaybackUrl({
              source: currentTrackSource,
              trackId: currentTrackId,
            });

          if (disposed) {
            return;
          }

          if (localStream) {
            resolvedStream = localStream;

            if (localStream !== currentTrackStream) {
              usePlaybackStore.getState().updateTrack({
                ...currentTrack.track,
                stream: localStream,
              });
            }
          } else {
            const downloadRecord =
              useMusicDownloadStore.getState().records[
                buildMusicDownloadId(currentTrackSource, currentTrackId)
              ] ?? null;

            if (downloadRecord?.status === 'downloaded') {
              await hydrateDownloads();

              if (disposed) {
                return;
              }
            }
          }
        } catch (error) {
          console.error('解析本地下载音频失败', error);
        }
      }

      if (disposed) {
        return;
      }

      if (resolvedStream) {
        if (resolvedStream !== currentTrackStream) {
          engine.load(resolvedStream);
        }
      } else {
        try {
          const trackPlayback = await fetchMusicTrackPlayback({
            source: currentTrackSource,
            id: currentTrackId,
            quality: preferredPlaybackQuality,
          });

          if (disposed) {
            return;
          }

          const hydratedTrack = {
            ...currentTrack.track,
            ...trackPlayback.track,
            stream: trackPlayback.streamUrl,
          };

          usePlaybackStore.getState().updateTrack(hydratedTrack);
          engine.load(hydratedTrack.stream);
        } catch (error) {
          console.error('加载播放资源失败', error);
          usePlaybackStore
            .getState()
            .setError(resolveRootErrorMessage(error, '加载播放资源失败'));
          return;
        }
      }

      if (!needsLyrics) {
        return;
      }

      try {
        const lyrics = await fetchMusicLyricDocument({
          source: currentTrackSource,
          id: currentTrackId,
        });

        if (disposed) {
          return;
        }

        useLyricsStore.getState().setLyrics(lyrics);
      } catch (error) {
        console.error('加载歌词失败', error);
        usePlaybackStore
          .getState()
          .setError(resolveRootErrorMessage(error, '加载歌词失败'));
      }
    })();

    return () => {
      disposed = true;
    };
  }, [
    currentTrack,
    currentTrackId,
    currentTrackSource,
    currentTrackStream,
    hydrateDownloads,
    preferredPlaybackQuality,
  ]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !currentTrackId || !currentTrackStream) {
      return;
    }

    const engine = createAudioEngine(audio);
    engine.syncVolume(volume);
    engine.syncMuted(muted);
  }, [currentTrackId, currentTrackStream, muted, volume]);

  useEffect(() => {
    if (!currentTrack) {
      return;
    }

    const trackKey = `${currentTrack.track.source}+${currentTrack.track.id}`;

    if (recentTrackKeyRef.current === trackKey) {
      return;
    }

    recentTrackKeyRef.current = trackKey;

    void reportRecentTrack(currentTrack.track).catch((error) => {
      console.error('记录最近播放失败', error);
    });
  }, [currentTrack, reportRecentTrack]);

  useEffect(() => {
    if (!playbackSessionReadyRef.current) {
      return;
    }

    persistPlaybackSessionSnapshot(audioRef.current);
  }, [queueSessionSignature, currentTrackId]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !currentTrackId || !currentTrackStream) {
      return;
    }

    const engine = createAudioEngine(audio);

    if (playState === 'playing') {
      void engine.play();
      return;
    }

    if (playState === 'paused') {
      engine.pause();
    }
  }, [currentTrackId, currentTrackStream, playState]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const handleLoadedMetadata = () => {
      if (Number.isFinite(audio.duration)) {
        usePlaybackStore.getState().setDurationMs(audio.duration * 1000);
      }
    };
    const handleTimeUpdate = () => {
      const positionMs = audio.currentTime * 1000;
      usePlaybackStore.getState().setPositionMs(positionMs);

      const nextActiveLineIndex = resolveActiveLineIndex(positionMs);
      const currentActiveLineIndex = useLyricsStore.getState().activeLineIndex;

      if (nextActiveLineIndex !== currentActiveLineIndex) {
        useLyricsStore.getState().setActiveLineIndex(nextActiveLineIndex);
      }
    };
    const handleProgress = () => {
      usePlaybackStore.getState().setBufferedMs(resolveBufferedMs(audio));
    };
    const handlePause = () => {
      persistActiveTrackPlayback(audio, false);
      persistPlaybackSessionSnapshot(audio);
    };
    const handleEnded = () => {
      persistActiveTrackPlayback(audio, true);

      const playbackState = usePlaybackStore.getState();

      if (playbackState.playMode === 'single-loop') {
        audio.currentTime = 0;
        playbackState.setPositionMs(0);
        useLyricsStore.getState().setActiveLineIndex(resolveActiveLineIndex(0));
        persistPlaybackSessionSnapshot(audio);
        void createAudioEngine(audio).play();
        return;
      }

      void advancePlayback();
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('progress', handleProgress);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('progress', handleProgress);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [advancePlayback]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || requestedSeekMs === null) {
      return;
    }

    audio.currentTime = requestedSeekMs / 1000;
    usePlaybackStore.getState().setPositionMs(requestedSeekMs);
    usePlaybackStore.getState().clearRequestedSeek();

    const nextActiveLineIndex = resolveActiveLineIndex(requestedSeekMs);
    const currentActiveLineIndex = useLyricsStore.getState().activeLineIndex;

    if (nextActiveLineIndex !== currentActiveLineIndex) {
      useLyricsStore.getState().setActiveLineIndex(nextActiveLineIndex);
    }
  }, [requestedSeekMs]);

  useEffect(() => {
    const handlePageHide = () => {
      if (!playbackSessionReadyRef.current) {
        return;
      }

      persistPlaybackSessionSnapshot(audioRef.current);
    };

    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  useEffect(() => {
    bindMusicMediaSession(currentTrack);
  }, [currentTrack]);

  useEffect(() => {
    void syncDesktopMusicTrayState({
      currentTrack: currentTrack
        ? {
            title: currentTrack.track.title,
            artists: currentTrack.track.artists,
            source: currentTrack.track.source,
          }
        : null,
      playState,
      queueLength,
    }).catch((error) => {
      console.error('同步桌面音乐 tray 状态失败', error);
    });
  }, [currentTrack, playState, queueLength]);

  useEffect(() => {
    return bindDesktopMusicTrayControls({
      onOpenMusic: openMusicRouteFromTray,
      onTogglePlay: () => {
        const playbackState = usePlaybackStore.getState();

        if (!playbackState.currentTrackId) {
          return;
        }

        playbackState.setPlayState(
          playbackState.playState === 'playing' ? 'paused' : 'playing'
        );
      },
      onPlayNext: () => {
        const playbackState = usePlaybackStore.getState();

        if (!playbackState.currentTrackId || playbackState.queue.length === 0) {
          return;
        }

        void advancePlayback();
      },
      onPlayPrevious: () => {
        const playbackState = usePlaybackStore.getState();

        if (!playbackState.currentTrackId || playbackState.queue.length === 0) {
          return;
        }

        playbackState.playPrevious();
      },
    });
  }, [advancePlayback]);

  useEffect(() => {
    return bindMusicKeyboardShortcuts(
      () => {
        const playbackState = usePlaybackStore.getState();

        if (!playbackState.currentTrackId) {
          return;
        }

        playbackState.setPlayState(
          playbackState.playState === 'playing' ? 'paused' : 'playing'
        );
      },
      () => {
        const playbackState = usePlaybackStore.getState();

        if (!playbackState.currentTrackId || playbackState.queue.length === 0) {
          return;
        }

        void advancePlayback();
      }
    );
  }, [advancePlayback]);

  return (
    <>
      <MusicMiniPlayer />
      <MusicFullPlayer />
      <audio ref={audioRef} hidden preload='metadata' />
    </>
  );
}
