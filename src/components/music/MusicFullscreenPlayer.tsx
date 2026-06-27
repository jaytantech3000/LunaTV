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
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect } from 'react';

import { cn } from '@/lib/cn';
import { formatDurationSeconds, getRepeatModeLabel } from '@/lib/music/format';
import type {
  MusicLyricPayload,
  MusicRepeatMode,
  PlayerQueueItem,
} from '@/lib/music/types';

import MusicLyricsPanel from './MusicLyricsPanel';
import MusicQueuePanel from './MusicQueuePanel';

export type MusicFullscreenPanel = 'lyrics' | 'queue';

interface MusicFullscreenPlayerProps {
  open: boolean;
  track: PlayerQueueItem;
  queue: PlayerQueueItem[];
  currentIndex: number;
  repeatMode: MusicRepeatMode;
  shuffleEnabled: boolean;
  activePanel: MusicFullscreenPanel;
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
  onTogglePlay: () => void;
  onPlayPrevious: () => void;
  onPlayNext: () => void;
  onCycleRepeatMode: () => void;
  onToggleShuffle: () => void;
  onSeek: (nextTimeSec: number) => void;
  onVolumeChange: (nextVolume: number) => void;
  onToggleMute: () => void;
  onToggleFavorite: () => void;
  onSelectQueueIndex: (index: number) => void;
  onPanelChange: (panel: MusicFullscreenPanel) => void;
}

function renderRepeatIcon(repeatMode: MusicRepeatMode) {
  return repeatMode === 'one' ? (
    <Repeat1 className='h-4 w-4' />
  ) : (
    <Repeat className='h-4 w-4' />
  );
}

export default function MusicFullscreenPlayer({
  open,
  track,
  queue,
  currentIndex,
  repeatMode,
  shuffleEnabled,
  activePanel,
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
  onTogglePlay,
  onPlayPrevious,
  onPlayNext,
  onCycleRepeatMode,
  onToggleShuffle,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleFavorite,
  onSelectQueueIndex,
  onPanelChange,
}: MusicFullscreenPlayerProps) {
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
  const secondaryText = [track.artistsText, track.albumTitle]
    .filter(Boolean)
    .join(' · ');
  const volumeValue = muted ? 0 : volume;

  return (
    <div
      role='dialog'
      aria-modal='true'
      aria-label='展开播放器'
      className='pointer-events-auto absolute inset-0 overflow-y-auto rounded-[32px] border border-white/10 bg-[rgba(10,10,12,0.92)] text-white shadow-[0_32px_90px_rgba(2,6,23,0.45)]'
    >
      {track.cover ? (
        <div
          aria-hidden='true'
          className='absolute inset-0 opacity-35'
          style={{
            backgroundImage: `url(${track.cover})`,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
            filter: 'blur(60px)',
            transform: 'scale(1.08)',
          }}
        />
      ) : null}
      <div className='absolute inset-0 bg-[linear-gradient(120deg,rgba(8,8,10,0.86),rgba(17,24,39,0.9)_48%,rgba(5,46,22,0.78))]' />

      <div className='relative flex min-h-full flex-col gap-6 p-4 sm:p-6 xl:flex-row'>
        <section className='w-full rounded-[30px] border border-white/10 bg-black/20 p-5 backdrop-blur-xl xl:max-w-[420px]'>
          <div className='flex items-center justify-end gap-2'>
            <button
              type='button'
              onClick={onMinimize}
              className='flex h-10 w-10 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white'
              aria-label='收起到迷你播放器'
            >
              <ChevronDown className='h-4 w-4' />
            </button>
            <button
              type='button'
              onClick={onDismiss}
              className='flex h-10 w-10 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white'
              aria-label='关闭播放器'
            >
              <X className='h-4 w-4' />
            </button>
          </div>

          <div className='mt-4 overflow-hidden rounded-[28px] bg-white/8 shadow-[0_20px_60px_rgba(2,6,23,0.35)]'>
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

          <div className='mt-6 space-y-2'>
            <div className='text-xs uppercase tracking-[0.24em] text-white/40'>
              {track.source}
            </div>
            <h1 className='text-3xl font-semibold tracking-tight text-white'>
              {track.title}
            </h1>
            <p className='text-sm text-white/68'>
              {secondaryText || '未知歌手'}
            </p>
            {track.subtitle ? (
              <div className='text-sm text-emerald-300/82'>
                {track.subtitle}
              </div>
            ) : null}
          </div>

          <div className='mt-6 flex items-center gap-3'>
            <button
              type='button'
              onClick={onToggleMute}
              className='flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/75 transition-colors hover:bg-white/10 hover:text-white'
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
              className='h-1 w-full cursor-pointer appearance-none rounded-full bg-white/14 accent-white'
              aria-label='音量'
            />
            <span className='w-10 text-right text-sm tabular-nums text-white/58'>
              {Math.round(volumeValue * 100)}%
            </span>
            <button
              type='button'
              onClick={onToggleFavorite}
              disabled={isFavoriteLoading}
              className='flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/75 transition-colors hover:bg-white/10 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-60'
              aria-label={isFavorited ? '取消收藏当前歌曲' : '收藏当前歌曲'}
            >
              {isFavoriteLoading ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <Heart
                  className={cn(
                    'h-4 w-4',
                    isFavorited ? 'fill-rose-500 text-rose-500' : ''
                  )}
                />
              )}
            </button>
          </div>

          <div className='mt-6 space-y-2'>
            <input
              type='range'
              min={0}
              max={sliderMax}
              step={1}
              value={Math.min(currentTimeSec, sliderMax)}
              onChange={(event) => onSeek(Number(event.target.value))}
              className='h-1 w-full cursor-pointer appearance-none rounded-full bg-white/14 accent-white'
              aria-label='播放进度'
            />
            <div className='flex items-center justify-between text-sm text-white/55'>
              <span>{formatDurationSeconds(currentTimeSec)}</span>
              <span>{formatDurationSeconds(durationSec)}</span>
            </div>
          </div>

          <div className='mt-6 flex items-center justify-between gap-3'>
            <button
              type='button'
              onClick={onCycleRepeatMode}
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-full border transition-colors',
                repeatMode === 'off'
                  ? 'border-white/10 bg-white/6 text-white/55 hover:bg-white/10 hover:text-white'
                  : 'border-white/15 bg-white/12 text-white'
              )}
              aria-label='切换重复模式'
              title={getRepeatModeLabel(repeatMode)}
            >
              {renderRepeatIcon(repeatMode)}
            </button>

            <div className='flex items-center gap-3'>
              <button
                type='button'
                onClick={onPlayPrevious}
                className='flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/75 transition-colors hover:bg-white/10 hover:text-white'
                aria-label='上一首'
              >
                <SkipBack className='h-5 w-5' />
              </button>
              <button
                type='button'
                onClick={onTogglePlay}
                className='flex h-14 w-14 items-center justify-center rounded-full bg-white text-slate-950 shadow-[0_16px_40px_rgba(255,255,255,0.2)] transition-transform hover:scale-[1.02]'
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
                className='flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/75 transition-colors hover:bg-white/10 hover:text-white'
                aria-label='下一首'
              >
                <SkipForward className='h-5 w-5' />
              </button>
            </div>

            <button
              type='button'
              onClick={onToggleShuffle}
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-full border transition-colors',
                shuffleEnabled
                  ? 'border-white/15 bg-white/12 text-white'
                  : 'border-white/10 bg-white/6 text-white/55 hover:bg-white/10 hover:text-white'
              )}
              aria-label='切换随机播放'
            >
              <Shuffle className='h-4 w-4' />
            </button>
          </div>

          {trackError ? (
            <div className='mt-6 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100'>
              {trackError}
            </div>
          ) : null}
        </section>

        <section className='flex-1 rounded-[30px] border border-white/10 bg-black/20 p-5 backdrop-blur-xl'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div>
              <div className='text-lg font-semibold text-white'>播放视图</div>
              <div className='mt-1 text-sm text-white/55'>
                当前第 {currentIndex + 1} 首，共 {queue.length} 首
              </div>
            </div>
            <div className='inline-flex rounded-full border border-white/10 bg-white/6 p-1'>
              <button
                type='button'
                onClick={() => onPanelChange('lyrics')}
                className={cn(
                  'rounded-full px-4 py-2 text-sm transition-colors',
                  activePanel === 'lyrics'
                    ? 'bg-white text-slate-950'
                    : 'text-white/65 hover:text-white'
                )}
                aria-label='切换到歌词视图'
              >
                歌词
              </button>
              <button
                type='button'
                onClick={() => onPanelChange('queue')}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors',
                  activePanel === 'queue'
                    ? 'bg-white text-slate-950'
                    : 'text-white/65 hover:text-white'
                )}
                aria-label='切换到队列视图'
              >
                <ListMusic className='h-4 w-4' />
                队列
              </button>
            </div>
          </div>

          <div className='mt-6'>
            {activePanel === 'lyrics' ? (
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
        </section>
      </div>
    </div>
  );
}
