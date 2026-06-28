'use client';

import type {
  MusicCollectionEntity,
  MusicCollectionSummaryEntity,
  MusicTrackEntity,
} from '../domain/entities';
import { MusicDownloadDesktopHint } from './MusicDownloadDesktopHint';
import { buildMusicDownloadId } from '../services/music-download-records';
import { formatMusicClock } from '../services/music-formatters';
import { isMusicDownloadFeatureEnabled } from '../services/music-downloads';
import { useMusicAccountStore } from '../state/music-account-store';
import { useMusicDataStore } from '../state/music-data-store';
import { useMusicDownloadStore } from '../state/music-download-store';
import { usePlaybackStore } from '../state/playback-store';

interface MusicCollectionViewProps {
  collection: MusicCollectionEntity | null;
  onOpenCollection: (summary: MusicCollectionSummaryEntity) => void;
  onToggleSavedCollection: (summary: MusicCollectionSummaryEntity) => void;
  onPlayTrack: (id: string, context?: 'collection') => void;
  saved: boolean;
}

function RelatedCollectionCard(props: {
  collection: MusicCollectionSummaryEntity;
  onOpenCollection: (summary: MusicCollectionSummaryEntity) => void;
}): JSX.Element {
  const { collection, onOpenCollection } = props;

  return (
    <button
      type='button'
      aria-label={`Open related collection ${collection.title}`}
      onClick={() => onOpenCollection(collection)}
      className='group overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-3 text-left transition duration-300 hover:-translate-y-1 hover:border-white/18 hover:bg-white/[0.08]'
    >
      <div
        className='aspect-[4/3] rounded-[20px] border border-white/10 bg-slate-900'
        style={{
          background: collection.coverUrl
            ? `linear-gradient(180deg,rgba(15,23,42,0.12),rgba(15,23,42,0.86)), url(${collection.coverUrl}) center / cover`
            : `linear-gradient(135deg,${
                collection.accentColor || '#1f2937'
              },#020617)`,
        }}
      />
      <div className='mt-4'>
        <div className='truncate text-base font-medium text-white'>
          {collection.title}
        </div>
        {collection.description ? (
          <div className='mt-2 truncate text-sm text-white/55'>
            {collection.description}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function CollectionTrackRow(props: {
  currentTrackId: string | null;
  downloadActionLabel?: string;
  downloadDisabled?: boolean;
  index: number;
  onDownloadTrack?: () => void;
  onPlayTrack: (id: string, context?: 'collection') => void;
  track: MusicTrackEntity;
}): JSX.Element {
  const {
    currentTrackId,
    downloadActionLabel,
    downloadDisabled = false,
    index,
    onDownloadTrack,
    onPlayTrack,
    track,
  } = props;
  const active = currentTrackId === track.id;

  return (
    <div
      className={`group grid w-full items-center gap-4 rounded-[24px] border px-4 py-4 text-left transition duration-300 lg:grid-cols-[56px_minmax(0,1.5fr)_minmax(0,1fr)_80px_96px] ${
        active
          ? 'border-white/30 bg-white/[0.12]'
          : 'border-white/10 bg-black/20 hover:border-white/18 hover:bg-white/[0.08]'
      }`}
    >
      <div className='flex h-11 w-11 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.06] text-sm font-medium text-white/68'>
        {String(index + 1).padStart(2, '0')}
      </div>
      <button
        type='button'
        aria-label={`Play collection track ${track.title}`}
        aria-current={active ? 'true' : undefined}
        onClick={() => onPlayTrack(track.id, 'collection')}
        className='min-w-0 text-left'
      >
        <div className='truncate text-base font-medium text-white'>
          {track.title}
        </div>
        <div className='mt-1 truncate text-sm text-white/55'>
          {track.artists.join(' / ')}
        </div>
      </button>
      <div className='min-w-0 text-sm text-white/42 lg:text-right'>
        <span className='truncate'>{track.album}</span>
      </div>
      <div className='text-xs tabular-nums text-white/38 lg:text-right'>
        {formatMusicClock(track.durationMs)}
      </div>
      <div className='flex items-center justify-end gap-2 lg:text-right'>
        {onDownloadTrack && downloadActionLabel ? (
          <button
            type='button'
            aria-label={`Download collection track ${track.title}`}
            disabled={downloadDisabled}
            onClick={(event) => {
              event.stopPropagation();
              onDownloadTrack();
            }}
            className='inline-flex rounded-full border border-white/12 bg-white/[0.08] px-3 py-2 text-[10px] uppercase tracking-[0.24em] text-white/82 transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-50'
          >
            {downloadActionLabel}
          </button>
        ) : null}
        <button
          type='button'
          aria-label={`Collection track action ${track.title}`}
          onClick={() => onPlayTrack(track.id, 'collection')}
          className={`inline-flex rounded-full border px-3 py-2 text-[10px] uppercase tracking-[0.24em] transition ${
            active
              ? 'border-white/18 bg-white text-black'
              : 'border-white/12 bg-white/[0.08] text-white/82 group-hover:bg-white group-hover:text-black'
          }`}
        >
          {active ? 'Active' : 'Play'}
        </button>
      </div>
    </div>
  );
}

export function MusicCollectionView(props: MusicCollectionViewProps) {
  const {
    collection,
    onOpenCollection,
    onPlayTrack,
    onToggleSavedCollection,
    saved,
  } = props;
  const currentTrackId = usePlaybackStore((state) => state.currentTrackId);
  const preferredPlaybackQuality = useMusicDataStore(
    (state) => state.preferredPlaybackQuality
  );
  const batchDownloading = useMusicDownloadStore(
    (state) => state.batchDownloading
  );
  const downloadTrack = useMusicDownloadStore((state) => state.downloadTrack);
  const downloadCollectionTracks = useMusicDownloadStore(
    (state) => state.downloadCollectionTracks
  );
  const downloadRecords = useMusicDownloadStore((state) => state.records);
  const musicAccount = useMusicAccountStore((state) => state.account);
  const showDownloadActions = isMusicDownloadFeatureEnabled();

  if (!collection) {
    return null;
  }

  const artistToplist = collection.summary.kind === 'artist-toplist';
  const relatedCollections = collection.relatedCollections || [];
  const headerEyebrow = artistToplist ? 'Artist desk' : 'Collection desk';
  const trackSectionTitle = artistToplist ? '热门歌曲' : 'Track table';
  const accountPlaylist = musicAccount?.authenticated
    ? musicAccount.playlists.find(
        (playlist) =>
          playlist.source === collection.summary.source &&
          playlist.id === collection.summary.id
      )
    : null;
  const playlistRole =
    accountPlaylist?.accountPlaylistRole || collection.summary.accountPlaylistRole;
  const useCloudPlaylistSemantics = Boolean(
    musicAccount?.authenticated && collection.summary.kind === 'playlist'
  );
  const saveActionLabel = !useCloudPlaylistSemantics
    ? saved
      ? 'Saved in library'
      : 'Save to library'
    : playlistRole === 'owned'
    ? 'In your playlists'
    : saved
    ? 'Collected'
    : 'Collect playlist';
  const saveActionAriaLabel = !useCloudPlaylistSemantics
    ? saved
      ? 'Remove collection from library'
      : 'Save collection to library'
    : playlistRole === 'owned'
    ? 'Playlist is in your playlists'
    : saved
    ? 'Uncollect playlist'
    : 'Collect playlist';
  const saveActionDisabled =
    useCloudPlaylistSemantics && playlistRole === 'owned';

  return (
    <section className='space-y-5 rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-6 text-white shadow-[0_28px_90px_rgba(0,0,0,0.22)]'>
      <div className='overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.18),transparent_32%),linear-gradient(135deg,rgba(9,14,26,0.94),rgba(8,11,20,0.98))] p-5'>
        <div className='grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center'>
          <div
            className='aspect-square rounded-[28px] border border-white/10 bg-slate-900 shadow-[0_26px_70px_rgba(0,0,0,0.38)]'
            style={{
              background: collection.summary.coverUrl
                ? `linear-gradient(180deg,rgba(15,23,42,0.08),rgba(15,23,42,0.86)), url(${collection.summary.coverUrl}) center / cover`
                : `linear-gradient(135deg,${
                    collection.summary.accentColor || '#1f2937'
                  },#020617)`,
            }}
          />
          <div className='min-w-0'>
            <div className='text-[11px] uppercase tracking-[0.28em] text-white/36'>
              {headerEyebrow}
            </div>
            <h2 className='mt-3 text-3xl font-semibold tracking-[-0.04em] text-white lg:text-4xl'>
              {collection.summary.title}
            </h2>
            <div className='mt-4 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-white/38'>
              {collection.summary.trackCount ? (
                <span className='rounded-full border border-white/10 bg-white/[0.05] px-3 py-2'>
                  {`${collection.summary.trackCount} tracks`}
                </span>
              ) : null}
              {collection.curator ? (
                <span className='rounded-full border border-white/10 bg-white/[0.05] px-3 py-2'>
                  {collection.curator}
                </span>
              ) : null}
              {collection.updatedAtLabel ? (
                <span className='rounded-full border border-white/10 bg-white/[0.05] px-3 py-2'>
                  {collection.updatedAtLabel}
                </span>
              ) : null}
            </div>
            {collection.summary.description ? (
              <div className='mt-4 max-w-3xl text-sm leading-7 text-white/60'>
                {collection.summary.description}
              </div>
            ) : null}
            <div className='mt-6 flex flex-wrap items-center gap-3'>
              <button
                type='button'
                aria-label='Play collection queue'
                onClick={() =>
                  onPlayTrack(collection.tracks[0]?.id || '', 'collection')
                }
                disabled={!collection.tracks.length}
                className='rounded-full bg-white px-5 py-3 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50'
              >
                Play all
              </button>
              {showDownloadActions ? (
                <button
                  type='button'
                  aria-label='Download all tracks'
                  onClick={() => {
                    void downloadCollectionTracks(
                      collection.tracks,
                      preferredPlaybackQuality
                    );
                  }}
                  disabled={!collection.tracks.length || batchDownloading}
                  className='rounded-full border border-white/15 bg-white/[0.04] px-5 py-3 text-sm text-white/85 transition hover:border-white/24 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {batchDownloading ? 'Downloading tracks' : 'Download all'}
                </button>
              ) : (
                <MusicDownloadDesktopHint />
              )}
              <button
                type='button'
                aria-label={saveActionAriaLabel}
                disabled={saveActionDisabled}
                onClick={() => onToggleSavedCollection(collection.summary)}
                className={`rounded-full border px-5 py-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  saved || saveActionDisabled
                    ? 'border-white/18 bg-white text-black'
                    : 'border-white/15 bg-white/[0.04] text-white/85'
                }`}
              >
                {saveActionLabel}
              </button>
              {currentTrackId ? (
                <div className='rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-[11px] uppercase tracking-[0.24em] text-white/42'>
                  Active queue synced
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className='space-y-4 rounded-[28px] border border-white/10 bg-black/20 p-4'>
        <div className='flex items-center justify-between gap-3'>
          <div className='text-[11px] uppercase tracking-[0.28em] text-white/35'>
            {trackSectionTitle}
          </div>
          <div className='hidden text-[11px] uppercase tracking-[0.24em] text-white/32 lg:block'>
            Title / Album / Duration / Action
          </div>
        </div>
        <div className='space-y-3'>
          {collection.tracks.map((track, index) => {
            const downloadRecord =
              downloadRecords[buildMusicDownloadId(track.source, track.id)] ??
              null;
            const downloadActionLabel =
              downloadRecord?.status === 'downloaded'
                ? 'Downloaded'
                : downloadRecord?.status === 'downloading'
                ? 'Downloading'
                : downloadRecord?.status === 'failed'
                ? 'Retry'
                : 'Download';

            return (
              <CollectionTrackRow
                key={track.id}
                currentTrackId={currentTrackId}
                downloadActionLabel={
                  showDownloadActions ? downloadActionLabel : undefined
                }
                downloadDisabled={
                  !showDownloadActions ||
                  downloadRecord?.status === 'downloaded' ||
                  downloadRecord?.status === 'downloading'
                }
                index={index}
                onDownloadTrack={
                  showDownloadActions
                    ? () => {
                        void downloadTrack(track, preferredPlaybackQuality);
                      }
                    : undefined
                }
                onPlayTrack={onPlayTrack}
                track={track}
              />
            );
          })}
        </div>
      </div>

      {artistToplist && relatedCollections.length > 0 ? (
        <div className='space-y-4 rounded-[28px] border border-white/10 bg-black/20 p-4'>
          <div className='flex items-center justify-between gap-3'>
            <div className='text-[11px] uppercase tracking-[0.28em] text-white/35'>
              热门专辑
            </div>
            <div className='text-[11px] uppercase tracking-[0.24em] text-white/32'>
              {`${relatedCollections.length} albums`}
            </div>
          </div>
          <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
            {relatedCollections.map((relatedCollection) => (
              <RelatedCollectionCard
                key={`${relatedCollection.kind}-${relatedCollection.id}`}
                collection={relatedCollection}
                onOpenCollection={onOpenCollection}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
