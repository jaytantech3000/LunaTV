'use client';

import { useMusicDataStore } from '../state/music-data-store';

export function MusicHero() {
  const homeView = useMusicDataStore((state) => state.homeView);
  const loading = useMusicDataStore((state) => state.loading);
  const playTrack = useMusicDataStore((state) => state.playTrack);

  const handlePlayFeaturedQueue = async () => {
    const featuredQueue = homeView?.featuredQueue || [];
    const firstQueueItem = featuredQueue[0];

    if (!firstQueueItem) {
      return;
    }

    await playTrack(firstQueueItem.track.id, 'featured');
  };

  const featuredTrack =
    homeView?.spotlight[0] || homeView?.featuredQueue[0]?.track || null;

  return (
    <section className='overflow-hidden rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.26),transparent_38%),linear-gradient(135deg,#111827,#020617_54%,#0f172a)] p-6'>
      <div className='grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_280px] lg:items-center'>
        <div>
          <p className='text-[11px] uppercase tracking-[0.28em] text-white/45'>
            Live Netease feed
          </p>
          <h1 className='mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-white lg:text-5xl'>
            {featuredTrack?.title || '网易云精选'}
          </h1>
          <p className='mt-4 max-w-2xl text-sm leading-7 text-white/68'>
            {featuredTrack
              ? `${featuredTrack.artists.join(' / ')} · ${featuredTrack.album}`
              : '正式 `/music` 已接入网易云首页、搜索和真实点播链路。'}
          </p>
          <div className='mt-6 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-white/38'>
            <span className='rounded-full border border-white/10 bg-white/[0.04] px-3 py-2'>
              {`${homeView?.sections.length || 0} live sections`}
            </span>
            <span className='rounded-full border border-white/10 bg-white/[0.04] px-3 py-2'>
              {homeView?.featuredQueue.length
                ? `${homeView.featuredQueue.length} queued picks`
                : 'featured queue empty'}
            </span>
          </div>
          <button
            type='button'
            onClick={() => {
              void handlePlayFeaturedQueue();
            }}
            disabled={!homeView?.featuredQueue.length || loading}
            className='mt-8 rounded-full bg-white px-5 py-3 text-sm font-medium text-black'
          >
            Play featured queue
          </button>
        </div>
        <div className='relative mx-auto w-full max-w-[280px]'>
          <div className='absolute inset-0 rounded-[34px] bg-orange-500/15 blur-3xl' />
          <div
            className='relative aspect-square rounded-[34px] border border-white/10 bg-slate-900 shadow-[0_28px_80px_rgba(0,0,0,0.45)]'
            style={{
              background: featuredTrack?.coverUrl
                ? `linear-gradient(180deg,rgba(15,23,42,0.08),rgba(15,23,42,0.82)),url(${featuredTrack.coverUrl}) center / cover`
                : 'linear-gradient(135deg,#0f172a,#1e293b)',
            }}
          >
            <div className='absolute inset-x-5 bottom-5 rounded-[24px] border border-white/10 bg-black/45 px-4 py-3 backdrop-blur'>
              <div className='text-[11px] uppercase tracking-[0.24em] text-white/38'>
                Spotlight
              </div>
              <div className='mt-2 text-sm font-medium text-white'>
                {featuredTrack?.title || 'No featured track'}
              </div>
              <div className='mt-1 text-sm text-white/52'>
                {featuredTrack?.artists.join(' / ') || 'Waiting for live feed'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
