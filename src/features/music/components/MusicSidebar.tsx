import { MusicAccountCard } from './MusicAccountCard';
import type {
  MusicCollectionSummaryEntity,
  MusicHomeSectionTab,
} from '../domain/entities';
import type { SavedMusicCollectionRecord } from '../services/music-collection-profile';
import { resolveMusicCollectionSection } from '../services/music-section-support';
import { useMusicAccountStore } from '../state/music-account-store';
import { useMusicDataStore } from '../state/music-data-store';
import { useMusicLibraryStore } from '../state/music-library-store';
import { useMusicShellStore } from '../state/music-shell-store';
import {
  selectCurrentQueueItem,
  usePlaybackStore,
} from '../state/playback-store';

const TAB_LABELS: Record<MusicHomeSectionTab, string> = {
  home: '发现首页',
  rank: '官方榜单',
  hot: '热门流派',
  playlist: '推荐歌单',
  album: '精选专辑',
  artist: '艺人热歌',
  daily: '每日推荐',
  fm: '私人 FM',
  library: '音乐资料库',
  settings: '设置',
  search: '搜索结果',
};

const MAX_VISIBLE_SAVED_COLLECTIONS = 6;
const MAX_VISIBLE_PERSONAL_PLAYLISTS = 6;
const COMPACT_SAVED_COLLECTION_PREVIEW_LIMIT = 3;

function toCompactNavLabel(label: string): string {
  const normalized = label.trim();

  if (!normalized) {
    return '•';
  }

  if (/[\u4e00-\u9fff]/.test(normalized)) {
    return normalized[0] || '•';
  }

  return normalized.slice(0, 2).toUpperCase();
}

function SavedCollectionRailRow(props: {
  active: boolean;
  onOpen: () => void;
  onRemove: () => void;
  record: SavedMusicCollectionRecord;
}): JSX.Element {
  const { active, onOpen, onRemove, record } = props;

  return (
    <div
      className={`group flex items-center gap-2 rounded-[22px] border px-2 py-2 transition ${
        active
          ? 'border-white/16 bg-white/[0.08]'
          : 'border-white/8 bg-black/20 hover:border-white/15 hover:bg-white/[0.06]'
      }`}
    >
      <button
        type='button'
        aria-label={`Open saved collection ${record.summary.title}`}
        onClick={onOpen}
        className='min-w-0 flex-1 rounded-[18px] px-2 py-2 text-left'
      >
        <div className='truncate text-sm font-medium text-white'>
          {record.summary.title}
        </div>
        <div className='mt-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/38'>
          <span className='truncate'>{record.summary.kind}</span>
          <span className='rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[10px] normal-case tracking-normal text-white/52'>
            {`${record.summary.trackCount || 0} tracks`}
          </span>
        </div>
      </button>
      <button
        type='button'
        aria-label={`Remove saved collection ${record.summary.title}`}
        onClick={onRemove}
        className='flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-white/10 bg-white/[0.03] text-sm text-white/48 transition hover:border-rose-400/35 hover:bg-rose-400/12 hover:text-rose-100'
      >
        x
      </button>
    </div>
  );
}

function PersonalPlaylistRailRow(props: {
  active: boolean;
  onOpen: () => void;
  playlist: MusicCollectionSummaryEntity;
}): JSX.Element {
  const { active, onOpen, playlist } = props;

  return (
    <button
      type='button'
      aria-label={`Open personal playlist ${playlist.title}`}
      onClick={onOpen}
      className={`group flex w-full items-center justify-between gap-3 rounded-[22px] border px-4 py-3 text-left transition ${
        active
          ? 'border-white/16 bg-white/[0.08]'
          : 'border-white/8 bg-black/20 hover:border-white/15 hover:bg-white/[0.06]'
      }`}
    >
      <div className='min-w-0'>
        <div className='truncate text-sm font-medium text-white'>
          {playlist.title}
        </div>
        <div className='mt-1 truncate text-[11px] text-white/42'>
          {playlist.description || `${playlist.trackCount || 0} tracks`}
        </div>
      </div>
      <span className='rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/72 transition group-hover:bg-white group-hover:text-black'>
        Open
      </span>
    </button>
  );
}

export function MusicSidebar() {
  const musicAccount = useMusicAccountStore((state) => state.account);
  const activeSection = useMusicShellStore((state) => state.activeSection);
  const sidebarCollapsed = useMusicShellStore(
    (state) => state.sidebarCollapsed
  );
  const themeVariant = useMusicShellStore((state) => state.themeVariant);
  const setActiveSection = useMusicShellStore(
    (state) => state.setActiveSection
  );
  const toggleSidebar = useMusicShellStore((state) => state.toggleSidebar);
  const clearSelectedCollection = useMusicDataStore(
    (state) => state.clearSelectedCollection
  );
  const homeView = useMusicDataStore((state) => state.homeView);
  const openCollection = useMusicDataStore((state) => state.openCollection);
  const selectedCollection = useMusicDataStore(
    (state) => state.selectedCollection
  );
  const savedCollections = useMusicLibraryStore(
    (state) => state.savedCollections
  );
  const removeSavedCollection = useMusicLibraryStore(
    (state) => state.removeSavedCollection
  );
  const currentTrack = usePlaybackStore(selectCurrentQueueItem);
  const personalPlaylists = musicAccount?.playlists || [];
  const sectionNavigationItems: Array<{
    key: MusicHomeSectionTab;
    label: string;
  }> = (homeView?.sections ?? []).map(
    (section): { key: MusicHomeSectionTab; label: string } => ({
      key: section.tab,
      label: section.title || TAB_LABELS[section.tab] || section.tab,
    })
  );

  const navigationItems = (
    [
      {
        key: 'home',
        label: TAB_LABELS.home,
      },
      {
        key: 'library',
        label: TAB_LABELS.library,
      },
      {
        key: 'settings',
        label: TAB_LABELS.settings,
      },
      ...sectionNavigationItems,
    ] as Array<{ key: MusicHomeSectionTab; label: string }>
  ).filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.key === item.key) === index
  );
  const visibleSavedCollections = savedCollections.slice(
    0,
    MAX_VISIBLE_SAVED_COLLECTIONS
  );
  const hiddenSavedCollectionCount = Math.max(
    savedCollections.length - visibleSavedCollections.length,
    0
  );
  const compactSavedCollections = savedCollections.slice(
    0,
    COMPACT_SAVED_COLLECTION_PREVIEW_LIMIT
  );
  const visiblePersonalPlaylists = personalPlaylists.slice(
    0,
    MAX_VISIBLE_PERSONAL_PLAYLISTS
  );

  return (
    <aside
      className={`overflow-hidden rounded-[34px] border border-white/10 text-white shadow-[0_40px_120px_rgba(0,0,0,0.35)] transition-all duration-300 ${
        themeVariant === 'sunset'
          ? 'bg-[linear-gradient(180deg,rgba(43,18,23,0.98),rgba(92,39,42,0.92))]'
          : 'bg-[linear-gradient(180deg,rgba(7,10,18,0.98),rgba(12,17,29,0.92))]'
      } ${sidebarCollapsed ? 'p-3' : 'p-5'}`}
    >
      <div className='flex items-center justify-between gap-3'>
        {sidebarCollapsed ? (
          <div className='flex w-full flex-col items-center gap-3'>
            <div className='flex h-12 w-12 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.05] text-sm font-semibold tracking-[0.2em] text-white'>
              LM
            </div>
            <div className='rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-emerald-100'>
              Live
            </div>
            <button
              type='button'
              aria-label='Expand music sidebar'
              onClick={toggleSidebar}
              className='flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/12 bg-white/[0.05] text-sm text-white/82 transition hover:border-white/26 hover:bg-white/[0.1]'
            >
              &gt;
            </button>
          </div>
        ) : (
          <>
            <div>
              <div className='text-[11px] uppercase tracking-[0.28em] text-white/35'>
                Luna Music
              </div>
              <div className='mt-2 text-2xl font-semibold tracking-[-0.03em] text-white'>
                Browse
              </div>
            </div>
            <div className='flex items-center gap-2'>
              <div className='rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-emerald-100'>
                Live
              </div>
              <button
                type='button'
                aria-label='Collapse music sidebar'
                onClick={toggleSidebar}
                className='flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/12 bg-white/[0.05] text-sm text-white/82 transition hover:border-white/26 hover:bg-white/[0.1]'
              >
                &lt;
              </button>
            </div>
          </>
        )}
      </div>
      {sidebarCollapsed ? (
        <>
          <div className='mt-4 flex justify-center'>
            <div
              aria-label='Compact sidebar cover art'
              className='h-14 w-14 rounded-[20px] border border-white/10 bg-slate-900'
              style={{
                background: currentTrack?.track.coverUrl
                  ? `linear-gradient(180deg,rgba(15,23,42,0.12),rgba(15,23,42,0.82)), url(${currentTrack.track.coverUrl}) center / cover`
                  : 'linear-gradient(135deg,#0f172a,#1e293b)',
              }}
            />
          </div>
          {compactSavedCollections.length > 0 ? (
            <div className='mt-4 flex flex-col items-center gap-2'>
              <div className='flex flex-col items-center gap-2'>
                {compactSavedCollections.map((record) => (
                  <button
                    key={`${record.summary.source}-${record.summary.id}`}
                    type='button'
                    aria-label={`Open saved collection ${record.summary.title}`}
                    onClick={() => {
                      setActiveSection(
                        resolveMusicCollectionSection(record.summary.kind)
                      );
                      void openCollection(
                        record.summary.id,
                        record.summary.kind
                      );
                    }}
                    className='flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/10 bg-white/[0.05] text-[11px] font-semibold uppercase tracking-[0.14em] text-white/78 transition hover:border-white/18 hover:bg-white/[0.12]'
                  >
                    {toCompactNavLabel(record.summary.title)}
                  </button>
                ))}
              </div>
              <div className='rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-white/58'>
                {`${savedCollections.length} saved`}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className='mt-6 rounded-[26px] border border-white/10 bg-white/[0.04] p-4'>
          <div className='text-[11px] uppercase tracking-[0.22em] text-white/35'>
            Now spinning
          </div>
          <div className='mt-3 text-sm font-medium text-white'>
            {currentTrack?.track.title || 'Featured queue waiting'}
          </div>
          <div className='mt-1 text-sm text-white/50'>
            {currentTrack?.track.artists.join(' / ') ||
              'Pick any live track to start'}
          </div>
        </div>
      )}
      <nav
        className={`text-sm ${
          sidebarCollapsed ? 'mt-4 space-y-2' : 'mt-6 space-y-3'
        }`}
      >
        {navigationItems.map((item) => {
          const active = item.key === activeSection;
          const compactLabel = toCompactNavLabel(item.label);

          return (
            <button
              key={item.key}
              type='button'
              aria-label={`Navigate ${item.label}`}
              onClick={() => {
                clearSelectedCollection();
                setActiveSection(item.key);
              }}
              className={
                active
                  ? `block w-full rounded-[24px] border border-white/12 bg-white/10 ${
                      sidebarCollapsed
                        ? 'px-0 py-3 text-center'
                        : 'px-4 py-3 text-left'
                    }`
                  : `block w-full rounded-[24px] border border-transparent text-white/72 transition hover:border-white/8 hover:bg-white/5 hover:text-white ${
                      sidebarCollapsed
                        ? 'px-0 py-3 text-center'
                        : 'px-4 py-3 text-left'
                    }`
              }
            >
              {sidebarCollapsed ? (
                <div className='flex flex-col items-center gap-1'>
                  <span className='text-base font-medium text-white'>
                    {compactLabel}
                  </span>
                  <span className='text-[10px] uppercase tracking-[0.2em] text-white/28'>
                    {item.key}
                  </span>
                </div>
              ) : (
                <div className='flex items-center justify-between gap-3'>
                  <span>{item.label}</span>
                  <span className='text-[10px] uppercase tracking-[0.22em] text-white/28'>
                    {item.key}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </nav>
      {!sidebarCollapsed && visiblePersonalPlaylists.length > 0 ? (
        <section className='mt-6 rounded-[26px] border border-white/10 bg-white/[0.04] p-4 text-white'>
          <div className='flex items-center justify-between gap-3'>
            <div className='text-[11px] uppercase tracking-[0.24em] text-white/35'>
              My playlists
            </div>
            <div className='rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/42'>
              {personalPlaylists.length}
            </div>
          </div>
          <div className='mt-4 space-y-2'>
            {visiblePersonalPlaylists.map((playlist) => {
              const active = selectedCollection?.summary.id === playlist.id;

              return (
                <PersonalPlaylistRailRow
                  key={`${playlist.source}-${playlist.id}`}
                  active={active}
                  playlist={playlist}
                  onOpen={() => {
                    setActiveSection(
                      resolveMusicCollectionSection(playlist.kind)
                    );
                    void openCollection(playlist.id, playlist.kind);
                  }}
                />
              );
            })}
          </div>
        </section>
      ) : null}
      {!sidebarCollapsed && activeSection !== 'settings' ? (
        <section className='mt-6 rounded-[26px] border border-white/10 bg-white/[0.04] p-4 text-white'>
          <div className='flex items-center justify-between gap-3'>
            <div className='text-[11px] uppercase tracking-[0.24em] text-white/35'>
              Saved collections
            </div>
            <div className='rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/42'>
              {savedCollections.length}
            </div>
          </div>
          {visibleSavedCollections.length > 0 ? (
            <div className='mt-4 space-y-2'>
              {visibleSavedCollections.map((record) => {
                const active =
                  selectedCollection?.summary.id === record.summary.id;

                return (
                  <SavedCollectionRailRow
                    key={`${record.summary.source}-${record.summary.id}`}
                    active={active}
                    record={record}
                    onOpen={() => {
                      setActiveSection(
                        resolveMusicCollectionSection(record.summary.kind)
                      );
                      void openCollection(
                        record.summary.id,
                        record.summary.kind
                      );
                    }}
                    onRemove={() => {
                      void removeSavedCollection({
                        source: record.summary.source,
                        id: record.summary.id,
                      });
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <div className='mt-4 rounded-[20px] border border-dashed border-white/10 bg-black/20 px-4 py-4 text-sm text-white/45'>
              Save a collection to pin it here.
            </div>
          )}
          {hiddenSavedCollectionCount > 0 ? (
            <button
              type='button'
              aria-label={`Open library for ${hiddenSavedCollectionCount} more saved collections`}
              onClick={() => setActiveSection('library')}
              className='mt-4 w-full rounded-[20px] border border-dashed border-white/12 bg-black/20 px-4 py-3 text-left text-sm text-white/62 transition hover:border-white/18 hover:bg-white/[0.06] hover:text-white'
            >
              {`${hiddenSavedCollectionCount} more saved collections in library`}
            </button>
          ) : null}
        </section>
      ) : null}
      <MusicAccountCard collapsed={sidebarCollapsed} />
    </aside>
  );
}
