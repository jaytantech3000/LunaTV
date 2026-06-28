'use client';

import { usePlaybackStore } from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

export function MusicQueueDrawer() {
  const queuePanelOpen = usePlayerSurfaceStore((state) => state.queuePanelOpen);
  const queue = usePlaybackStore((state) => state.queue);

  if (!queuePanelOpen) {
    return null;
  }

  return (
    <aside
      data-testid='music-queue-drawer'
      className='rounded-[28px] border border-white/10 bg-white/5 p-5'
    >
      {queue.map((item) => (
        <div key={item.queueId} className='py-2 text-sm'>
          {item.track.title}
        </div>
      ))}
    </aside>
  );
}
