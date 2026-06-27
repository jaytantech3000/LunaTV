/* eslint-disable @next/next/no-img-element */

'use client';

import {
  ChevronUp,
  Disc3,
  Loader2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import { formatDurationSeconds } from '@/lib/music/format';
import type { PlayerQueueItem } from '@/lib/music/types';

interface MusicMiniPlayerProps {
  track: PlayerQueueItem;
  sidebarCollapsed: boolean;
  isPlaying: boolean;
  isTrackLoading: boolean;
  trackError: string | null;
  currentTimeSec: number;
  durationSec: number;
  volume: number;
  muted: boolean;
  onTogglePlay: () => void;
  onPlayPrevious: () => void;
  onPlayNext: () => void;
  onSeek: (nextTimeSec: number) => void;
  onVolumeChange: (nextVolume: number) => void;
  onToggleMute: () => void;
  onStop: () => void;
  onDismiss: () => void;
  onExpand: () => void;
}

export default function MusicMiniPlayer({
  track,
  sidebarCollapsed,
  isPlaying,
  isTrackLoading,
  trackError,
  currentTimeSec,
  durationSec,
  volume,
  muted,
  onTogglePlay,
  onPlayPrevious,
  onPlayNext,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onStop,
  onDismiss,
  onExpand,
}: MusicMiniPlayerProps) {
  const progressSliderMax = durationSec > 0 ? durationSec : 1;

  return (
    <div
      className={cn(
        'fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] left-2 right-2 z-[700] md:bottom-4 md:right-4',
        sidebarCollapsed ? 'md:left-20' : 'md:left-72'
      )}
    >
      <div
        role='group'
        aria-label='播放器控制条'
        className='overflow-hidden rounded-[36px] border border-emerald-400/25 bg-[linear-gradient(90deg,#08101f_0%,#0d1f33_48%,#0a5647_100%)] text-white shadow-[0_24px_70px_rgba(2,6,23,0.48)] backdrop-blur-2xl'
      >
        <div className='absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/65 to-transparent' />
        <div className='grid gap-5 px-5 py-5 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)_auto] lg:items-center'>
          <div className='min-w-0 space-y-4'>
            <div className='flex min-w-0 items-center gap-4'>
              <button
                type='button'
                onClick={onExpand}
                className='relative h-16 w-16 shrink-0 overflow-hidden rounded-[22px] border border-white/12 bg-white/10 transition-transform hover:scale-[1.02]'
                aria-label='展开播放器'
              >
                {track.cover ? (
                  <img
                    src={track.cover}
                    alt={track.title}
                    className='h-full w-full object-cover'
                  />
                ) : (
                  <div className='flex h-full w-full items-center justify-center'>
                    <Disc3 className='h-5 w-5 text-white/45' />
                  </div>
                )}
                {isTrackLoading ? (
                  <div className='absolute inset-0 flex items-center justify-center bg-slate-950/55 text-white'>
                    <Loader2 className='h-4 w-4 animate-spin' />
                  </div>
                ) : null}
              </button>

              <button
                type='button'
                onClick={onExpand}
                className='min-w-0 flex-1 text-left'
              >
                <div className='truncate text-lg font-semibold text-white'>
                  {track.title}
                </div>
                <div className='mt-1 truncate text-sm text-white/68'>
                  {track.artistsText}
                  {track.albumTitle ? ` · ${track.albumTitle}` : ''}
                </div>
                <div className='mt-3 truncate text-sm text-emerald-200/80'>
                  {track.subtitle || '等待歌词滚动'}
                </div>
              </button>
            </div>

            {trackError ? (
              <div className='rounded-[22px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-100'>
                {trackError}
              </div>
            ) : null}
          </div>

          <div className='space-y-5'>
            <div className='space-y-2'>
              <input
                type='range'
                min={0}
                max={progressSliderMax}
                step={1}
                value={Math.min(currentTimeSec, progressSliderMax)}
                onChange={(event) => onSeek(Number(event.target.value))}
                className='h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/14 accent-white'
                aria-label='播放进度'
              />
              <div className='flex items-center justify-between text-sm font-medium text-white/50'>
                <span>{formatDurationSeconds(currentTimeSec)}</span>
                <span>{formatDurationSeconds(durationSec)}</span>
              </div>
            </div>

            <div className='flex items-center gap-3'>
              <button
                type='button'
                onClick={onToggleMute}
                className='flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/35 bg-white/6 text-white/82 transition-colors hover:border-white hover:text-white'
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
                onChange={(event) => onVolumeChange(Number(event.target.value))}
                className='h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/14 accent-white'
                aria-label='音量'
              />
              <div className='w-10 text-right text-sm font-medium tabular-nums text-white/58'>
                {Math.round((muted ? 0 : volume) * 100)}
              </div>
            </div>
          </div>

          <div className='flex flex-col items-end gap-4'>
            <button
              type='button'
              onClick={onExpand}
              className='hidden h-14 w-14 items-center justify-center rounded-full border border-white/55 bg-white/6 text-white/85 transition-colors hover:border-white hover:text-white lg:inline-flex'
              aria-label='展开播放器'
            >
              <ChevronUp className='h-5 w-5' />
            </button>

            <div className='grid grid-cols-3 gap-3 sm:flex sm:items-center sm:justify-end'>
              <button
                type='button'
                onClick={onPlayPrevious}
                className='flex h-14 w-14 items-center justify-center rounded-full border border-white/35 bg-white/6 text-white/85 transition-colors hover:border-white hover:text-white'
                aria-label='上一首'
              >
                <SkipBack className='h-5 w-5' />
              </button>
              <button
                type='button'
                onClick={onTogglePlay}
                className='flex h-16 w-16 items-center justify-center rounded-full bg-white text-slate-950 transition-colors hover:bg-emerald-200'
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
                className='flex h-14 w-14 items-center justify-center rounded-full border border-white/35 bg-white/6 text-white/85 transition-colors hover:border-white hover:text-white'
                aria-label='下一首'
              >
                <SkipForward className='h-5 w-5' />
              </button>
              <button
                type='button'
                onClick={onStop}
                className='flex h-14 w-14 items-center justify-center rounded-full border border-white/35 bg-white/6 text-white/85 transition-colors hover:border-white hover:text-white'
                aria-label='停止播放'
              >
                <Square className='h-4 w-4 fill-current' />
              </button>
              <button
                type='button'
                onClick={onDismiss}
                className='flex h-14 w-14 items-center justify-center rounded-full border border-white/35 bg-white/6 text-white/85 transition-colors hover:border-white hover:text-white'
                aria-label='关闭播放器'
              >
                <X className='h-5 w-5' />
              </button>
              <button
                type='button'
                onClick={onExpand}
                className='flex h-14 w-14 items-center justify-center rounded-full border border-white/35 bg-white/6 text-white/85 transition-colors hover:border-white hover:text-white lg:hidden'
                aria-label='展开播放器'
              >
                <ChevronUp className='h-5 w-5' />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
