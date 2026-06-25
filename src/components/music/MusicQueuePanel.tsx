/* eslint-disable @next/next/no-img-element */

'use client';

import { Disc3 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { formatDurationMs } from '@/lib/music/format';
import type { PlayerQueueItem } from '@/lib/music/types';

interface MusicQueuePanelProps {
  queue: PlayerQueueItem[];
  currentTrackKey: string;
  onSelectTrack: (index: number) => void;
}

export default function MusicQueuePanel({
  queue,
  currentTrackKey,
  onSelectTrack,
}: MusicQueuePanelProps) {
  if (queue.length === 0) {
    return (
      <div className='flex h-[360px] flex-col items-center justify-center rounded-[28px] border border-white/10 bg-white/5 px-6 text-center'>
        <Disc3 className='h-12 w-12 text-white/25' />
        <div className='mt-4 text-lg font-semibold text-white'>
          暂无播放队列
        </div>
        <p className='mt-2 max-w-sm text-sm leading-6 text-white/60'>
          在音乐页点击播放或“下一首”后，这里会显示当前排队的曲目。
        </p>
      </div>
    );
  }

  return (
    <div className='h-[360px] space-y-2 overflow-y-auto pr-1'>
      {queue.map((track, index) => {
        const trackKey = `${track.source}:${track.trackId}`;
        const active = trackKey === currentTrackKey;

        return (
          <button
            key={trackKey}
            type='button'
            onClick={() => onSelectTrack(index)}
            className={cn(
              'flex w-full items-center gap-3 rounded-[24px] border px-3 py-3 text-left transition-colors',
              active
                ? 'border-emerald-400/60 bg-emerald-400/15 text-white'
                : 'border-white/10 bg-white/5 text-white/80 hover:border-white/20 hover:bg-white/10'
            )}
          >
            {track.cover ? (
              <div className='relative h-14 w-14 overflow-hidden rounded-2xl'>
                <img
                  src={track.cover}
                  alt={track.title}
                  className='h-full w-full object-cover'
                />
              </div>
            ) : (
              <div className='flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10'>
                <Disc3 className='h-5 w-5 text-white/50' />
              </div>
            )}

            <div className='min-w-0 flex-1'>
              <div className='truncate text-sm font-semibold'>
                {track.title}
              </div>
              <div className='mt-1 truncate text-xs text-white/55'>
                {track.artistsText}
                {track.albumTitle ? ` · ${track.albumTitle}` : ''}
              </div>
              {track.subtitle ? (
                <div className='mt-1 truncate text-[11px] uppercase tracking-[0.16em] text-white/35'>
                  {track.subtitle}
                </div>
              ) : null}
            </div>

            <div className='text-xs text-white/45'>
              {formatDurationMs(track.durationMs)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
