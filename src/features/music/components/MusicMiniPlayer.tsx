'use client';

import {
  selectCurrentQueueItem,
  usePlaybackStore,
} from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

export function MusicMiniPlayer() {
  const currentTrack = usePlaybackStore(selectCurrentQueueItem);
  const miniVisible = usePlayerSurfaceStore((state) => state.miniVisible);
  const openFullPlayer = usePlayerSurfaceStore((state) => state.openFullPlayer);

  if (!miniVisible || !currentTrack) {
    return null;
  }

  return (
    <div
      data-testid='music-mini-player'
      className='fixed bottom-6 left-1/2 z-40 w-[min(960px,calc(100vw-32px))] -translate-x-1/2 rounded-full bg-black/92 px-6 py-4 text-white shadow-2xl'
    >
      <div className='flex items-center justify-between gap-4'>
        <div>
          <div className='text-sm font-semibold'>
            {currentTrack.track.title}
          </div>
          <div className='text-xs text-white/65'>
            {currentTrack.track.artists.join(' / ')}
          </div>
        </div>
        <button
          type='button'
          aria-label='Open full player'
          onClick={openFullPlayer}
          className='rounded-full border border-white/15 px-4 py-2 text-xs'
        >
          Expand
        </button>
      </div>
    </div>
  );
}
