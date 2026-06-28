import { FormEvent, useEffect, useState } from 'react';

import {
  clearMusicSearchHistory,
  getMusicSearchHistory,
  saveMusicSearchHistoryEntry,
  subscribeToMusicSearchHistoryUpdates,
} from '../services/music-search-history';
import { resolveMusicCollectionSection } from '../services/music-section-support';
import { useMusicDataStore } from '../state/music-data-store';
import { useMusicLibraryStore } from '../state/music-library-store';
import { useMusicShellStore } from '../state/music-shell-store';
import {
  selectCurrentQueueItem,
  usePlaybackStore,
} from '../state/playback-store';
import { useMusicAccountStore } from '../state/music-account-store';

export function MusicTopBar() {
  const homeView = useMusicDataStore((state) => state.homeView);
  const source = useMusicDataStore((state) => state.source);
  const searchResult = useMusicDataStore((state) => state.searchResult);
  const selectedCollection = useMusicDataStore(
    (state) => state.selectedCollection
  );
  const clearSelectedCollection = useMusicDataStore(
    (state) => state.clearSelectedCollection
  );
  const submitSearch = useMusicDataStore((state) => state.submitSearch);
  const activeSection = useMusicShellStore((state) => state.activeSection);
  const setActiveSection = useMusicShellStore(
    (state) => state.setActiveSection
  );
  const favoriteCount = useMusicLibraryStore(
    (state) => state.favoriteTracks.length
  );
  const musicAccount = useMusicAccountStore((state) => state.account);
  const accountConnected = Boolean(musicAccount?.authenticated);
  const playlistCount = musicAccount?.playlists.length || 0;
  const recentCount = useMusicLibraryStore(
    (state) => state.recentTracks.length
  );
  const resumeCount = useMusicLibraryStore(
    (state) => state.resumeTracks.length
  );
  const currentTrack = usePlaybackStore(selectCurrentQueueItem);
  const [query, setQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const activeDiscoverySection =
    homeView?.sections.find((section) => section.tab === activeSection) || null;

  useEffect(() => {
    let active = true;

    void getMusicSearchHistory().then((history) => {
      if (!active) {
        return;
      }

      setRecentSearches(history);
    });

    const unsubscribe = subscribeToMusicSearchHistoryUpdates((history) => {
      if (!active) {
        return;
      }

      setRecentSearches(history);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (activeSection !== 'search') {
      return;
    }

    setQuery(searchResult?.query || '');
  }, [activeSection, searchResult?.query]);

  const runSearch = async (value: string) => {
    const normalizedQuery = value.trim();

    if (!normalizedQuery) {
      return;
    }

    setQuery(normalizedQuery);
    clearSelectedCollection();
    setActiveSection('search');
    const searchPayload = await submitSearch(normalizedQuery);

    if (!searchPayload) {
      return;
    }

    await saveMusicSearchHistoryEntry(normalizedQuery);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runSearch(query);
  };

  const modeLabel =
    activeSection === 'settings'
      ? 'Settings mode'
      : activeSection === 'library'
      ? 'Library mode'
      : activeSection === 'search'
      ? 'Search mode'
      : selectedCollection &&
        resolveMusicCollectionSection(selectedCollection.summary.kind) ===
          activeSection
      ? 'Collection mode'
      : activeSection === 'home'
      ? 'Music client'
      : 'Discovery mode';
  const selectedCollectionMatchesSection = Boolean(
    selectedCollection &&
      resolveMusicCollectionSection(selectedCollection.summary.kind) ===
        activeSection
  );
  const headline =
    activeSection === 'settings'
      ? 'Music settings'
      : activeSection === 'library'
      ? accountConnected
        ? 'Your music library'
        : 'Your local music library'
      : activeSection === 'search'
      ? searchResult?.query || 'Search live catalog'
      : selectedCollectionMatchesSection
      ? selectedCollection?.summary.title || 'Collection desk'
      : activeDiscoverySection?.title ||
        currentTrack?.track.title ||
        'Browse live catalog';
  const primaryMeta =
    activeSection === 'settings'
      ? 'Playback, theme, and lyric defaults'
      : activeSection === 'library'
      ? accountConnected
        ? `${playlistCount} playlists · ${favoriteCount} liked songs`
        : `${favoriteCount} saved tracks`
      : activeSection === 'search'
      ? `${searchResult?.tracks.length || 0} track hits`
      : selectedCollectionMatchesSection
      ? `${selectedCollection?.tracks.length || 0} loaded`
      : activeDiscoverySection
      ? activeDiscoverySection.kind === 'track-list'
        ? `${activeDiscoverySection.tracks?.length || 0} live tracks`
        : `${activeDiscoverySection.collections?.length || 0} collections`
      : 'Live queue ready';
  const secondaryMeta =
    activeSection === 'settings'
      ? `${favoriteCount} ${accountConnected ? 'liked' : 'saved'} · ${resumeCount} continue · ${recentCount} recent`
      : activeSection === 'library'
      ? `${resumeCount} continue · ${recentCount} recent`
      : activeSection === 'search'
      ? `${searchResult?.collections.length || 0} playlists`
      : selectedCollectionMatchesSection
      ? selectedCollection?.summary.description ||
        selectedCollection?.updatedAtLabel ||
        'Collection synced'
      : activeDiscoverySection?.description || 'Search to pivot the layout';
  const visibleRecentSearches = recentSearches.slice(0, 6);

  return (
    <header className='flex flex-wrap items-start justify-between gap-4'>
      <div className='min-w-0 flex-1'>
        <div className='text-[11px] uppercase tracking-[0.28em] text-white/35'>
          {modeLabel}
        </div>
        <div className='mt-2 flex flex-wrap items-end gap-3'>
          <div className='text-2xl font-semibold tracking-[-0.03em] text-white'>
            {headline}
          </div>
          <div className='rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-white/45'>
            {source}
          </div>
        </div>
      </div>
      <div className='w-full rounded-[28px] border border-white/10 bg-white/[0.04] p-3 lg:max-w-[520px]'>
        <form
          data-testid='music-search-form'
          onSubmit={handleSubmit}
          className='flex items-center gap-3'
        >
          <input
            placeholder='Search music'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className='w-full rounded-full border border-white/10 bg-black/20 px-4 py-3 text-sm'
          />
          <button
            type='submit'
            className='rounded-full bg-white px-4 py-3 text-sm font-medium text-black'
          >
            Search
          </button>
        </form>
        <div className='mt-3 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-white/35'>
          <span>{primaryMeta}</span>
          <span>{secondaryMeta}</span>
        </div>
        {visibleRecentSearches.length > 0 ? (
          <div className='mt-4 flex flex-wrap items-center gap-2'>
            <div className='text-[10px] uppercase tracking-[0.24em] text-white/30'>
              Recent
            </div>
            {visibleRecentSearches.map((entry) => (
              <button
                key={entry}
                type='button'
                aria-label={`Run recent search ${entry}`}
                onClick={() => {
                  void runSearch(entry);
                }}
                className='rounded-full border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/72 transition hover:border-white/25 hover:bg-white/[0.07] hover:text-white'
              >
                {entry}
              </button>
            ))}
            <button
              type='button'
              aria-label='Clear recent searches'
              onClick={() => {
                void clearMusicSearchHistory();
              }}
              className='rounded-full border border-white/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/42 transition hover:border-white/25 hover:text-white/72'
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
