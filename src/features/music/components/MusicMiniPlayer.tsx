'use client';

import { MusicPlaybackTimeline } from './MusicPlaybackTimeline';
import { MusicTransportControls } from './MusicTransportControls';
import {
  selectCurrentQueueItem,
  usePlaybackStore,
} from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

export function MusicMiniPlayer() {
  const currentTrack = usePlaybackStore(selectCurrentQueueItem);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const muted = usePlaybackStore((state) => state.muted);
  const toggleMuted = usePlaybackStore((state) => state.toggleMuted);
  const miniVisible = usePlayerSurfaceStore((state) => state.miniVisible);
  const openFullPlayer = usePlayerSurfaceStore((state) => state.openFullPlayer);

  if (!miniVisible || !currentTrack) {
    return null;
  }

  return (
    <div
      data-testid='music-mini-player'
      className='fixed bottom-6 left-1/2 z-40 w-[min(1080px,calc(100vw-28px))] -translate-x-1/2 overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_28%),linear-gradient(135deg,rgba(4,7,14,0.96),rgba(9,14,26,0.98))] px-4 py-4 text-white shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur'
    >
      <div className='grid items-center gap-4 lg:grid-cols-[72px_minmax(0,1fr)_auto]'>
        <div
          aria-label='Mini player cover art'
          className='hidden aspect-square rounded-[22px] border border-white/10 bg-slate-900 shadow-[0_18px_40px_rgba(0,0,0,0.32)] lg:block'
          style={{
            background: currentTrack.track.coverUrl
              ? `linear-gradient(180deg,rgba(15,23,42,0.08),rgba(15,23,42,0.82)), url(${currentTrack.track.coverUrl}) center / cover`
              : 'linear-gradient(135deg,#0f172a,#1e293b)',
          }}
        />
        <div className='min-w-0 space-y-3'>
          <div className='flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-white/42'>
            <span className='rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5'>
              {currentTrack.track.source}
            </span>
            <span className='rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5'>
              {`${queueLength} in queue`}
            </span>
          </div>
          <div className='flex flex-wrap items-end justify-between gap-3'>
            <div className='min-w-0'>
              <div className='truncate text-base font-semibold tracking-[-0.03em] text-white'>
                {currentTrack.track.title}
              </div>
              <div className='mt-1 truncate text-sm text-white/62'>
                {`${currentTrack.track.artists.join(' / ')} · ${
                  currentTrack.track.album
                }`}
              </div>
            </div>
          </div>
          <MusicPlaybackTimeline compact />
        </div>
        <div className='flex flex-wrap items-center justify-end gap-3'>
          <MusicTransportControls compact />
          <button
            type='button'
            aria-label={muted ? 'Unmute mini player' : 'Mute mini player'}
            onClick={toggleMuted}
            className='rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.22em] text-white/82 transition hover:border-white/28 hover:bg-white hover:text-black'
          >
            {muted ? 'Muted' : 'Sound'}
          </button>
          <button
            type='button'
            aria-label='Open full player'
            onClick={openFullPlayer}
            className='rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.22em] text-white/82 transition hover:border-white/28 hover:bg-white hover:text-black'
          >
            Expand
          </button>
        </div>
      </div>
    </div>
  );
}
