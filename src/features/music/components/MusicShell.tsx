'use client';

/* eslint-disable no-console */

import { useEffect, useRef, useState } from 'react';

import { MusicCollectionView } from './MusicCollectionView';
import { MusicDiscoveryGrid } from './MusicDiscoveryGrid';
import { MusicHero } from './MusicHero';
import { MusicLibraryView } from './MusicLibraryView';
import { MusicSearchResults } from './MusicSearchResults';
import { MusicSettingsView } from './MusicSettingsView';
import { MusicSidebar } from './MusicSidebar';
import { MusicTopBar } from './MusicTopBar';
import {
  buildMusicCollectionProfileKey,
  subscribeToMusicCollectionProfileUpdates,
} from '../services/music-collection-profile';
import { getMusicPreferences } from '../services/music-preferences';
import { subscribeToMusicProfileUpdates } from '../services/music-profile';
import { resolveMusicCollectionSection } from '../services/music-section-support';
import {
  applyMusicUrlState,
  buildMusicUrlStatePath,
} from '../services/music-url-state';
import { useLyricsStore } from '../state/lyrics-store';
import { useMusicDataStore } from '../state/music-data-store';
import { useMusicLibraryStore } from '../state/music-library-store';
import { useMusicShellStore } from '../state/music-shell-store';
import { usePlaybackStore } from '../state/playback-store';

export function MusicShell() {
  const preferencesHydratedRef = useRef(false);
  const routeStateAppliedRef = useRef(false);
  const activeSection = useMusicShellStore((state) => state.activeSection);
  const sidebarCollapsed = useMusicShellStore(
    (state) => state.sidebarCollapsed
  );
  const themeVariant = useMusicShellStore((state) => state.themeVariant);
  const setActiveSection = useMusicShellStore(
    (state) => state.setActiveSection
  );
  const clearSelectedCollection = useMusicDataStore(
    (state) => state.clearSelectedCollection
  );
  const bootstrap = useMusicDataStore((state) => state.bootstrap);
  const error = useMusicDataStore((state) => state.error);
  const homeView = useMusicDataStore((state) => state.homeView);
  const loading = useMusicDataStore((state) => state.loading);
  const openCollection = useMusicDataStore((state) => state.openCollection);
  const playTrack = useMusicDataStore((state) => state.playTrack);
  const searchResult = useMusicDataStore((state) => state.searchResult);
  const selectedCollection = useMusicDataStore(
    (state) => state.selectedCollection
  );
  const submitSearch = useMusicDataStore((state) => state.submitSearch);
  const savedCollections = useMusicLibraryStore(
    (state) => state.savedCollections
  );
  const savedCollectionKeys = useMusicLibraryStore(
    (state) => state.savedCollectionKeys
  );
  const favoriteTracks = useMusicLibraryStore((state) => state.favoriteTracks);
  const hydrateLibrary = useMusicLibraryStore((state) => state.hydrateLibrary);
  const toggleSavedCollection = useMusicLibraryStore(
    (state) => state.toggleSavedCollection
  );
  const libraryError = useMusicLibraryStore((state) => state.error);
  const libraryHydrated = useMusicLibraryStore((state) => state.hydrated);
  const recentTracks = useMusicLibraryStore((state) => state.recentTracks);
  const resumeTracks = useMusicLibraryStore((state) => state.resumeTracks);
  const [routeStateReady, setRouteStateReady] = useState(false);

  useEffect(() => {
    if (!homeView) {
      void bootstrap();
    }
  }, [bootstrap, homeView]);

  useEffect(() => {
    if (preferencesHydratedRef.current) {
      return;
    }

    preferencesHydratedRef.current = true;
    let cancelled = false;

    const hydrateMusicPreferences = async () => {
      const preferences = await getMusicPreferences();

      if (cancelled) {
        return;
      }

      useMusicShellStore.setState({
        sidebarCollapsed: preferences.sidebarCollapsed,
        themeVariant: preferences.themeVariant,
      });
      useMusicDataStore.setState({
        preferredPlaybackQuality: preferences.preferredPlaybackQuality,
      });
      usePlaybackStore.setState({
        playMode: preferences.playMode,
        volume: preferences.volume,
        muted: preferences.muted,
      });
      useLyricsStore.setState({
        followMode: preferences.lyricsFollowMode,
      });
    };

    void hydrateMusicPreferences().catch((error) => {
      console.error('同步音乐偏好失败', error);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (routeStateAppliedRef.current) {
      return;
    }

    routeStateAppliedRef.current = true;

    if (typeof window === 'undefined') {
      setRouteStateReady(true);
      return;
    }

    let cancelled = false;

    const restoreUrlState = async () => {
      await applyMusicUrlState(window.location.search, {
        clearSelectedCollection,
        openCollection,
        setActiveSection,
        submitSearch,
      });

      if (!cancelled) {
        setRouteStateReady(true);
      }
    };

    void restoreUrlState();

    return () => {
      cancelled = true;
    };
  }, [clearSelectedCollection, openCollection, setActiveSection, submitSearch]);

  useEffect(() => {
    if (!routeStateReady || typeof window === 'undefined') {
      return;
    }

    let disposed = false;

    const handlePopState = () => {
      void applyMusicUrlState(window.location.search, {
        clearSelectedCollection,
        openCollection,
        setActiveSection,
        submitSearch,
      }).catch((error) => {
        if (disposed) {
          return;
        }

        console.error('恢复音乐 URL 状态失败', error);
      });
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      disposed = true;
      window.removeEventListener('popstate', handlePopState);
    };
  }, [
    clearSelectedCollection,
    openCollection,
    routeStateReady,
    setActiveSection,
    submitSearch,
  ]);

  useEffect(() => {
    if (!libraryHydrated) {
      void hydrateLibrary();
    }

    const unsubscribeFavorites = subscribeToMusicProfileUpdates(
      'musicFavoritesUpdated',
      () => {
        void hydrateLibrary();
      }
    );
    const unsubscribeRecentTracks = subscribeToMusicProfileUpdates(
      'musicRecentTracksUpdated',
      () => {
        void hydrateLibrary();
      }
    );
    const unsubscribePlayRecords = subscribeToMusicProfileUpdates(
      'musicPlayRecordsUpdated',
      () => {
        void hydrateLibrary();
      }
    );
    const unsubscribeCollections = subscribeToMusicCollectionProfileUpdates(
      () => {
        void hydrateLibrary();
      }
    );

    return () => {
      unsubscribeFavorites();
      unsubscribeRecentTracks();
      unsubscribePlayRecords();
      unsubscribeCollections();
    };
  }, [hydrateLibrary, libraryHydrated]);

  const contentError =
    activeSection === 'library' || activeSection === 'settings'
      ? libraryError || error
      : error;
  const showCatalogLoading = loading && !homeView;
  const showLibraryLoading =
    (activeSection === 'library' || activeSection === 'settings') &&
    !libraryHydrated;
  const selectedCollectionSection = selectedCollection
    ? resolveMusicCollectionSection(selectedCollection.summary.kind)
    : null;
  const showCollectionView =
    Boolean(selectedCollection) && selectedCollectionSection === activeSection;
  const showSearchResults = activeSection === 'search';
  const showSettingsView = activeSection === 'settings';
  const showDiscoveryGrid =
    activeSection !== 'library' &&
    !showSettingsView &&
    !showSearchResults &&
    !showCollectionView;
  const showHero = activeSection === 'home';
  const isSelectedCollectionSaved = Boolean(
    selectedCollection &&
      savedCollectionKeys.includes(
        buildMusicCollectionProfileKey(
          selectedCollection.summary.source,
          selectedCollection.summary.id
        )
      )
  );

  useEffect(() => {
    if (!routeStateReady || typeof window === 'undefined') {
      return;
    }

    const nextPath = buildMusicUrlStatePath({
      activeSection,
      searchQuery: searchResult?.query || null,
      selectedCollection: selectedCollection?.summary || null,
    });
    const currentPath = `${window.location.pathname}${window.location.search}`;

    if (currentPath === nextPath) {
      return;
    }

    window.history.replaceState(
      {
        source: 'music-shell',
      },
      '',
      nextPath
    );
  }, [
    activeSection,
    routeStateReady,
    searchResult?.query,
    selectedCollection?.summary,
  ]);

  return (
    <div
      className={`grid min-h-[calc(100vh-220px)] gap-5 transition-[grid-template-columns] duration-300 ${
        sidebarCollapsed
          ? 'lg:grid-cols-[104px_minmax(0,1fr)]'
          : 'lg:grid-cols-[260px_minmax(0,1fr)]'
      }`}
    >
      <MusicSidebar />
      <section
        className={`space-y-6 rounded-[34px] border border-white/10 p-6 text-white shadow-[0_40px_120px_rgba(0,0,0,0.28)] ${
          themeVariant === 'sunset'
            ? 'bg-[linear-gradient(180deg,rgba(48,19,27,0.96),rgba(110,46,58,0.92))]'
            : 'bg-[linear-gradient(180deg,rgba(8,11,20,0.96),rgba(5,8,16,0.92))]'
        }`}
      >
        <MusicTopBar />
        {showHero ? <MusicHero /> : null}
        {contentError ? (
          <div
            role='alert'
            className='rounded-[24px] border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100'
          >
            {contentError}
          </div>
        ) : null}
        {showCatalogLoading ? (
          <div className='rounded-[24px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/65'>
            Syncing live Netease music...
          </div>
        ) : null}
        {showLibraryLoading ? (
          <div className='rounded-[24px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/65'>
            Hydrating local music library...
          </div>
        ) : null}
        {activeSection === 'library' ? (
          <MusicLibraryView
            savedCollections={savedCollections}
            favoriteTracks={favoriteTracks}
            recentTracks={recentTracks}
            resumeTracks={resumeTracks}
            onOpenCollection={(record) => {
              setActiveSection(
                resolveMusicCollectionSection(record.summary.kind)
              );
              void openCollection(record.summary.id, record.summary.kind);
            }}
            onPlayTrack={(id, context) => {
              void playTrack(id, context);
            }}
          />
        ) : showSettingsView ? (
          <MusicSettingsView />
        ) : (
          <>
            {showDiscoveryGrid ? (
              <MusicDiscoveryGrid
                activeSection={activeSection}
                homeView={homeView}
                onOpenCollection={(collection) => {
                  clearSelectedCollection();
                  setActiveSection(
                    resolveMusicCollectionSection(collection.kind)
                  );
                  void openCollection(collection.id, collection.kind);
                }}
                onPlayTrack={(id) => {
                  void playTrack(id, 'discovery');
                }}
              />
            ) : null}
            {showCollectionView ? (
              <MusicCollectionView
                collection={selectedCollection}
                onOpenCollection={(collection) => {
                  setActiveSection(
                    resolveMusicCollectionSection(collection.kind)
                  );
                  void openCollection(collection.id, collection.kind);
                }}
                saved={isSelectedCollectionSaved}
                onToggleSavedCollection={(summary) => {
                  void toggleSavedCollection(summary);
                }}
                onPlayTrack={(id, context) => {
                  void playTrack(id, context);
                }}
              />
            ) : null}
            {showSearchResults ? (
              <MusicSearchResults
                searchResult={searchResult}
                onOpenCollection={(collection) => {
                  clearSelectedCollection();
                  setActiveSection(
                    resolveMusicCollectionSection(collection.kind)
                  );
                  void openCollection(collection.id, collection.kind);
                }}
                onPlayTrack={(id, context) => {
                  void playTrack(id, context);
                }}
              />
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
