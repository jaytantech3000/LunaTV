'use client';

import type { SavedMusicCollectionRecord } from '../services/music-collection-profile';
import { formatMusicClock } from '../services/music-formatters';
import type {
  MusicFavoriteRecord,
  MusicPlayRecord,
  MusicRecentTrackRecord,
} from '../services/music-profile';
import { usePlaybackStore } from '../state/playback-store';

interface MusicLibraryViewProps {
  savedCollections: SavedMusicCollectionRecord[];
  favoriteTracks: MusicFavoriteRecord[];
  recentTracks: MusicRecentTrackRecord[];
  resumeTracks: MusicPlayRecord[];
  onOpenCollection: (record: SavedMusicCollectionRecord) => void;
  onPlayTrack: (id: string, context: 'library' | 'recent') => void;
}

function LibrarySection(props: {
  heading: string;
  emptyDescription: string;
  children: JSX.Element[] | null;
}): JSX.Element {
  const { children, emptyDescription, heading } = props;

  return (
    <section className='space-y-4 rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 text-white shadow-[0_28px_90px_rgba(0,0,0,0.22)]'>
      <div className='flex items-center justify-between gap-3'>
        <h2 className='text-2xl font-semibold tracking-[-0.03em] text-white'>
          {heading}
        </h2>
      </div>
      {children && children.length > 0 ? (
        <div className='space-y-3'>{children}</div>
      ) : (
        <div className='rounded-[24px] border border-dashed border-white/12 bg-black/20 px-4 py-5 text-sm text-white/48'>
          {emptyDescription}
        </div>
      )}
    </section>
  );
}

function LibraryTrackRow(props: {
  actionLabel: string;
  active: boolean;
  detail: string;
  meta: string;
  onClick: () => void;
  title: string;
}): JSX.Element {
  const { actionLabel, active, detail, meta, onClick, title } = props;

  return (
    <button
      type='button'
      aria-label={actionLabel}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      className={`group flex w-full items-center justify-between gap-4 rounded-[24px] border px-4 py-4 text-left transition duration-300 ${
        active
          ? 'border-white/30 bg-white/[0.12]'
          : 'border-white/10 bg-black/20 hover:border-white/18 hover:bg-white/[0.08]'
      }`}
    >
      <div className='min-w-0'>
        <div className='truncate text-base font-medium text-white'>{title}</div>
        <div className='mt-1 truncate text-sm text-white/55'>{detail}</div>
      </div>
      <div className='flex shrink-0 items-center gap-3'>
        <span className='text-xs tabular-nums text-white/38'>{meta}</span>
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

function LibraryCollectionRow(props: {
  onClick: () => void;
  record: SavedMusicCollectionRecord;
}): JSX.Element {
  const { onClick, record } = props;

  return (
    <button
      type='button'
      aria-label={`Open saved collection ${record.summary.title}`}
      onClick={onClick}
      className='group flex w-full items-center justify-between gap-4 rounded-[24px] border border-white/10 bg-black/20 px-4 py-4 text-left transition duration-300 hover:border-white/18 hover:bg-white/[0.08]'
    >
      <div className='min-w-0'>
        <div className='truncate text-base font-medium text-white'>
          {record.summary.title}
        </div>
        <div className='mt-1 truncate text-sm text-white/55'>
          {record.summary.description ||
            `${record.summary.kind} · ${record.summary.trackCount || 0} tracks`}
        </div>
      </div>
      <div className='flex shrink-0 items-center gap-3'>
        <span className='text-xs uppercase tracking-[0.24em] text-white/38'>
          {record.summary.kind}
        </span>
        <span className='rounded-full border border-white/12 bg-white/[0.08] px-3 py-2 text-[10px] uppercase tracking-[0.24em] text-white/82 transition group-hover:bg-white group-hover:text-black'>
          Open
        </span>
      </div>
    </button>
  );
}

export function MusicLibraryView(props: MusicLibraryViewProps) {
  const {
    favoriteTracks,
    onOpenCollection,
    onPlayTrack,
    recentTracks,
    resumeTracks,
    savedCollections,
  } = props;
  const currentTrackId = usePlaybackStore((state) => state.currentTrackId);

  const savedCollectionRows = savedCollections.map((record) => (
    <LibraryCollectionRow
      key={`collection-${record.summary.source}-${record.summary.id}`}
      record={record}
      onClick={() => onOpenCollection(record)}
    />
  ));

  const continueListeningRows = resumeTracks.map((record) => (
    <LibraryTrackRow
      key={`resume-${record.track.id}`}
      active={currentTrackId === record.track.id}
      actionLabel={`Resume track ${record.track.title}`}
      detail={`${record.track.artists.join(' / ')} · ${record.track.album}`}
      meta={`${formatMusicClock(record.playTimeMs)} / ${formatMusicClock(
        record.durationMs
      )}`}
      onClick={() => onPlayTrack(record.track.id, 'recent')}
      title={record.track.title}
    />
  ));

  const favoriteRows = favoriteTracks.map((record) => (
    <LibraryTrackRow
      key={`favorite-${record.track.id}`}
      active={currentTrackId === record.track.id}
      actionLabel={`Play saved track ${record.track.title}`}
      detail={`${record.track.artists.join(' / ')} · ${record.track.album}`}
      meta={formatMusicClock(record.track.durationMs)}
      onClick={() => onPlayTrack(record.track.id, 'library')}
      title={record.track.title}
    />
  ));

  const recentRows = recentTracks.map((record) => (
    <LibraryTrackRow
      key={`recent-${record.track.id}`}
      active={currentTrackId === record.track.id}
      actionLabel={`Play recent track ${record.track.title}`}
      detail={`${record.track.artists.join(' / ')} · ${record.track.album}`}
      meta={formatMusicClock(record.track.durationMs)}
      onClick={() => onPlayTrack(record.track.id, 'recent')}
      title={record.track.title}
    />
  ));

  return (
    <div className='space-y-5'>
      <LibrarySection
        heading='Saved collections'
        emptyDescription='Save a playlist or rank shelf from any collection page to pin it here.'
      >
        {savedCollectionRows}
      </LibrarySection>
      <LibrarySection
        heading='Continue listening'
        emptyDescription='Pause any track once and it will surface here as a resume slot.'
      >
        {continueListeningRows}
      </LibrarySection>
      <LibrarySection
        heading='Saved tracks'
        emptyDescription='Save tracks from the full player to build your desktop library.'
      >
        {favoriteRows}
      </LibrarySection>
      <LibrarySection
        heading='Recently played'
        emptyDescription='Tracks you start from the rebuilt player will be listed here.'
      >
        {recentRows}
      </LibrarySection>
    </div>
  );
}
