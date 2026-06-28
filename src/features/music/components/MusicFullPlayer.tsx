'use client';

import { MusicLyricsPanel } from './MusicLyricsPanel';
import { MusicPlaybackTimeline } from './MusicPlaybackTimeline';
import { MusicQueueDrawer } from './MusicQueueDrawer';
import { MusicTransportControls } from './MusicTransportControls';
import { buildMusicProfileKey } from '../services/music-profile';
import { useMusicLibraryStore } from '../state/music-library-store';
import {
  selectCurrentQueueItem,
  usePlaybackStore,
} from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

export function MusicFullPlayer() {
  const fullPlayerOpen = usePlayerSurfaceStore((state) => state.fullPlayerOpen);
  const closeFullPlayer = usePlayerSurfaceStore(
    (state) => state.closeFullPlayer
  );
  const lyricsPanelOpen = usePlayerSurfaceStore(
    (state) => state.lyricsPanelOpen
  );
  const toggleLyricsPanel = usePlayerSurfaceStore(
    (state) => state.toggleLyricsPanel
  );
  const toggleQueuePanel = usePlayerSurfaceStore(
    (state) => state.toggleQueuePanel
  );
  const queuePanelOpen = usePlayerSurfaceStore((state) => state.queuePanelOpen);
  const currentTrack = usePlaybackStore(selectCurrentQueueItem);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const playMode = usePlaybackStore((state) => state.playMode);
  const volume = usePlaybackStore((state) => state.volume);
  const muted = usePlaybackStore((state) => state.muted);
  const favoriteTrackKeys = useMusicLibraryStore(
    (state) => state.favoriteTrackKeys
  );
  const toggleFavoriteTrack = useMusicLibraryStore(
    (state) => state.toggleFavoriteTrack
  );
  const togglePlayMode = usePlaybackStore((state) => state.togglePlayMode);
  const setVolume = usePlaybackStore((state) => state.setVolume);
  const setMuted = usePlaybackStore((state) => state.setMuted);
  const toggleMuted = usePlaybackStore((state) => state.toggleMuted);
  const volumePercent = Math.round(volume * 100);
  const canAdjustPlayback = Boolean(currentTrack);
  const currentTrackKey = currentTrack
    ? buildMusicProfileKey(currentTrack.track.source, currentTrack.track.id)
    : null;
  const trackFavorited = currentTrackKey
    ? favoriteTrackKeys.includes(currentTrackKey)
    : false;

  if (!fullPlayerOpen) {
    return null;
  }

  return (
    <div
      data-testid='music-full-player'
      className='fixed inset-0 z-50 overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.18),transparent_24%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_22%),rgba(2,6,23,0.96)] p-4 text-white backdrop-blur lg:p-8'
    >
      <div className='mx-auto flex min-h-[calc(100vh-32px)] max-w-7xl flex-col gap-6 rounded-[40px] border border-white/10 bg-[linear-gradient(180deg,rgba(6,10,18,0.96),rgba(3,6,14,0.98))] p-5 shadow-[0_40px_140px_rgba(0,0,0,0.45)] lg:min-h-[calc(100vh-64px)] lg:p-8'>
        <div className='flex flex-wrap items-center justify-between gap-4'>
          <div>
            <div className='text-[11px] uppercase tracking-[0.28em] text-white/35'>
              Playback stage
            </div>
            <h2 className='mt-2 text-2xl font-semibold tracking-[-0.03em] text-white lg:text-3xl'>
              Now Playing
            </h2>
          </div>
          <div className='flex flex-wrap gap-3'>
            <button
              type='button'
              aria-label={
                trackFavorited
                  ? 'Remove track from library'
                  : 'Save track to library'
              }
              onClick={() => {
                if (!currentTrack) {
                  return;
                }

                void toggleFavoriteTrack(currentTrack.track);
              }}
              disabled={!currentTrack}
              className='rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-white/78 transition hover:border-white/26 hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:border-white/8 disabled:text-white/24'
            >
              {trackFavorited ? 'Saved' : 'Save'}
            </button>
            <button
              type='button'
              aria-label={
                lyricsPanelOpen ? 'Hide lyrics panel' : 'Show lyrics panel'
              }
              onClick={toggleLyricsPanel}
              className='rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-white/78 transition hover:border-white/26 hover:bg-white hover:text-black'
            >
              Lyrics
            </button>
            <button
              type='button'
              aria-label='Open queue panel'
              onClick={toggleQueuePanel}
              className='rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-white/78 transition hover:border-white/26 hover:bg-white hover:text-black'
            >
              Queue
            </button>
            <button
              type='button'
              aria-label='Close full player'
              onClick={closeFullPlayer}
              className='rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-white/78 transition hover:border-white/26 hover:bg-white hover:text-black'
            >
              Close
            </button>
          </div>
        </div>
        <div className='grid flex-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_420px]'>
          <div className='grid gap-6 rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 lg:grid-cols-[300px_minmax(0,1fr)] lg:p-6'>
            <div className='space-y-4'>
              <div
                aria-label='Full player cover art'
                className='aspect-square rounded-[30px] border border-white/10 bg-slate-900 shadow-[0_26px_80px_rgba(0,0,0,0.4)]'
                style={{
                  background: currentTrack?.track.coverUrl
                    ? `linear-gradient(180deg,rgba(15,23,42,0.08),rgba(15,23,42,0.86)), url(${currentTrack.track.coverUrl}) center / cover`
                    : 'linear-gradient(135deg,#0f172a,#1e293b)',
                }}
              />
              <div className='grid gap-3 sm:grid-cols-2'>
                <div className='rounded-[24px] border border-white/10 bg-black/20 px-4 py-4'>
                  <div className='text-[11px] uppercase tracking-[0.24em] text-white/38'>
                    Source
                  </div>
                  <div className='mt-2 text-sm font-medium text-white'>
                    {currentTrack?.track.source || 'offline'}
                  </div>
                </div>
                <div className='rounded-[24px] border border-white/10 bg-black/20 px-4 py-4'>
                  <div className='text-[11px] uppercase tracking-[0.24em] text-white/38'>
                    Queue
                  </div>
                  <div className='mt-2 text-sm font-medium text-white'>
                    {`${queueLength} tracks`}
                  </div>
                </div>
              </div>
            </div>
            <div className='flex min-h-0 flex-col justify-between gap-6'>
              <div className='space-y-4'>
                <div className='text-[11px] uppercase tracking-[0.28em] text-white/35'>
                  Listening now
                </div>
                <div className='text-3xl font-semibold tracking-[-0.04em] text-white lg:text-5xl'>
                  {currentTrack?.track.title || 'Nothing queued'}
                </div>
                <div className='text-base text-white/68'>
                  {currentTrack?.track.artists.join(' / ') ||
                    '等待从新首页发起点播'}
                </div>
                <div className='text-sm text-white/42'>
                  {currentTrack?.track.album || '网易云音乐'}
                </div>
                <div className='flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-white/38'>
                  <span className='rounded-full border border-white/10 bg-white/[0.05] px-3 py-2'>
                    {currentTrack ? 'stream ready' : 'No active stream'}
                  </span>
                  <span className='rounded-full border border-white/10 bg-white/[0.05] px-3 py-2'>
                    {currentTrack ? 'queue synced' : 'No active stream'}
                  </span>
                </div>
              </div>
              <div className='space-y-5 rounded-[28px] border border-white/10 bg-black/20 p-5'>
                <MusicPlaybackTimeline />
                <div className='grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center'>
                  <button
                    type='button'
                    aria-label={
                      playMode === 'list-loop'
                        ? 'Switch to single-loop mode'
                        : 'Switch to list-loop mode'
                    }
                    onClick={togglePlayMode}
                    disabled={!canAdjustPlayback}
                    className='rounded-full border border-white/12 bg-white/[0.04] px-4 py-3 text-[11px] uppercase tracking-[0.22em] text-white/78 transition hover:border-white/26 hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:border-white/8 disabled:text-white/24'
                  >
                    {playMode === 'list-loop' ? 'Loop all' : 'Loop one'}
                  </button>
                  <label className='flex items-center gap-4 rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-[11px] uppercase tracking-[0.22em] text-white/58'>
                    <span>Volume</span>
                    <input
                      type='range'
                      min={0}
                      max={100}
                      step={1}
                      value={volumePercent}
                      aria-label='Set playback volume'
                      disabled={!canAdjustPlayback}
                      onChange={(event) => {
                        const nextVolume =
                          Number(event.currentTarget.value) / 100;

                        setVolume(nextVolume);

                        if (nextVolume === 0) {
                          setMuted(true);
                          return;
                        }

                        if (muted) {
                          setMuted(false);
                        }
                      }}
                      className='h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/14 accent-white disabled:cursor-not-allowed disabled:opacity-40'
                    />
                    <span className='min-w-[3ch] text-right tabular-nums text-white/72'>
                      {`${volumePercent}%`}
                    </span>
                  </label>
                  <button
                    type='button'
                    aria-label={muted ? 'Unmute playback' : 'Mute playback'}
                    onClick={toggleMuted}
                    disabled={!canAdjustPlayback}
                    className='rounded-full border border-white/12 bg-white/[0.04] px-4 py-3 text-[11px] uppercase tracking-[0.22em] text-white/78 transition hover:border-white/26 hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:border-white/8 disabled:text-white/24'
                  >
                    {muted ? 'Muted' : 'Sound on'}
                  </button>
                </div>
                <div className='flex flex-wrap items-center justify-between gap-4'>
                  <MusicTransportControls />
                  <div className='rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-white/42'>
                    {currentTrack
                      ? playMode === 'single-loop'
                        ? 'single loop'
                        : 'list loop'
                      : 'idle'}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className='flex min-h-0 flex-col gap-4'>
            {lyricsPanelOpen ? (
              <MusicLyricsPanel />
            ) : (
              <section className='rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 text-white/45'>
                <div className='text-xs uppercase tracking-[0.24em] text-white/45'>
                  Lyrics
                </div>
                <div className='mt-4 rounded-[24px] border border-white/10 bg-black/20 px-4 py-5 text-sm'>
                  Lyrics are hidden. Use the lyrics toggle to bring the active
                  lines back.
                </div>
              </section>
            )}
            {queuePanelOpen ? (
              <MusicQueueDrawer />
            ) : (
              <section className='rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 text-white/45'>
                <div className='flex items-center justify-between gap-3'>
                  <div className='text-xs uppercase tracking-[0.24em] text-white/45'>
                    Queue
                  </div>
                  <div className='rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-white/42'>
                    {`${queueLength} tracks`}
                  </div>
                </div>
                <div className='mt-4 rounded-[24px] border border-white/10 bg-black/20 px-4 py-5 text-sm'>
                  Queue panel is tucked away. Open it when you want to jump
                  between tracks.
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
