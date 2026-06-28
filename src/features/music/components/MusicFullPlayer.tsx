'use client';

import { MusicLyricsPanel } from './MusicLyricsPanel';
import { MusicQueueDrawer } from './MusicQueueDrawer';
import { usePlaybackStore } from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

export function MusicFullPlayer() {
  const fullPlayerOpen = usePlayerSurfaceStore((state) => state.fullPlayerOpen);
  const closeFullPlayer = usePlayerSurfaceStore(
    (state) => state.closeFullPlayer
  );
  const toggleQueuePanel = usePlayerSurfaceStore(
    (state) => state.toggleQueuePanel
  );
  const queue = usePlaybackStore((state) => state.queue);

  if (!fullPlayerOpen) {
    return null;
  }

  return (
    <div
      data-testid='music-full-player'
      className='fixed inset-0 z-50 bg-slate-950/96 p-8 text-white'
    >
      <div className='mx-auto flex h-full max-w-6xl flex-col gap-6 rounded-[36px] border border-white/10 bg-black/60 p-8'>
        <div className='flex items-center justify-between'>
          <h2 className='text-2xl font-semibold'>Now Playing</h2>
          <div className='flex gap-3'>
            <button
              type='button'
              aria-label='Open queue panel'
              onClick={toggleQueuePanel}
            >
              Queue
            </button>
            <button
              type='button'
              aria-label='Close full player'
              onClick={closeFullPlayer}
            >
              Close
            </button>
          </div>
        </div>
        <div className='grid flex-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_360px]'>
          <div className='text-sm text-white/70'>{queue[0]?.track.title}</div>
          <div className='space-y-4'>
            <MusicLyricsPanel />
            <MusicQueueDrawer />
          </div>
        </div>
      </div>
    </div>
  );
}
