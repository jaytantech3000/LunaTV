'use client';

import { createFixtureRepository } from '../services/fixture-repository';
import { useLyricsStore } from '../state/lyrics-store';
import { usePlaybackStore } from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

export function MusicHero() {
  const seedQueue = usePlaybackStore((state) => state.seedQueue);
  const showMiniPlayer = usePlayerSurfaceStore((state) => state.showMiniPlayer);

  const handlePlayFeaturedQueue = async () => {
    const repository = createFixtureRepository();
    const queue = await repository.getQueueByContext('featured');
    const firstTrack = queue[0];
    if (!firstTrack) {
      return;
    }

    const lyrics = await repository.getLyrics(firstTrack.track.id);
    seedQueue(queue);
    useLyricsStore.getState().setLyrics(lyrics);
    showMiniPlayer();
  };

  return (
    <section className='rounded-[28px] bg-[radial-gradient(circle_at_top_left,#f97316,transparent_35%),linear-gradient(135deg,#111827,#020617)] p-6'>
      <p className='text-xs uppercase tracking-[0.24em] text-white/55'>
        Rebuild in progress
      </p>
      <h1 className='mt-3 text-3xl font-semibold'>Music big-bang rewrite</h1>
      <button
        type='button'
        onClick={handlePlayFeaturedQueue}
        className='mt-6 rounded-full bg-white px-5 py-3 text-sm font-medium text-black'
      >
        Play featured queue
      </button>
      <p className='mt-3 max-w-2xl text-sm leading-7 text-white/72'>
        The old music UI has been removed. This shell is now the official
        `/music` surface for the rebuild.
      </p>
    </section>
  );
}
