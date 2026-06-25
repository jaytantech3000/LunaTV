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
  Volume2,
  VolumeX,
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
  muted: boolean;
  onTogglePlay: () => void;
  onPlayPrevious: () => void;
  onPlayNext: () => void;
  onSeek: (nextTimeSec: number) => void;
  onToggleMute: () => void;
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
  muted,
  onTogglePlay,
  onPlayPrevious,
  onPlayNext,
  onSeek,
  onToggleMute,
  onExpand,
}: MusicMiniPlayerProps) {
  const sliderMax = durationSec > 0 ? durationSec : 1;

  return (
    <div
      className={cn(
        'fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] left-2 right-2 z-[700] md:bottom-4 md:right-4',
        sidebarCollapsed ? 'md:left-20' : 'md:left-72'
      )}
    >
      <div className='overflow-hidden rounded-[28px] border border-white/70 bg-white/90 shadow-2xl shadow-slate-950/10 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/88 dark:shadow-black/30'>
        <div className='grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
          <div className='min-w-0 space-y-3'>
            <div className='flex min-w-0 items-center gap-3'>
              <button
                type='button'
                onClick={onExpand}
                className='relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-slate-100 transition-transform hover:scale-[1.02] dark:bg-slate-800'
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
                    <Disc3 className='h-5 w-5 text-slate-400' />
                  </div>
                )}
                {isTrackLoading ? (
                  <div className='absolute inset-0 flex items-center justify-center bg-slate-950/45 text-white'>
                    <Loader2 className='h-4 w-4 animate-spin' />
                  </div>
                ) : null}
              </button>

              <button
                type='button'
                onClick={onExpand}
                className='min-w-0 flex-1 text-left'
              >
                <div className='truncate text-sm font-semibold text-slate-950 dark:text-white'>
                  {track.title}
                </div>
                <div className='mt-1 truncate text-xs text-slate-500 dark:text-slate-400'>
                  {track.artistsText}
                  {track.albumTitle ? ` · ${track.albumTitle}` : ''}
                </div>
                {track.subtitle ? (
                  <div className='mt-1 truncate text-[11px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500'>
                    {track.subtitle}
                  </div>
                ) : null}
              </button>

              <button
                type='button'
                onClick={onExpand}
                className='hidden h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition-colors hover:border-emerald-400 hover:text-emerald-600 sm:inline-flex dark:border-slate-700 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-300'
                aria-label='展开播放器'
              >
                <ChevronUp className='h-4 w-4' />
              </button>
            </div>

            <div className='space-y-2'>
              <input
                type='range'
                min={0}
                max={sliderMax}
                step={1}
                value={Math.min(currentTimeSec, sliderMax)}
                onChange={(event) => onSeek(Number(event.target.value))}
                className='h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-emerald-500 dark:bg-slate-700'
                aria-label='播放进度'
              />
              <div className='flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500'>
                <span>{formatDurationSeconds(currentTimeSec)}</span>
                <span>{formatDurationSeconds(durationSec)}</span>
              </div>
            </div>

            {trackError ? (
              <div className='text-xs text-rose-500 dark:text-rose-300'>
                {trackError}
              </div>
            ) : null}
          </div>

          <div className='flex items-center justify-between gap-2 sm:justify-end'>
            <button
              type='button'
              onClick={onPlayPrevious}
              className='flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition-colors hover:border-emerald-400 hover:text-emerald-600 dark:border-slate-700 dark:text-slate-200 dark:hover:border-emerald-400 dark:hover:text-emerald-300'
              aria-label='上一首'
            >
              <SkipBack className='h-4 w-4' />
            </button>
            <button
              type='button'
              onClick={onTogglePlay}
              className='flex h-12 w-12 items-center justify-center rounded-full bg-slate-950 text-white transition-colors hover:bg-emerald-600 dark:bg-white dark:text-slate-950 dark:hover:bg-emerald-300'
              aria-label={isPlaying ? '暂停' : '播放'}
            >
              {isTrackLoading ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : isPlaying ? (
                <Pause className='h-4 w-4 fill-current' />
              ) : (
                <Play className='h-4 w-4 fill-current' />
              )}
            </button>
            <button
              type='button'
              onClick={onPlayNext}
              className='flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition-colors hover:border-emerald-400 hover:text-emerald-600 dark:border-slate-700 dark:text-slate-200 dark:hover:border-emerald-400 dark:hover:text-emerald-300'
              aria-label='下一首'
            >
              <SkipForward className='h-4 w-4' />
            </button>
            <button
              type='button'
              onClick={onToggleMute}
              className='hidden h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition-colors hover:border-emerald-400 hover:text-emerald-600 md:inline-flex dark:border-slate-700 dark:text-slate-200 dark:hover:border-emerald-400 dark:hover:text-emerald-300'
              aria-label={muted ? '取消静音' : '静音'}
            >
              {muted ? (
                <VolumeX className='h-4 w-4' />
              ) : (
                <Volume2 className='h-4 w-4' />
              )}
            </button>
            <button
              type='button'
              onClick={onExpand}
              className='flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition-colors hover:border-emerald-400 hover:text-emerald-600 sm:hidden dark:border-slate-700 dark:text-slate-200 dark:hover:border-emerald-400 dark:hover:text-emerald-300'
              aria-label='展开播放器'
            >
              <ChevronUp className='h-4 w-4' />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
