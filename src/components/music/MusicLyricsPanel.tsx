'use client';

import { FileText } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import { cn } from '@/lib/cn';
import type { MusicLyricPayload } from '@/lib/music/types';

interface MusicLyricsPanelProps {
  lyrics: MusicLyricPayload | null;
  currentTimeSec: number;
}

function resolveActiveLyricIndex(
  lyrics: MusicLyricPayload | null,
  currentTimeSec: number
) {
  if (!lyrics?.lines.length) {
    return -1;
  }

  const currentMs = currentTimeSec * 1000 + (lyrics.offsetMs || 0);

  for (let index = lyrics.lines.length - 1; index >= 0; index -= 1) {
    if (currentMs >= lyrics.lines[index].timeMs) {
      return index;
    }
  }

  return 0;
}

export default function MusicLyricsPanel({
  lyrics,
  currentTimeSec,
}: MusicLyricsPanelProps) {
  const activeIndex = useMemo(
    () => resolveActiveLyricIndex(lyrics, currentTimeSec),
    [currentTimeSec, lyrics]
  );
  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (activeIndex < 0) {
      return;
    }

    const currentLine = lineRefs.current[activeIndex];
    if (typeof currentLine?.scrollIntoView !== 'function') {
      return;
    }

    currentLine?.scrollIntoView({
      block: 'center',
      behavior: activeIndex <= 1 ? 'auto' : 'smooth',
    });
  }, [activeIndex]);

  if (!lyrics?.lines.length) {
    return (
      <div className='flex h-[420px] flex-col items-center justify-center rounded-[30px] border border-white/10 bg-black/10 px-6 text-center backdrop-blur-sm'>
        <FileText className='h-12 w-12 text-white/25' />
        <div className='mt-4 text-lg font-semibold text-white'>暂无歌词</div>
        <p className='mt-2 max-w-sm text-sm leading-6 text-white/60'>
          当前来源还没有可用歌词，播放器仍然可以正常试听。
        </p>
      </div>
    );
  }

  return (
    <div className='h-[420px] overflow-y-auto pr-1'>
      <div className='space-y-6 py-10'>
        {lyrics.lines.map((line, index) => {
          const active = index === activeIndex;

          return (
            <div
              key={`${lyrics.trackId}-${line.timeMs}-${index}`}
              ref={(node) => {
                lineRefs.current[index] = node;
              }}
              className={cn(
                'text-center transition-all duration-300',
                active ? 'scale-[1.01]' : 'opacity-50'
              )}
            >
              <div
                className={cn(
                  'text-base leading-8 sm:text-lg',
                  active ? 'font-semibold text-white' : 'text-white/58'
                )}
              >
                {line.text}
              </div>
              {line.translation ? (
                <div
                  className={cn(
                    'mt-1 text-sm',
                    active ? 'text-white/70' : 'text-white/35'
                  )}
                >
                  {line.translation}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
