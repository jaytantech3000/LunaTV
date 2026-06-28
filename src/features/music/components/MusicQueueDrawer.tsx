'use client';

import { formatMusicClock } from '../services/music-formatters';
import { usePlaybackStore } from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

export function MusicQueueDrawer() {
  const queuePanelOpen = usePlayerSurfaceStore((state) => state.queuePanelOpen);
  const currentTrackId = usePlaybackStore((state) => state.currentTrackId);
  const queue = usePlaybackStore((state) => state.queue);
  const selectTrack = usePlaybackStore((state) => state.selectTrack);

  if (!queuePanelOpen) {
    return null;
  }

  return (
    <aside
      data-testid='music-queue-drawer'
      className='space-y-4 rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.2)]'
    >
      <div className='flex items-center justify-between'>
        <div className='text-xs uppercase tracking-[0.24em] text-white/45'>
          Queue
        </div>
        <div className='rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-white/42'>
          {`${queue.length} tracks`}
        </div>
      </div>
      {queue.length === 0 ? (
        <div className='rounded-[24px] border border-white/10 bg-black/20 px-4 py-5 text-sm text-white/45'>
          Queue is empty. Start playback from discovery, search, or collection.
        </div>
      ) : null}
      {queue.map((item, index) => {
        const isCurrent = item.track.id === currentTrackId;

        return (
          <button
            key={item.queueId}
            type='button'
            aria-current={isCurrent ? 'true' : undefined}
            aria-label={`Play queued track ${item.track.title}`}
            onClick={() => selectTrack(item.track.id)}
            className={`block w-full rounded-[24px] border px-4 py-3 text-left transition ${
              isCurrent
                ? 'border-white/30 bg-white/12'
                : 'border-white/10 bg-black/15 hover:border-white/20 hover:bg-white/8'
            }`}
          >
            <div className='flex items-center justify-between gap-4'>
              <div className='flex min-w-0 items-center gap-4'>
                <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.06] text-sm font-medium text-white/68'>
                  {String(index + 1).padStart(2, '0')}
                </div>
                <div
                  className='h-12 w-12 shrink-0 rounded-[18px] border border-white/10 bg-slate-900'
                  style={{
                    background: item.track.coverUrl
                      ? `linear-gradient(180deg,rgba(15,23,42,0.12),rgba(15,23,42,0.86)), url(${item.track.coverUrl}) center / cover`
                      : 'linear-gradient(135deg,#111827,#1e293b)',
                  }}
                />
                <div className='min-w-0'>
                  <div className='text-[11px] uppercase tracking-[0.22em] text-white/38'>
                    {item.track.source}
                  </div>
                  <div className='mt-1 truncate font-medium text-white'>
                    {item.track.title}
                  </div>
                  <div className='mt-1 truncate text-sm text-white/55'>
                    {item.track.artists.join(' / ')}
                  </div>
                </div>
              </div>
              <div className='shrink-0 text-right text-xs text-white/45'>
                <div>{formatMusicClock(item.track.durationMs)}</div>
                <div className='mt-1 uppercase tracking-[0.22em] text-white/32'>
                  {isCurrent ? 'Playing' : 'Queue'}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </aside>
  );
}
