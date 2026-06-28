'use client';

import { useEffect, useRef } from 'react';

import { useLyricsStore } from '../state/lyrics-store';
import { usePlaybackStore } from '../state/playback-store';

export function MusicLyricsPanel() {
  const requestSeek = usePlaybackStore((state) => state.requestSeek);
  const lyrics = useLyricsStore((state) => state.lyrics);
  const activeLineIndex = useLyricsStore((state) => state.activeLineIndex);
  const followMode = useLyricsStore((state) => state.followMode);
  const toggleFollowMode = useLyricsStore((state) => state.toggleFollowMode);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (followMode !== 'auto' || activeLineIndex < 0) {
      return;
    }

    const activeLineNode = lineRefs.current[activeLineIndex];

    if (activeLineNode && typeof activeLineNode.scrollIntoView === 'function') {
      activeLineNode.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    }
  }, [activeLineIndex, followMode]);

  if (!lyrics || lyrics.lines.length === 0) {
    return (
      <section
        data-testid='music-lyrics-panel'
        className='rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.2)]'
      >
        <div className='flex items-center justify-between gap-3'>
          <div className='text-xs uppercase tracking-[0.24em] text-white/45'>
            Lyrics
          </div>
          <button
            type='button'
            aria-label={
              followMode === 'auto'
                ? 'Set lyrics follow mode to manual'
                : 'Set lyrics follow mode to auto'
            }
            onClick={toggleFollowMode}
            className='rounded-full border border-white/12 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-white/72'
          >
            {followMode === 'auto' ? 'Auto' : 'Manual'}
          </button>
        </div>
        <div className='mt-4 rounded-[24px] border border-white/10 bg-black/20 px-4 py-5 text-sm text-white/45'>
          暂无歌词
        </div>
      </section>
    );
  }

  return (
    <section
      data-testid='music-lyrics-panel'
      className='rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.2)]'
    >
      <div className='flex items-center justify-between gap-3'>
        <div>
          <div className='text-xs uppercase tracking-[0.24em] text-white/45'>
            Lyrics
          </div>
          <div className='mt-1 text-[11px] uppercase tracking-[0.2em] text-white/28'>
            {followMode === 'auto' ? 'Auto follow' : 'Manual follow'}
          </div>
        </div>
        <button
          type='button'
          aria-label={
            followMode === 'auto'
              ? 'Set lyrics follow mode to manual'
              : 'Set lyrics follow mode to auto'
          }
          onClick={toggleFollowMode}
          className='rounded-full border border-white/12 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-white/72 transition hover:border-white/24 hover:text-white'
        >
          {followMode === 'auto' ? 'Auto' : 'Manual'}
        </button>
      </div>
      <div className='mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-2'>
        {lyrics.lines.map((line, index) => (
          <button
            key={`${line.timeMs}-${index}`}
            ref={(node) => {
              lineRefs.current[index] = node;
            }}
            type='button'
            aria-label={`Seek to lyric ${line.text}`}
            onClick={() => requestSeek(line.timeMs)}
            className={`block w-full rounded-[22px] px-3 py-3 text-left transition ${
              index === activeLineIndex
                ? 'border border-white/14 bg-white/10 text-white'
                : 'border border-transparent text-white/55 hover:bg-white/6 hover:text-white/82'
            }`}
          >
            {line.text}
          </button>
        ))}
      </div>
    </section>
  );
}
