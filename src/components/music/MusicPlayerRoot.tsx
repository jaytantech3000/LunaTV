'use client';

import { useEffect, useRef, useState } from 'react';

import { DESKTOP_RUNTIME_UPDATED_EVENT } from '@/lib/desktop/runtime-config';
import {
  bindMusicMediaSessionAction,
  setMusicMediaSessionMetadata,
  setMusicMediaSessionPlaybackState,
  setMusicMediaSessionPositionState,
} from '@/lib/music/media-session';
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

export default function MusicPlayerRoot() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const resolvedTrackKeyRef = useRef('');
  const [enabled, setEnabled] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const hasHydrated = useMusicPlayerStore((state) => state.hasHydrated);
  const currentTrack = useMusicPlayerStore(getCurrentQueueTrack);
  const queue = useMusicPlayerStore((state) => state.queue);
  const currentIndex = useMusicPlayerStore((state) => state.currentIndex);
  const playMode = useMusicPlayerStore((state) => state.playMode);
  const isPlaying = useMusicPlayerStore((state) => state.isPlaying);
  const expanded = useMusicPlayerStore((state) => state.expanded);
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
  const setExpanded = useMusicPlayerStore((state) => state.setExpanded);
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
      enabled && hasHydrated && currentTrack ? '104px' : '0px'
    );

    return () => {
      document.documentElement.style.setProperty(
        '--music-player-safe-offset',
        '0px'
      );
    };
  }, [currentTrack, enabled, hasHydrated]);

  useEffect(() => {
    if (enabled) {
      return;
    }

    audioRef.current?.pause();
    setExpanded(false);
  }, [enabled, setExpanded]);

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
            setIsPlaying(false);
          }
        }}
        onWaiting={() => {
          if (currentTrack) {
            setTrackLoading(true);
          }
        }}
        onEnded={() => {
          playNext();
        }}
        onError={() => {
          setTrackLoading(false);
          setTrackError('音频播放失败，请尝试切换曲目后重试。');
          setIsPlaying(false);
        }}
      />

      {enabled && hasHydrated && currentTrack ? (
        <>
          <MusicMiniPlayer
            track={currentTrack}
            sidebarCollapsed={sidebarCollapsed}
            isPlaying={isPlaying}
            isTrackLoading={isTrackLoading}
            trackError={trackError}
            currentTimeSec={currentTimeSec}
            durationSec={durationSec}
            muted={muted}
            onTogglePlay={togglePlay}
            onPlayPrevious={playPrevious}
            onPlayNext={playNext}
            onSeek={handleSeek}
            onToggleMute={() => setMuted(!muted)}
            onExpand={() => setExpanded(true)}
          />
          <MusicFullscreenPlayer
            open={expanded}
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
            onClose={() => setExpanded(false)}
            onTogglePlay={togglePlay}
            onPlayPrevious={playPrevious}
            onPlayNext={playNext}
            onCyclePlayMode={cyclePlayMode}
            onSeek={handleSeek}
            onVolumeChange={handleVolumeChange}
            onToggleMute={() => setMuted(!muted)}
            onSelectQueueIndex={(index) => selectQueueIndex(index, true)}
          />
        </>
      ) : null}
    </>
  );
}
