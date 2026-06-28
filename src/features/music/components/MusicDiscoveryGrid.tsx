'use client';

import type {
  MusicCollectionSummaryEntity,
  MusicHomeSectionEntity,
  MusicHomeSectionTab,
  MusicHomeView,
  MusicTrackEntity,
} from '../domain/entities';
import { formatMusicClock } from '../services/music-formatters';

interface MusicDiscoveryGridProps {
  homeView: MusicHomeView | null;
  activeSection: MusicHomeSectionTab;
  onOpenCollection: (collection: MusicCollectionSummaryEntity) => void;
  onPlayTrack: (id: string) => void;
}

function hasRenderableContent(section: MusicHomeSectionEntity): boolean {
  if (section.kind === 'track-list') {
    return Boolean(section.tracks?.length);
  }

  return Boolean(section.collections?.length);
}

function resolveSectionEyebrow(section: MusicHomeSectionEntity): string {
  return section.kind === 'track-list'
    ? 'Instant play lane'
    : 'Collection shelf';
}

function resolveSectionMeta(section: MusicHomeSectionEntity): string {
  const itemCount =
    section.kind === 'track-list'
      ? section.tracks?.length || 0
      : section.collections?.length || 0;

  return `${itemCount} ${
    section.kind === 'track-list' ? 'tracks' : 'collections'
  }`;
}

function CollectionCard(props: {
  collection: MusicCollectionSummaryEntity;
  onOpenCollection: (collection: MusicCollectionSummaryEntity) => void;
}): JSX.Element {
  const { collection, onOpenCollection } = props;

  return (
    <button
      type='button'
      aria-label={`Open collection ${collection.title}`}
      onClick={() => onOpenCollection(collection)}
      className='group text-left'
    >
      <div className='relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-3 transition duration-300 hover:-translate-y-1 hover:border-white/18 hover:bg-white/[0.08]'>
        <div
          className='relative aspect-[5/4] overflow-hidden rounded-[24px] border border-white/10'
          style={{
            background: collection.coverUrl
              ? `linear-gradient(180deg,rgba(15,23,42,0.1),rgba(15,23,42,0.86)), url(${collection.coverUrl}) center / cover`
              : `linear-gradient(135deg,${
                  collection.accentColor || '#1f2937'
                },#0f172a)`,
          }}
        >
          <div className='absolute inset-x-4 top-4 flex items-center justify-between gap-3'>
            <span className='rounded-full border border-white/12 bg-black/25 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-white/72 backdrop-blur'>
              {collection.kind}
            </span>
            {collection.trackCount ? (
              <span className='rounded-full border border-white/12 bg-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-white/72 backdrop-blur'>
                {`${collection.trackCount} tracks`}
              </span>
            ) : null}
          </div>
          <div className='absolute inset-x-4 bottom-4 rounded-[22px] border border-white/10 bg-black/40 px-4 py-4 backdrop-blur'>
            <div className='text-lg font-semibold tracking-[-0.03em] text-white'>
              {collection.title}
            </div>
            {collection.description ? (
              <div className='mt-2 line-clamp-2 text-sm leading-6 text-white/68'>
                {collection.description}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

function DiscoveryTrackRow(props: {
  track: MusicTrackEntity;
  index: number;
  onPlayTrack: (id: string) => void;
}): JSX.Element {
  const { index, onPlayTrack, track } = props;

  return (
    <button
      type='button'
      aria-label={`Play discovery track ${track.title}`}
      onClick={() => onPlayTrack(track.id)}
      className='group flex w-full items-center justify-between gap-4 rounded-[24px] border border-white/10 bg-black/20 px-4 py-4 text-left transition duration-300 hover:border-white/18 hover:bg-white/[0.08]'
    >
      <div className='flex min-w-0 items-center gap-4'>
        <div className='flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.06] text-sm font-medium text-white/72'>
          {String(index + 1).padStart(2, '0')}
        </div>
        <div
          className='h-14 w-14 shrink-0 rounded-[18px] border border-white/10 bg-slate-900'
          style={{
            background: track.coverUrl
              ? `linear-gradient(180deg,rgba(15,23,42,0.12),rgba(15,23,42,0.88)), url(${track.coverUrl}) center / cover`
              : 'linear-gradient(135deg,#111827,#1e293b)',
          }}
        />
        <div className='min-w-0'>
          <div className='truncate text-base font-medium text-white'>
            {track.title}
          </div>
          <div className='mt-1 truncate text-sm text-white/58'>
            {`${track.artists.join(' / ')} · ${track.album}`}
          </div>
        </div>
      </div>
      <div className='flex shrink-0 items-center gap-3'>
        <span className='text-xs tabular-nums text-white/42'>
          {formatMusicClock(track.durationMs)}
        </span>
        <span className='rounded-full border border-white/12 bg-white/[0.08] px-3 py-2 text-[10px] uppercase tracking-[0.24em] text-white/80 transition group-hover:bg-white group-hover:text-black'>
          Play
        </span>
      </div>
    </button>
  );
}

export function MusicDiscoveryGrid(props: MusicDiscoveryGridProps) {
  const { activeSection, homeView, onOpenCollection, onPlayTrack } = props;

  if (!homeView) {
    return null;
  }

  const sections = (
    activeSection === 'home'
      ? homeView.sections
      : homeView.sections.filter((section) => section.tab === activeSection)
  ).filter(hasRenderableContent);

  if (!sections.length) {
    return null;
  }

  return (
    <div className='space-y-5'>
      {sections.map((section) => (
        <section
          key={section.id}
          className='rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.22)]'
        >
          <div className='flex flex-wrap items-start justify-between gap-4'>
            <div className='min-w-0'>
              <div className='text-[11px] uppercase tracking-[0.28em] text-white/35'>
                {resolveSectionEyebrow(section)}
              </div>
              <h2 className='mt-3 text-2xl font-semibold tracking-[-0.03em] text-white'>
                {section.title}
              </h2>
              {section.description ? (
                <p className='mt-2 max-w-2xl text-sm leading-7 text-white/55'>
                  {section.description}
                </p>
              ) : null}
            </div>
            <div className='rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-white/42'>
              {resolveSectionMeta(section)}
            </div>
          </div>
          {section.kind === 'track-list' ? (
            <div className='mt-5 grid gap-3 xl:grid-cols-2'>
              {(section.tracks || []).map((track, index) => (
                <DiscoveryTrackRow
                  key={track.id}
                  track={track}
                  index={index}
                  onPlayTrack={onPlayTrack}
                />
              ))}
            </div>
          ) : (
            <div className='mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
              {(section.collections || []).map((collection) => (
                <CollectionCard
                  key={collection.id}
                  collection={collection}
                  onOpenCollection={onOpenCollection}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
