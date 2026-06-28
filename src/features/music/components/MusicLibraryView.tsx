'use client';

import { MusicDownloadDesktopHint } from './MusicDownloadDesktopHint';
import type { MusicCollectionSummaryEntity } from '../domain/entities';
import type { SavedMusicCollectionRecord } from '../services/music-collection-profile';
import { isMusicDownloadFeatureEnabled } from '../services/music-downloads';
import { formatMusicClock } from '../services/music-formatters';
import { resolveMusicCollectionSection } from '../services/music-section-support';
import type {
  MusicFavoriteRecord,
  MusicPlayRecord,
  MusicRecentTrackRecord,
} from '../services/music-profile';
import { useMusicAccountStore } from '../state/music-account-store';
import { useMusicDataStore } from '../state/music-data-store';
import { useMusicDownloadStore } from '../state/music-download-store';
import { useMusicShellStore } from '../state/music-shell-store';
import { usePlaybackStore } from '../state/playback-store';

interface MusicLibraryViewProps {
  savedCollections: SavedMusicCollectionRecord[];
  favoriteTracks: MusicFavoriteRecord[];
  recentTracks: MusicRecentTrackRecord[];
  resumeTracks: MusicPlayRecord[];
  onOpenCollection: (record: SavedMusicCollectionRecord) => void;
  onPlayTrack: (id: string, context: 'library' | 'recent' | 'download') => void;
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

function LibraryPlaylistRow(props: {
  onClick: () => void;
  playlist: MusicCollectionSummaryEntity;
}): JSX.Element {
  const { onClick, playlist } = props;
  const roleLabel =
    playlist.accountPlaylistRole === 'owned' ? 'Owned' : 'Collected';

  return (
    <button
      type='button'
      aria-label={`Open playlist ${playlist.title}`}
      onClick={onClick}
      className='group flex w-full items-center justify-between gap-4 rounded-[24px] border border-white/10 bg-black/20 px-4 py-4 text-left transition duration-300 hover:border-white/18 hover:bg-white/[0.08]'
    >
      <div className='min-w-0'>
        <div className='truncate text-base font-medium text-white'>
          {playlist.title}
        </div>
        <div className='mt-1 truncate text-sm text-white/55'>
          {playlist.description || `${playlist.trackCount || 0} tracks`}
        </div>
      </div>
      <div className='flex shrink-0 items-center gap-3'>
        <span className='rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/72'>
          {roleLabel}
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
  const musicAccount = useMusicAccountStore((state) => state.account);
  const accountConnected = Boolean(musicAccount?.authenticated);
  const accountPlaylists = musicAccount?.playlists || [];
  const currentTrackId = usePlaybackStore((state) => state.currentTrackId);
  const downloadRecords = useMusicDownloadStore((state) => state.records);
  const openCollection = useMusicDataStore((state) => state.openCollection);
  const setActiveSection = useMusicShellStore((state) => state.setActiveSection);
  const showDownloadSection = isMusicDownloadFeatureEnabled();

  const myPlaylistRows = accountPlaylists.map((playlist) => (
    <LibraryPlaylistRow
      key={`playlist-${playlist.source}-${playlist.id}`}
      playlist={playlist}
      onClick={() => {
        setActiveSection(resolveMusicCollectionSection(playlist.kind));
        void openCollection(playlist.id, playlist.kind);
      }}
    />
  ));
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
      actionLabel={`Play ${accountConnected ? 'liked' : 'saved'} track ${record.track.title}`}
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
  const offlineDownloadRows = Object.values(downloadRecords)
    .filter((record) => record.status === 'downloaded')
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((record) => (
      <LibraryTrackRow
        key={`download-${record.downloadId}`}
        active={currentTrackId === record.track.id}
        actionLabel={`Play offline track ${record.track.title}`}
        detail={`${record.track.artists.join(' / ')} · ${record.track.album}`}
        meta='Offline'
        onClick={() => onPlayTrack(record.track.id, 'download')}
        title={record.track.title}
      />
    ));

  return (
    <div className='space-y-5'>
      {accountConnected ? (
        <LibrarySection
          heading='My playlists'
          emptyDescription='Collect a playlist on any collection page and it will appear here instantly.'
        >
          {myPlaylistRows}
        </LibrarySection>
      ) : null}
      <LibrarySection
        heading='Saved collections'
        emptyDescription={
          accountConnected
            ? 'Pin rank, album, or artist shelves locally here. Cloud playlists live in My playlists.'
            : 'Save a playlist or rank shelf from any collection page to pin it here.'
        }
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
        heading={accountConnected ? 'Liked songs' : 'Saved tracks'}
        emptyDescription={
          accountConnected
            ? 'Like tracks from the full player to keep your Netease liked songs in sync here.'
            : 'Save tracks from the full player to build your desktop library.'
        }
      >
        {favoriteRows}
      </LibrarySection>
      <LibrarySection
        heading='Recently played'
        emptyDescription='Tracks you start from the rebuilt player will be listed here.'
      >
        {recentRows}
      </LibrarySection>
      <LibrarySection
        heading='Offline downloads'
        emptyDescription='Downloaded tracks will appear here for desktop-first playback.'
      >
        {showDownloadSection ? (
          offlineDownloadRows
        ) : (
          [<MusicDownloadDesktopHint key='desktop-download-hint' />]
        )}
      </LibrarySection>
    </div>
  );
}
