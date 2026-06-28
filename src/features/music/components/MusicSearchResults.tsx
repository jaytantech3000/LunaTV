'use client';

import type {
  MusicCollectionSummaryEntity,
  MusicSearchResultEntity,
  MusicTrackEntity,
} from '../domain/entities';
import { formatMusicClock } from '../services/music-formatters';
import { usePlaybackStore } from '../state/playback-store';

interface MusicSearchResultsProps {
  searchResult: MusicSearchResultEntity | null;
  onPlayTrack: (id: string, context?: 'search') => void;
  onOpenCollection: (collection: MusicCollectionSummaryEntity) => void;
}

function SearchCollectionCard(props: {
  collection: MusicCollectionSummaryEntity;
  onOpenCollection: (collection: MusicCollectionSummaryEntity) => void;
}): JSX.Element {
  const { collection, onOpenCollection } = props;

  return (
    <button
      key={collection.id}
      type='button'
      aria-label={`Open search collection ${collection.title}`}
      onClick={() => onOpenCollection(collection)}
      className='group block w-full text-left'
    >
      <div className='overflow-hidden rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-3 transition duration-300 hover:-translate-y-1 hover:border-white/18 hover:bg-white/[0.08]'>
        <div
          className='relative aspect-[4/3] overflow-hidden rounded-[22px] border border-white/10'
          style={{
            background: collection.coverUrl
              ? `linear-gradient(180deg,rgba(15,23,42,0.12),rgba(15,23,42,0.88)), url(${collection.coverUrl}) center / cover`
              : `linear-gradient(135deg,${
                  collection.accentColor || '#1f2937'
                },#020617)`,
          }}
        >
          <div className='absolute inset-x-4 top-4 flex items-center justify-between gap-3'>
            <span className='rounded-full border border-white/12 bg-black/30 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-white/75 backdrop-blur'>
              {collection.kind}
            </span>
            {collection.trackCount ? (
              <span className='rounded-full border border-white/12 bg-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-white/75 backdrop-blur'>
                {`${collection.trackCount} tracks`}
              </span>
            ) : null}
          </div>
          <div className='absolute inset-x-4 bottom-4 rounded-[20px] border border-white/10 bg-black/40 px-4 py-4 backdrop-blur'>
            <div className='text-base font-semibold tracking-[-0.03em] text-white'>
              {collection.title}
            </div>
            {collection.description ? (
              <div className='mt-2 line-clamp-2 text-sm leading-6 text-white/65'>
                {collection.description}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

function SearchTrackRow(props: {
  currentTrackId: string | null;
  onPlayTrack: (id: string, context?: 'search') => void;
  track: MusicTrackEntity;
  index: number;
}): JSX.Element {
  const { currentTrackId, onPlayTrack, track, index } = props;
  const active = currentTrackId === track.id;

  return (
    <button
      type='button'
      aria-label={`Play search track ${track.title}`}
      aria-current={active ? 'true' : undefined}
      onClick={() => onPlayTrack(track.id, 'search')}
      className={`group flex w-full items-center justify-between gap-4 rounded-[24px] border px-4 py-4 text-left transition duration-300 ${
        active
          ? 'border-white/30 bg-white/[0.12]'
          : 'border-white/10 bg-black/20 hover:border-white/18 hover:bg-white/[0.08]'
      }`}
    >
      <div className='flex min-w-0 items-center gap-4'>
        <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.06] text-sm font-medium text-white/68'>
          {String(index + 1).padStart(2, '0')}
        </div>
        <div
          className='h-14 w-14 shrink-0 rounded-[18px] border border-white/10 bg-slate-900'
          style={{
            background: track.coverUrl
              ? `linear-gradient(180deg,rgba(15,23,42,0.12),rgba(15,23,42,0.86)), url(${track.coverUrl}) center / cover`
              : 'linear-gradient(135deg,#111827,#1e293b)',
          }}
        />
        <div className='min-w-0'>
          <div className='truncate text-base font-medium text-white'>
            {track.title}
          </div>
          <div className='mt-1 truncate text-sm text-white/55'>
            {`${track.artists.join(' / ')} · ${track.album}`}
          </div>
        </div>
      </div>
      <div className='flex shrink-0 items-center gap-3'>
        <span className='text-xs tabular-nums text-white/38'>
          {formatMusicClock(track.durationMs)}
        </span>
        <span
          className={`rounded-full border px-3 py-2 text-[10px] uppercase tracking-[0.24em] transition ${
            active
              ? 'border-white/18 bg-white text-black'
              : 'border-white/12 bg-white/[0.08] text-white/82 group-hover:bg-white group-hover:text-black'
          }`}
        >
          {active ? 'Active' : 'Play'}
        </span>
      </div>
    </button>
  );
}

export function MusicSearchResults(props: MusicSearchResultsProps) {
  const { onOpenCollection, onPlayTrack, searchResult } = props;
  const currentTrackId = usePlaybackStore((state) => state.currentTrackId);

  if (!searchResult) {
    return null;
  }

  const topTrack = searchResult.tracks[0] || null;
  const leadCollection = searchResult.collections[0] || null;

  return (
    <section className='space-y-5 rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-6 text-white shadow-[0_28px_90px_rgba(0,0,0,0.22)]'>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <div className='text-[11px] uppercase tracking-[0.28em] text-white/35'>
            Search desk
          </div>
          <h2 className='mt-3 text-2xl font-semibold tracking-[-0.03em] text-white'>
            {`Search results for ${searchResult.query}`}
          </h2>
        </div>
        <div className='flex items-center gap-3 text-[11px] uppercase tracking-[0.24em] text-white/38'>
          <span className='rounded-full border border-white/10 bg-white/[0.04] px-3 py-2'>
            {`${searchResult.tracks.length} tracks`}
          </span>
          <span className='rounded-full border border-white/10 bg-white/[0.04] px-3 py-2'>
            {`${searchResult.collections.length} collections`}
          </span>
        </div>
      </div>

      <div className='grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_420px]'>
        <div className='overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_34%),linear-gradient(135deg,rgba(9,14,26,0.94),rgba(8,11,20,0.96))] p-5'>
          <div className='grid gap-5 lg:grid-cols-[180px_minmax(0,1fr)]'>
            <div
              className='aspect-square rounded-[24px] border border-white/10 bg-slate-900 shadow-[0_24px_60px_rgba(0,0,0,0.35)]'
              style={{
                background: topTrack?.coverUrl
                  ? `linear-gradient(180deg,rgba(15,23,42,0.08),rgba(15,23,42,0.84)), url(${topTrack.coverUrl}) center / cover`
                  : 'linear-gradient(135deg,#0f172a,#1e293b)',
              }}
            />
            <div className='min-w-0'>
              <div className='text-[11px] uppercase tracking-[0.28em] text-white/38'>
                Top hit
              </div>
              <div className='mt-3 text-3xl font-semibold tracking-[-0.04em] text-white'>
                {topTrack?.title || 'No track hit'}
              </div>
              <div className='mt-2 text-sm text-white/62'>
                {topTrack
                  ? `${topTrack.artists.join(' / ')} · ${topTrack.album}`
                  : 'Try another keyword to load tracks.'}
              </div>
              <div className='mt-5 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-white/38'>
                {topTrack ? (
                  <span className='rounded-full border border-white/10 bg-white/[0.04] px-3 py-2'>
                    {formatMusicClock(topTrack.durationMs)}
                  </span>
                ) : null}
                {leadCollection ? (
                  <span className='rounded-full border border-white/10 bg-white/[0.04] px-3 py-2'>
                    {leadCollection.title}
                  </span>
                ) : null}
              </div>
              <div className='mt-6 flex flex-wrap items-center gap-3'>
                {topTrack ? (
                  <button
                    type='button'
                    aria-label='Play top search track'
                    onClick={() => onPlayTrack(topTrack.id, 'search')}
                    className='rounded-full bg-white px-5 py-3 text-sm font-medium text-black'
                  >
                    Play top hit
                  </button>
                ) : null}
                {leadCollection ? (
                  <button
                    type='button'
                    aria-label={`Open lead search collection ${leadCollection.title}`}
                    onClick={() => onOpenCollection(leadCollection)}
                    className='rounded-full border border-white/15 bg-white/[0.04] px-5 py-3 text-sm text-white/85'
                  >
                    Open lead collection
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className='space-y-3'>
          <div className='flex items-center justify-between gap-3'>
            <div className='text-[11px] uppercase tracking-[0.28em] text-white/35'>
              Collection matches
            </div>
            <div className='text-[11px] uppercase tracking-[0.24em] text-white/32'>
              {`${searchResult.collections.length} shelves`}
            </div>
          </div>
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-1'>
            {searchResult.collections.map((collection) => (
              <SearchCollectionCard
                key={collection.id}
                collection={collection}
                onOpenCollection={onOpenCollection}
              />
            ))}
          </div>
        </div>
      </div>

      <div className='space-y-4 rounded-[28px] border border-white/10 bg-black/20 p-4'>
        <div className='flex items-center justify-between gap-3'>
          <div className='text-[11px] uppercase tracking-[0.28em] text-white/35'>
            Track queue
          </div>
          <div className='text-[11px] uppercase tracking-[0.24em] text-white/32'>
            Double as instant play
          </div>
        </div>
        <div className='space-y-3'>
          {searchResult.tracks.map((track, index) => (
            <SearchTrackRow
              key={track.id}
              currentTrackId={currentTrackId}
              onPlayTrack={onPlayTrack}
              track={track}
              index={index}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
