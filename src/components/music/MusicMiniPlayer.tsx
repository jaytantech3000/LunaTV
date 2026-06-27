/* eslint-disable @next/next/no-img-element */

'use client';

import {
  ChevronUp,
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
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import { formatDurationSeconds, getRepeatModeLabel } from '@/lib/music/format';
import type { MusicRepeatMode, PlayerQueueItem } from '@/lib/music/types';

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
  repeatMode: MusicRepeatMode;
  shuffleEnabled: boolean;
  isFavorited: boolean;
  isFavoriteLoading: boolean;
  onTogglePlay: () => void;
  onPlayPrevious: () => void;
  onPlayNext: () => void;
  onSeek: (nextTimeSec: number) => void;
  onVolumeChange: (nextVolume: number) => void;
  onToggleMute: () => void;
  onToggleFavorite: () => void;
  onCycleRepeatMode: () => void;
  onToggleShuffle: () => void;
  onDismiss: () => void;
  onOpenQueue: () => void;
  onOpenLyrics: () => void;
}

function renderRepeatIcon(repeatMode: MusicRepeatMode) {
  return repeatMode === 'one' ? (
    <Repeat1 className='h-4 w-4' />
  ) : (
    <Repeat className='h-4 w-4' />
  );
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
  repeatMode,
  shuffleEnabled,
  isFavorited,
  isFavoriteLoading,
  onTogglePlay,
  onPlayPrevious,
  onPlayNext,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleFavorite,
  onCycleRepeatMode,
  onToggleShuffle,
  onDismiss,
  onOpenQueue,
  onOpenLyrics,
}: MusicMiniPlayerProps) {
  const progressSliderMax = durationSec > 0 ? durationSec : 1;
  const volumeValue = muted ? 0 : volume;
  const secondaryText = [track.artistsText, track.albumTitle]
    .filter(Boolean)
    .join(' · ');
  const tertiaryText = track.subtitle || secondaryText || '等待歌词滚动';

  return (
    <div
      className={cn(
        'fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] left-2 right-2 z-[700] md:bottom-3 md:right-4',
        sidebarCollapsed ? 'md:left-20' : 'md:left-72'
      )}
    >
      <div
        role='group'
        aria-label='播放器控制条'
        className='overflow-hidden rounded-[28px] border border-white/10 bg-[rgba(248,248,248,0.9)] text-slate-900 shadow-[0_18px_55px_rgba(15,23,42,0.18)] backdrop-blur-2xl dark:border-white/10 dark:bg-[rgba(18,18,20,0.88)] dark:text-white'
      >
        <div className='border-b border-slate-200/80 px-4 py-2 dark:border-white/10'>
          <input
            type='range'
            min={0}
            max={progressSliderMax}
            step={1}
            value={Math.min(currentTimeSec, progressSliderMax)}
            onChange={(event) => onSeek(Number(event.target.value))}
            className='h-1 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-emerald-500 dark:bg-white/15 dark:accent-white'
            aria-label='播放进度'
          />
        </div>

        <div className='grid gap-4 px-4 py-3 xl:grid-cols-[minmax(0,1.2fr)_auto_minmax(0,1fr)] xl:items-center'>
          <div className='flex min-w-0 items-center gap-3'>
            <button
              type='button'
              aria-label='打开歌词视图'
              onClick={onOpenLyrics}
              className='relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-slate-200/80 shadow-sm transition-transform hover:scale-[1.02] dark:bg-white/10'
            >
              {track.cover ? (
                <img
                  src={track.cover}
                  alt={track.title}
                  className='h-full w-full object-cover'
                />
              ) : (
                <div className='flex h-full w-full items-center justify-center'>
                  <Disc3 className='h-5 w-5 text-slate-500 dark:text-white/45' />
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
              onClick={onOpenLyrics}
              className='min-w-0 flex-1 text-left'
            >
              <div className='truncate text-sm font-semibold'>
                {track.title}
              </div>
              <div className='mt-0.5 truncate text-xs text-slate-500 dark:text-white/62'>
                {secondaryText || '未知歌手'}
              </div>
              <div className='mt-1 truncate text-xs text-emerald-600 dark:text-emerald-300/80'>
                {tertiaryText}
              </div>
            </button>

            <button
              type='button'
              onClick={onToggleFavorite}
              disabled={isFavoriteLoading}
              aria-label={isFavorited ? '取消收藏当前歌曲' : '收藏当前歌曲'}
              className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-200 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-60 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-rose-400'
            >
              {isFavoriteLoading ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <Heart
                  className={cn(
                    'h-4 w-4',
                    isFavorited
                      ? 'fill-rose-500 text-rose-500 dark:fill-rose-400 dark:text-rose-400'
                      : ''
                  )}
                />
              )}
            </button>
          </div>

          <div className='flex items-center justify-center gap-2 sm:gap-3'>
            <button
              type='button'
              onClick={onPlayPrevious}
              className='flex h-11 w-11 items-center justify-center rounded-full text-slate-700 transition-colors hover:bg-slate-200 dark:text-white/80 dark:hover:bg-white/10 dark:hover:text-white'
              aria-label='上一首'
            >
              <SkipBack className='h-5 w-5' />
            </button>
            <button
              type='button'
              onClick={onTogglePlay}
              className='flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg shadow-slate-900/20 transition-transform hover:scale-[1.02] dark:bg-white dark:text-slate-950 dark:shadow-white/10'
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
              className='flex h-11 w-11 items-center justify-center rounded-full text-slate-700 transition-colors hover:bg-slate-200 dark:text-white/80 dark:hover:bg-white/10 dark:hover:text-white'
              aria-label='下一首'
            >
              <SkipForward className='h-5 w-5' />
            </button>
          </div>

          <div className='flex flex-wrap items-center justify-end gap-2'>
            <div className='hidden items-center gap-2 lg:flex'>
              <button
                type='button'
                onClick={onToggleMute}
                className='flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-200 dark:text-white/72 dark:hover:bg-white/10 dark:hover:text-white'
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
                value={volumeValue}
                onChange={(event) => onVolumeChange(Number(event.target.value))}
                className='h-1 w-24 cursor-pointer appearance-none rounded-full bg-slate-200 accent-emerald-500 dark:bg-white/15 dark:accent-white'
                aria-label='音量'
              />
              <span className='w-8 text-right text-xs tabular-nums text-slate-500 dark:text-white/55'>
                {Math.round(volumeValue * 100)}
              </span>
            </div>

            <button
              type='button'
              onClick={onOpenQueue}
              className='flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-200 dark:text-white/72 dark:hover:bg-white/10 dark:hover:text-white'
              aria-label='打开播放队列'
            >
              <ListMusic className='h-4 w-4' />
            </button>
            <button
              type='button'
              onClick={onCycleRepeatMode}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
                repeatMode === 'off'
                  ? 'text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-white'
                  : 'bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/18 dark:bg-white/12 dark:text-white'
              )}
              aria-label='切换重复模式'
              title={getRepeatModeLabel(repeatMode)}
            >
              {renderRepeatIcon(repeatMode)}
            </button>
            <button
              type='button'
              onClick={onToggleShuffle}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
                shuffleEnabled
                  ? 'bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/18 dark:bg-white/12 dark:text-white'
                  : 'text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-white'
              )}
              aria-label='切换随机播放'
            >
              <Shuffle className='h-4 w-4' />
            </button>
            <button
              type='button'
              onClick={onOpenLyrics}
              className='flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-200 dark:text-white/72 dark:hover:bg-white/10 dark:hover:text-white'
              aria-label='打开歌词视图'
            >
              <ChevronUp className='h-4 w-4' />
            </button>
            <button
              type='button'
              onClick={onDismiss}
              className='flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-200 dark:text-white/72 dark:hover:bg-white/10 dark:hover:text-white'
              aria-label='关闭播放器'
            >
              <X className='h-4 w-4' />
            </button>
          </div>
        </div>

        <div className='flex items-center justify-between border-t border-slate-200/80 px-4 py-2 text-xs text-slate-500 dark:border-white/10 dark:text-white/55'>
          <span>{formatDurationSeconds(currentTimeSec)}</span>
          <span>{formatDurationSeconds(durationSec)}</span>
        </div>

        {trackError ? (
          <div className='border-t border-rose-200 bg-rose-50/80 px-4 py-2 text-xs text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200'>
            {trackError}
          </div>
        ) : null}
      </div>
    </div>
  );
}
