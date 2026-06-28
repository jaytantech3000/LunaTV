'use client';

import { useLyricsStore } from '../state/lyrics-store';

export function MusicLyricsPanel() {
  const lyrics = useLyricsStore((state) => state.lyrics);
  const activeLineIndex = useLyricsStore((state) => state.activeLineIndex);

  return (
    <section
      data-testid='music-lyrics-panel'
      className='rounded-[28px] border border-white/10 bg-white/5 p-5'
    >
      {(lyrics?.lines ?? []).map((line, index) => (
        <div
          key={`${line.timeMs}-${index}`}
          className={index === activeLineIndex ? 'text-white' : 'text-white/55'}
        >
          {line.text}
        </div>
      ))}
    </section>
  );
}
