/* eslint-disable @next/next/no-img-element */

'use client';

import {
  ChevronDown,
  Disc3,
  Heart,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';
import { formatDurationSeconds, getPlayModeLabel } from '@/lib/music/format';
import type {
  MusicLyricPayload,
  MusicPlayMode,
  PlayerQueueItem,
} from '@/lib/music/types';

import MusicLyricsPanel from './MusicLyricsPanel';
import MusicQueuePanel from './MusicQueuePanel';

type MusicFullscreenPanel = 'lyrics' | 'queue';

interface MusicFullscreenPlayerProps {
  open: boolean;
  track: PlayerQueueItem;
  queue: PlayerQueueItem[];
  currentIndex: number;
  playMode: MusicPlayMode;
  isPlaying: boolean;
  isTrackLoading: boolean;
  trackError: string | null;
  currentTimeSec: number;
  durationSec: number;
  volume: number;
  muted: boolean;
  lyrics: MusicLyricPayload | null;
  isFavorited: boolean;
  isFavoriteLoading: boolean;
  onMinimize: () => void;
  onDismiss: () => void;
  onStop: () => void;
  onTogglePlay: () => void;
  onPlayPrevious: () => void;
  onPlayNext: () => void;
  onCyclePlayMode: () => void;
  onSeek: (nextTimeSec: number) => void;
  onVolumeChange: (nextVolume: number) => void;
  onToggleMute: () => void;
  onToggleFavorite: () => void;
  onSelectQueueIndex: (index: number) => void;
}

function renderPlayModeIcon(playMode: MusicPlayMode) {
  switch (playMode) {
    case 'single-loop':
      return <Repeat1 className='h-4 w-4' />;
    case 'shuffle':
      return <Shuffle className='h-4 w-4' />;
    case 'list-loop':
    default:
      return <Repeat className='h-4 w-4' />;
  }
}

export default function MusicFullscreenPlayer({
  open,
  track,
  queue,
  currentIndex,
  playMode,
  isPlaying,
  isTrackLoading,
  trackError,
  currentTimeSec,
  durationSec,
  volume,
  muted,
  lyrics,
  isFavorited,
  isFavoriteLoading,
  onMinimize,
  onDismiss,
  onStop,
  onTogglePlay,
  onPlayPrevious,
  onPlayNext,
  onCyclePlayMode,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleFavorite,
  onSelectQueueIndex,
}: MusicFullscreenPlayerProps) {
  const [panel, setPanel] = useState<MusicFullscreenPanel>('lyrics');

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onMinimize();
      }
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onMinimize, open]);

  if (!open) {
    return null;
  }

  const sliderMax = durationSec > 0 ? durationSec : 1;
  const currentTrackKey = `${track.source}:${track.trackId}`;

  return (
    <div
      role='dialog'
      aria-modal='true'
      aria-label='展开播放器'
      className='pointer-events-auto absolute inset-0 overflow-y-auto rounded-[36px] border border-emerald-400/15 bg-[linear-gradient(180deg,rgba(5,10,20,0.98),rgba(10,24,38,0.98)_45%,rgba(9,70,58,0.96))] text-white shadow-[0_32px_90px_rgba(2,6,23,0.45)]'
    >
      {track.cover ? (
        <div
          aria-hidden='true'
          className='absolute inset-0 opacity-30'
          style={{
            backgroundImage: `url(${track.cover})`,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
            filter: 'blur(52px)',
            transform: 'scale(1.08)',
          }}
        />
      ) : null}
      <div className='absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_24%),linear-gradient(180deg,rgba(11,18,33,0.3),rgba(2,6,23,0.68))]' />

      <div className='relative flex min-h-full flex-col p-4 sm:p-6'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <div className='text-xs uppercase tracking-[0.28em] text-white/45'>
              LunaTV Music
            </div>
            <div className='mt-1 text-sm text-white/72'>网易云风格控制台</div>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <button
              type='button'
              onClick={onStop}
              className='inline-flex h-12 items-center gap-2 rounded-full border border-white/20 bg-white/8 px-4 text-sm text-white/80 transition-colors hover:border-white hover:text-white'
              aria-label='停止播放'
            >
              <Square className='h-3.5 w-3.5 fill-current' />
              停止
            </button>
            <button
              type='button'
              onClick={onMinimize}
              className='inline-flex h-12 items-center gap-2 rounded-full border border-white/20 bg-white/8 px-4 text-sm text-white/80 transition-colors hover:border-white hover:text-white'
              aria-label='收起到迷你播放器'
            >
              <ChevronDown className='h-4 w-4' />
              收起
            </button>
            <button
              type='button'
              onClick={onDismiss}
              className='inline-flex h-12 items-center gap-2 rounded-full border border-white/20 bg-white/8 px-4 text-sm text-white/80 transition-colors hover:border-white hover:text-white'
              aria-label='关闭播放器'
            >
              <X className='h-4 w-4' />
              关闭
            </button>
          </div>
        </div>

        <div className='mt-6 grid flex-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,420px)] xl:items-start'>
          <div className='overflow-hidden rounded-[36px] border border-white/12 bg-black/10 p-5 shadow-2xl shadow-black/25 backdrop-blur-xl sm:p-6'>
            <div className='grid gap-8 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)] lg:items-center'>
              <div className='mx-auto w-full max-w-[320px] overflow-hidden rounded-[32px] border border-white/10 bg-white/10 shadow-[0_20px_60px_rgba(2,6,23,0.45)]'>
                {track.cover ? (
                  <img
                    src={track.cover}
                    alt={track.title}
                    className='aspect-square w-full object-cover'
                  />
                ) : (
                  <div className='flex aspect-square items-center justify-center'>
                    <Disc3 className='h-10 w-10 text-white/45' />
                  </div>
                )}
              </div>

              <div className='space-y-5'>
                <div>
                  <div className='text-xs uppercase tracking-[0.28em] text-white/40'>
                    {track.source}
                  </div>
                  <h1 className='mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl'>
                    {track.title}
                  </h1>
                  <p className='mt-3 text-lg text-white/72'>
                    {track.artistsText}
                    {track.albumTitle ? ` · ${track.albumTitle}` : ''}
                  </p>
                  {track.subtitle ? (
                    <div className='mt-4 rounded-full bg-white/8 px-4 py-2 text-sm text-emerald-200/85'>
                      {track.subtitle}
                    </div>
                  ) : null}
                </div>

                <div className='space-y-3'>
                  <input
                    type='range'
                    min={0}
                    max={sliderMax}
                    step={1}
                    value={Math.min(currentTimeSec, sliderMax)}
                    onChange={(event) => onSeek(Number(event.target.value))}
                    className='h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-white'
                    aria-label='播放进度'
                  />
                  <div className='flex items-center justify-between text-sm text-white/50'>
                    <span>{formatDurationSeconds(currentTimeSec)}</span>
                    <span>{formatDurationSeconds(durationSec)}</span>
                  </div>
                </div>

                <div className='flex flex-wrap items-center gap-4'>
                  <button
                    type='button'
                    onClick={onPlayPrevious}
                    className='flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-white/5 transition-colors hover:border-white hover:bg-white/10'
                    aria-label='上一首'
                  >
                    <SkipBack className='h-5 w-5' />
                  </button>
                  <button
                    type='button'
                    onClick={onTogglePlay}
                    className='flex h-16 w-16 items-center justify-center rounded-full bg-white text-slate-950 shadow-[0_16px_40px_rgba(255,255,255,0.24)] transition-transform hover:scale-[1.02]'
                    aria-label={isPlaying ? '暂停' : '播放'}
                  >
                    {isTrackLoading ? (
                      <Loader2 className='h-5 w-5 animate-spin' />
                    ) : isPlaying ? (
                      <Pause className='h-5 w-5 fill-current' />
                    ) : (
                      <Play className='h-5 w-5 fill-current' />
                    )}
                  </button>
                  <button
                    type='button'
                    onClick={onPlayNext}
                    className='flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-white/5 transition-colors hover:border-white hover:bg-white/10'
                    aria-label='下一首'
                  >
                    <SkipForward className='h-5 w-5' />
                  </button>
                  <button
                    type='button'
                    onClick={onToggleFavorite}
                    disabled={isFavoriteLoading}
                    className='inline-flex h-12 items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 text-sm text-white/75 transition-colors hover:border-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60'
                    aria-label={
                      isFavorited ? '取消收藏当前歌曲' : '收藏当前歌曲'
                    }
                  >
                    {isFavoriteLoading ? (
                      <Loader2 className='h-4 w-4 animate-spin' />
                    ) : (
                      <Heart
                        className={cn(
                          'h-4 w-4',
                          isFavorited
                            ? 'fill-rose-500 text-rose-500'
                            : 'text-white/75'
                        )}
                      />
                    )}
                    <span>{isFavorited ? '已收藏' : '收藏'}</span>
                  </button>
                  <button
                    type='button'
                    onClick={onCyclePlayMode}
                    className='inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-3 text-sm text-white/75 transition-colors hover:border-white hover:bg-white/10'
                    aria-label={`切换播放模式，当前为 ${getPlayModeLabel(
                      playMode
                    )}`}
                  >
                    {renderPlayModeIcon(playMode)}
                    <span>{getPlayModeLabel(playMode)}</span>
                  </button>
                </div>

                <div className='flex flex-wrap items-center gap-3'>
                  <button
                    type='button'
                    onClick={onToggleMute}
                    className='flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/5 transition-colors hover:border-white hover:bg-white/10'
                    aria-label={muted ? '取消静音' : '静音'}
                  >
                    {muted ? (
                      <VolumeX className='h-4 w-4' />
                    ) : (
                      <Volume2 className='h-4 w-4' />
                    )}
                  </button>
                  <input
                    type='range'
                    min={0}
                    max={1}
                    step={0.01}
                    value={muted ? 0 : volume}
                    onChange={(event) =>
                      onVolumeChange(Number(event.target.value))
                    }
                    className='h-1.5 w-full max-w-[240px] cursor-pointer appearance-none rounded-full bg-white/15 accent-white'
                    aria-label='音量'
                  />
                  <div className='text-sm text-white/50'>
                    {Math.round((muted ? 0 : volume) * 100)}%
                  </div>
                </div>

                {trackError ? (
                  <div className='rounded-[24px] border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100'>
                    {trackError}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className='overflow-hidden rounded-[36px] border border-white/12 bg-black/10 p-5 shadow-2xl shadow-black/25 backdrop-blur-xl sm:p-6'>
            <div className='flex items-center justify-between gap-3'>
              <div>
                <div className='text-lg font-semibold text-white'>播放视图</div>
                <div className='mt-1 text-sm text-white/55'>
                  当前第 {currentIndex + 1} 首，共 {queue.length} 首
                </div>
              </div>
              <div className='inline-flex rounded-full border border-white/15 bg-white/6 p-1'>
                <button
                  type='button'
                  onClick={() => setPanel('lyrics')}
                  className={cn(
                    'rounded-full px-4 py-2 text-sm transition-colors',
                    panel === 'lyrics'
                      ? 'bg-white text-slate-950'
                      : 'text-white/65 hover:text-white'
                  )}
                >
                  歌词
                </button>
                <button
                  type='button'
                  onClick={() => setPanel('queue')}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors',
                    panel === 'queue'
                      ? 'bg-white text-slate-950'
                      : 'text-white/65 hover:text-white'
                  )}
                >
                  <ListMusic className='h-4 w-4' />
                  队列
                </button>
              </div>
            </div>

            <div className='mt-6'>
              {panel === 'lyrics' ? (
                <MusicLyricsPanel
                  lyrics={lyrics}
                  currentTimeSec={currentTimeSec}
                />
              ) : (
                <MusicQueuePanel
                  queue={queue}
                  currentTrackKey={currentTrackKey}
                  onSelectTrack={onSelectQueueIndex}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
