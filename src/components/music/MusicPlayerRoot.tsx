'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { DESKTOP_RUNTIME_UPDATED_EVENT } from '@/lib/desktop/runtime-config';
import {
  bindMusicMediaSessionAction,
  setMusicMediaSessionMetadata,
  setMusicMediaSessionPlaybackState,
  setMusicMediaSessionPositionState,
} from '@/lib/music/media-session';
import {
  deleteMusicFavorite,
  isMusicFavorited,
  saveMusicFavorite,
  saveMusicPlayRecord,
  saveMusicRecentTrack,
} from '@/lib/music/profile';
import { getRuntimeConfig } from '@/lib/runtime-config';
import {
  buildMusicStreamUrl,
  fetchMusicLyric,
  fetchMusicTrack,
} from '@/lib/transport/music-client';

import {
  getCurrentQueueTrack,
  getCurrentTrackKey,
  useMusicPlayerStore,
} from '@/stores/musicPlayerStore';

import { MUSIC_PLAYER_EXPANDED_SLOT_ID } from './constants';
import MusicFullscreenPlayer from './MusicFullscreenPlayer';
import MusicMiniPlayer from './MusicMiniPlayer';

function resolveMusicEnabled() {
  return Boolean(getRuntimeConfig().ENABLE_WEB_MUSIC);
}

function resolveSidebarCollapsed() {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    Boolean(
      (window as Window & { __sidebarCollapsed?: boolean }).__sidebarCollapsed
    ) || document.documentElement.dataset.sidebarCollapsed === 'true'
  );
}

function logMusicProfileFailure(message: string, error: unknown): void {
  // eslint-disable-next-line no-console
  console.error(message, error);
}

export default function MusicPlayerRoot() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingExpandOnMusicPageRef = useRef(false);
  const resolvedTrackKeyRef = useRef('');
  const pathname = usePathname();
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [expandedSlot, setExpandedSlot] = useState<HTMLElement | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);

  const hasHydrated = useMusicPlayerStore((state) => state.hasHydrated);
  const currentTrack = useMusicPlayerStore(getCurrentQueueTrack);
  const queue = useMusicPlayerStore((state) => state.queue);
  const currentIndex = useMusicPlayerStore((state) => state.currentIndex);
  const playMode = useMusicPlayerStore((state) => state.playMode);
  const isPlaying = useMusicPlayerStore((state) => state.isPlaying);
  const presentation = useMusicPlayerStore((state) => state.presentation);
  const durationSec = useMusicPlayerStore((state) => state.durationSec);
  const currentTimeSec = useMusicPlayerStore((state) => state.currentTimeSec);
  const volume = useMusicPlayerStore((state) => state.volume);
  const muted = useMusicPlayerStore((state) => state.muted);
  const streamUrl = useMusicPlayerStore((state) => state.streamUrl);
  const lyrics = useMusicPlayerStore((state) => state.lyrics);
  const isTrackLoading = useMusicPlayerStore((state) => state.isTrackLoading);
  const trackError = useMusicPlayerStore((state) => state.trackError);

  const togglePlay = useMusicPlayerStore((state) => state.togglePlay);
  const setIsPlaying = useMusicPlayerStore((state) => state.setIsPlaying);
  const playNext = useMusicPlayerStore((state) => state.playNext);
  const playPrevious = useMusicPlayerStore((state) => state.playPrevious);
  const cyclePlayMode = useMusicPlayerStore((state) => state.cyclePlayMode);
  const expandPlayer = useMusicPlayerStore((state) => state.expandPlayer);
  const collapsePlayer = useMusicPlayerStore((state) => state.collapsePlayer);
  const dismissPlayer = useMusicPlayerStore((state) => state.dismissPlayer);
  const stopPlayback = useMusicPlayerStore((state) => state.stopPlayback);
  const setVolume = useMusicPlayerStore((state) => state.setVolume);
  const setMuted = useMusicPlayerStore((state) => state.setMuted);
  const setCurrentTimeSec = useMusicPlayerStore(
    (state) => state.setCurrentTimeSec
  );
  const setDurationSec = useMusicPlayerStore((state) => state.setDurationSec);
  const setStreamUrl = useMusicPlayerStore((state) => state.setStreamUrl);
  const setLyrics = useMusicPlayerStore((state) => state.setLyrics);
  const setTrackLoading = useMusicPlayerStore((state) => state.setTrackLoading);
  const setTrackError = useMusicPlayerStore((state) => state.setTrackError);
  const syncRecentTrack = useMusicPlayerStore((state) => state.syncRecentTrack);
  const selectQueueIndex = useMusicPlayerStore(
    (state) => state.selectQueueIndex
  );
  const resetTransientPlaybackState = useMusicPlayerStore(
    (state) => state.resetTransientPlaybackState
  );

  const currentTrackKey = getCurrentTrackKey(currentTrack);
  const isMusicPage = pathname?.startsWith('/music') ?? false;

  useEffect(() => {
    const syncEnabledState = () => {
      setEnabled(resolveMusicEnabled());
    };

    const syncSidebarState = () => {
      setSidebarCollapsed(resolveSidebarCollapsed());
    };

    syncEnabledState();
    syncSidebarState();

    window.addEventListener(DESKTOP_RUNTIME_UPDATED_EVENT, syncEnabledState);

    const observer =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(syncSidebarState)
        : null;
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-sidebar-collapsed'],
    });

    return () => {
      window.removeEventListener(
        DESKTOP_RUNTIME_UPDATED_EVENT,
        syncEnabledState
      );
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.style.setProperty(
      '--music-player-safe-offset',
      enabled && hasHydrated && currentTrack && presentation !== 'hidden'
        ? '104px'
        : '0px'
    );

    return () => {
      document.documentElement.style.setProperty(
        '--music-player-safe-offset',
        '0px'
      );
    };
  }, [currentTrack, enabled, hasHydrated, presentation]);

  useEffect(() => {
    if (enabled !== false) {
      return;
    }

    audioRef.current?.pause();
    pendingExpandOnMusicPageRef.current = false;
    dismissPlayer();
  }, [dismissPlayer, enabled]);

  useEffect(() => {
    if (!isMusicPage && presentation === 'expanded') {
      collapsePlayer();
    }
  }, [collapsePlayer, isMusicPage, presentation]);

  useEffect(() => {
    if (!isMusicPage || !currentTrack || !pendingExpandOnMusicPageRef.current) {
      return;
    }

    pendingExpandOnMusicPageRef.current = false;
    expandPlayer();
  }, [currentTrack, expandPlayer, isMusicPage]);

  useEffect(() => {
    if (!isMusicPage) {
      setExpandedSlot(null);
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      setExpandedSlot(
        document.getElementById(
          MUSIC_PLAYER_EXPANDED_SLOT_ID
        ) as HTMLElement | null
      );
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [currentTrackKey, isMusicPage, presentation]);

  useEffect(() => {
    if (!enabled || !hasHydrated) {
      return;
    }

    if (!currentTrack) {
      resolvedTrackKeyRef.current = '';
      resetTransientPlaybackState();
      if (isPlaying) {
        setIsPlaying(false);
      }
      if (presentation !== 'hidden') {
        dismissPlayer();
      }
      return;
    }

    if (streamUrl && resolvedTrackKeyRef.current === currentTrackKey) {
      return;
    }

    let cancelled = false;

    setTrackLoading(true);
    setTrackError(null);

    const loadCurrentTrack = async () => {
      try {
        const [trackPayload, lyricPayload] = await Promise.all([
          fetchMusicTrack({
            source: currentTrack.source,
            id: currentTrack.trackId,
          }),
          fetchMusicLyric({
            source: currentTrack.source,
            id: currentTrack.trackId,
          }).catch(() => null),
        ]);

        if (cancelled) {
          return;
        }

        const nextStreamUrl = /^https?:\/\//.test(trackPayload.streamUrl)
          ? trackPayload.streamUrl
          : buildMusicStreamUrl({
              source: currentTrack.source,
              id: currentTrack.trackId,
              quality: trackPayload.quality,
            });

        resolvedTrackKeyRef.current = currentTrackKey;
        setStreamUrl(nextStreamUrl);
        setLyrics(lyricPayload);
        setDurationSec((trackPayload.track.durationMs || 0) / 1000);
        setTrackLoading(false);
        syncRecentTrack(currentTrack);
        void saveMusicRecentTrack(currentTrack).catch((error) => {
          logMusicProfileFailure('保存音乐最近播放失败:', error);
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        resolvedTrackKeyRef.current = '';
        setStreamUrl(null);
        setLyrics(null);
        setTrackLoading(false);
        setTrackError(
          error instanceof Error ? error.message : '加载音乐播放信息失败'
        );
        setIsPlaying(false);
      }
    };

    void loadCurrentTrack();

    return () => {
      cancelled = true;
    };
  }, [
    currentTrack,
    currentTrackKey,
    enabled,
    hasHydrated,
    isPlaying,
    presentation,
    dismissPlayer,
    resetTransientPlaybackState,
    setDurationSec,
    setIsPlaying,
    setLyrics,
    setStreamUrl,
    setTrackError,
    setTrackLoading,
    streamUrl,
    syncRecentTrack,
  ]);

  useEffect(() => {
    if (!currentTrack) {
      setIsFavorited(false);
      setFavoriteLoading(false);
      return;
    }

    let cancelled = false;

    const syncFavoriteState = async () => {
      try {
        const favorited = await isMusicFavorited(
          currentTrack.source,
          currentTrack.trackId
        );
        if (!cancelled) {
          setIsFavorited(favorited);
        }
      } catch (error) {
        if (!cancelled) {
          setIsFavorited(false);
        }
        logMusicProfileFailure('读取音乐收藏状态失败:', error);
      }
    };

    void syncFavoriteState();

    return () => {
      cancelled = true;
    };
  }, [currentTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!streamUrl) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      return;
    }

    audio.src = streamUrl;
    audio.load();
  }, [streamUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.volume = volume;
    audio.muted = muted;
  }, [muted, volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !streamUrl) {
      return;
    }

    if (!isPlaying) {
      audio.pause();
      return;
    }

    const playPromise = audio.play();

    if (!playPromise || typeof playPromise.catch !== 'function') {
      return;
    }

    playPromise.catch(() => {
      setIsPlaying(false);
      setTrackError('自动播放被浏览器拦截，请再点击一次播放。');
    });
  }, [isPlaying, setIsPlaying, setTrackError, streamUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || isPlaying || currentTimeSec !== 0) {
      return;
    }

    audio.currentTime = 0;
  }, [currentTimeSec, isPlaying]);

  useEffect(() => {
    if (!currentTrack) {
      setMusicMediaSessionMetadata(null);
      return;
    }

    setMusicMediaSessionMetadata(currentTrack);
  }, [currentTrack]);

  useEffect(() => {
    setMusicMediaSessionPlaybackState(isPlaying);
  }, [isPlaying]);

  useEffect(() => {
    setMusicMediaSessionPositionState({
      durationSec,
      currentTimeSec,
    });
  }, [currentTimeSec, durationSec]);

  useEffect(() => {
    const handleSeekTo: MediaSessionActionHandler = (details) => {
      const seekTime = details?.seekTime;
      if (typeof seekTime !== 'number') {
        return;
      }

      const audio = audioRef.current;
      if (!audio) {
        return;
      }

      audio.currentTime = seekTime;
      setCurrentTimeSec(seekTime);
    };

    bindMusicMediaSessionAction('play', () => setIsPlaying(true));
    bindMusicMediaSessionAction('pause', () => setIsPlaying(false));
    bindMusicMediaSessionAction('previoustrack', () => playPrevious());
    bindMusicMediaSessionAction('nexttrack', () => playNext());
    bindMusicMediaSessionAction('seekto', handleSeekTo);

    return () => {
      bindMusicMediaSessionAction('play', null);
      bindMusicMediaSessionAction('pause', null);
      bindMusicMediaSessionAction('previoustrack', null);
      bindMusicMediaSessionAction('nexttrack', null);
      bindMusicMediaSessionAction('seekto', null);
    };
  }, [playNext, playPrevious, setCurrentTimeSec, setIsPlaying]);

  const handleSeek = (nextTimeSec: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(nextTimeSec)) {
      return;
    }

    audio.currentTime = nextTimeSec;
    setCurrentTimeSec(nextTimeSec);
  };

  const handleVolumeChange = (nextVolume: number) => {
    setVolume(nextVolume);
    setMuted(nextVolume <= 0);
  };

  const handleStopPlayback = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    stopPlayback();
  };

  const handleDismissPlayer = () => {
    audioRef.current?.pause();
    pendingExpandOnMusicPageRef.current = false;
    dismissPlayer();
  };

  const handleExpandPlayer = () => {
    if (!currentTrack) {
      return;
    }

    if (!isMusicPage) {
      pendingExpandOnMusicPageRef.current = true;
      router.push('/music');
      return;
    }

    expandPlayer();
  };

  const persistPlaybackSnapshot = (completed = false) => {
    if (!currentTrack) {
      return;
    }

    const normalizedDurationSec =
      Number.isFinite(durationSec) && durationSec >= 0
        ? durationSec
        : Math.max((currentTrack.durationMs || 0) / 1000, 0);
    const normalizedPlayTimeSec = completed
      ? normalizedDurationSec
      : Number.isFinite(currentTimeSec) && currentTimeSec >= 0
      ? currentTimeSec
      : 0;

    void saveMusicPlayRecord(currentTrack, {
      playTimeSec: normalizedPlayTimeSec,
      durationSec: normalizedDurationSec,
      completed,
    }).catch((error) => {
      logMusicProfileFailure('保存音乐播放记录失败:', error);
    });
  };

  const handleToggleFavorite = async () => {
    if (!currentTrack || favoriteLoading) {
      return;
    }

    setFavoriteLoading(true);

    try {
      if (isFavorited) {
        await deleteMusicFavorite(currentTrack.source, currentTrack.trackId);
        setIsFavorited(false);
      } else {
        await saveMusicFavorite(currentTrack);
        setIsFavorited(true);
      }
    } catch (error) {
      logMusicProfileFailure('切换音乐收藏状态失败:', error);
    } finally {
      setFavoriteLoading(false);
    }
  };

  const shouldRenderPlayer = Boolean(enabled && hasHydrated && currentTrack);
  const shouldShowMiniPlayer =
    shouldRenderPlayer &&
    presentation !== 'hidden' &&
    (!isMusicPage || presentation === 'mini' || !expandedSlot);
  const shouldShowExpandedPlayer =
    shouldRenderPlayer &&
    isMusicPage &&
    presentation === 'expanded' &&
    Boolean(expandedSlot);

  return (
    <>
      <audio
        ref={audioRef}
        hidden
        preload='metadata'
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (!audio) {
            return;
          }

          if (currentTimeSec > 0 && currentTimeSec < audio.duration) {
            audio.currentTime = currentTimeSec;
          }

          setDurationSec(audio.duration);
        }}
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (!audio) {
            return;
          }

          setCurrentTimeSec(audio.currentTime);
        }}
        onPlaying={() => {
          setTrackLoading(false);
          setTrackError(null);
          setIsPlaying(true);
        }}
        onPause={() => {
          const audio = audioRef.current;
          if (!audio?.ended && !isTrackLoading) {
            persistPlaybackSnapshot(false);
            setIsPlaying(false);
          }
        }}
        onWaiting={() => {
          if (currentTrack) {
            setTrackLoading(true);
          }
        }}
        onEnded={() => {
          persistPlaybackSnapshot(true);
          playNext();
        }}
        onError={() => {
          setTrackLoading(false);
          setTrackError('音频播放失败，请尝试切换曲目后重试。');
          setIsPlaying(false);
        }}
      />

      {shouldShowMiniPlayer && currentTrack ? (
        <MusicMiniPlayer
          track={currentTrack}
          sidebarCollapsed={sidebarCollapsed}
          isPlaying={isPlaying}
          isTrackLoading={isTrackLoading}
          trackError={trackError}
          currentTimeSec={currentTimeSec}
          durationSec={durationSec}
          volume={volume}
          muted={muted}
          onTogglePlay={togglePlay}
          onPlayPrevious={playPrevious}
          onPlayNext={playNext}
          onSeek={handleSeek}
          onVolumeChange={handleVolumeChange}
          onToggleMute={() => setMuted(!muted)}
          onStop={handleStopPlayback}
          onDismiss={handleDismissPlayer}
          onExpand={handleExpandPlayer}
        />
      ) : null}

      {shouldShowExpandedPlayer && currentTrack && expandedSlot
        ? createPortal(
            <MusicFullscreenPlayer
              open={true}
              track={currentTrack}
              queue={queue}
              currentIndex={currentIndex}
              playMode={playMode}
              isPlaying={isPlaying}
              isTrackLoading={isTrackLoading}
              trackError={trackError}
              currentTimeSec={currentTimeSec}
              durationSec={durationSec}
              volume={volume}
              muted={muted}
              lyrics={lyrics}
              isFavorited={isFavorited}
              isFavoriteLoading={favoriteLoading}
              onMinimize={collapsePlayer}
              onDismiss={handleDismissPlayer}
              onStop={handleStopPlayback}
              onTogglePlay={togglePlay}
              onPlayPrevious={playPrevious}
              onPlayNext={playNext}
              onCyclePlayMode={cyclePlayMode}
              onSeek={handleSeek}
              onVolumeChange={handleVolumeChange}
              onToggleMute={() => setMuted(!muted)}
              onToggleFavorite={() => {
                void handleToggleFavorite();
              }}
              onSelectQueueIndex={(index) => selectQueueIndex(index, true)}
            />,
            expandedSlot
          )
        : null}
    </>
  );
}
