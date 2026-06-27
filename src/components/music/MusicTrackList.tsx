/* eslint-disable @next/next/no-img-element */

'use client';

import { ListPlus, Play, Waves } from 'lucide-react';

import { cn } from '@/lib/cn';
import { formatDurationMs } from '@/lib/music/format';
import type { MusicTrack } from '@/lib/music/types';

interface MusicTrackListProps {
  title: string;
  description?: string;
  tracks: MusicTrack[];
  activeTrackKey?: string | null;
  onPlayTrack: (tracks: MusicTrack[], startIndex: number) => void;
  onQueueTrack: (track: MusicTrack) => void;
}

export default function MusicTrackList({
  title,
  description,
  tracks,
  activeTrackKey,
  onPlayTrack,
  onQueueTrack,
}: MusicTrackListProps) {
  return (
    <section className='space-y-4'>
      <div className='flex items-end justify-between gap-3'>
        <div className='space-y-1'>
          <h2 className='text-xl font-semibold text-slate-950 dark:text-white'>
            {title}
          </h2>
          {description ? (
            <p className='text-sm text-slate-500 dark:text-slate-400'>
              {description}
            </p>
          ) : null}
        </div>
        <div className='text-xs uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500'>
          共 {tracks.length} 首
        </div>
      </div>

      <div className='overflow-hidden rounded-[28px] border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-950/80'>
        <div className='hidden grid-cols-[56px_minmax(0,1.8fr)_minmax(0,1fr)_100px_112px] items-center gap-3 border-b border-slate-200 px-4 py-3 text-xs font-medium uppercase tracking-[0.22em] text-slate-400 dark:border-slate-800 dark:text-slate-500 md:grid'>
          <div>播放</div>
          <div>曲目</div>
          <div>专辑</div>
          <div className='text-right'>时长</div>
          <div className='text-right'>队列</div>
        </div>
        <div className='divide-y divide-slate-200/80 dark:divide-slate-800'>
          {tracks.map((track, index) => {
            const trackKey = `${track.source}:${track.id}`;
            const active = trackKey === activeTrackKey;
            const artistLabel = track.artists
              .map((artist) => artist.name)
              .join(' / ');

            return (
              <div
                key={trackKey}
                className={cn(
                  'grid gap-3 px-4 py-4 transition-colors md:grid-cols-[56px_minmax(0,1.8fr)_minmax(0,1fr)_100px_112px] md:items-center',
                  active
                    ? 'bg-emerald-50/80 dark:bg-emerald-500/10'
                    : 'bg-transparent hover:bg-slate-50/80 dark:hover:bg-slate-900/70'
                )}
              >
                <div className='flex items-center gap-3 md:gap-0'>
                  <button
                    type='button'
                    aria-label={
                      track.playable
                        ? `播放 ${track.title}`
                        : `${track.title} 暂不可播`
                    }
                    disabled={!track.playable}
                    onClick={() => onPlayTrack(tracks, index)}
                    className={cn(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-colors dark:text-slate-950',
                      track.playable
                        ? 'bg-slate-950 hover:bg-emerald-600 dark:bg-white dark:hover:bg-emerald-300'
                        : 'cursor-not-allowed bg-slate-300 dark:bg-slate-700'
                    )}
                  >
                    <Play className='h-4 w-4 fill-current' />
                  </button>
                </div>

                <div className='min-w-0 md:flex md:items-center md:gap-4'>
                  <div className='relative hidden h-14 w-14 overflow-hidden rounded-2xl bg-slate-200 md:block dark:bg-slate-800'>
                    {track.cover ? (
                      <img
                        src={track.cover}
                        alt={track.title}
                        className='h-full w-full object-cover'
                      />
                    ) : null}
                    {active ? (
                      <div className='absolute inset-0 flex items-center justify-center bg-slate-950/55 text-white'>
                        <Waves className='h-5 w-5' />
                      </div>
                    ) : null}
                  </div>

                  <div className='min-w-0'>
                    <div className='flex items-center gap-2'>
                      <span className='truncate text-base font-semibold text-slate-950 dark:text-white'>
                        {track.title}
                      </span>
                      {active ? (
                        <span className='rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300'>
                          正在播放
                        </span>
                      ) : null}
                      {!track.playable ? (
                        <span className='rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300'>
                          暂不可播
                        </span>
                      ) : null}
                    </div>
                    <div className='mt-1 truncate text-sm text-slate-500 dark:text-slate-400'>
                      {artistLabel}
                    </div>
                    {track.subtitle ? (
                      <div className='mt-1 truncate text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500'>
                        {track.subtitle}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className='min-w-0'>
                  <div className='truncate text-sm text-slate-600 dark:text-slate-300'>
                    {track.album?.title || '单曲'}
                  </div>
                  {track.album?.title && track.subtitle ? (
                    <div className='mt-1 truncate text-xs text-slate-400 dark:text-slate-500'>
                      {track.subtitle}
                    </div>
                  ) : null}
                </div>

                <div className='flex items-center justify-between gap-3 md:justify-end'>
                  <span className='text-sm tabular-nums text-slate-400 dark:text-slate-500'>
                    {formatDurationMs(track.durationMs)}
                  </span>
                </div>

                <div className='flex items-center justify-between gap-3 md:justify-end'>
                  <button
                    type='button'
                    disabled={!track.playable}
                    onClick={() => onQueueTrack(track)}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition-colors',
                      track.playable
                        ? 'border-slate-200 text-slate-600 hover:border-emerald-400 hover:text-emerald-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-300'
                        : 'cursor-not-allowed border-slate-200/70 text-slate-400 dark:border-slate-700 dark:text-slate-500'
                    )}
                  >
                    <ListPlus className='h-3.5 w-3.5' />
                    下一首
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
