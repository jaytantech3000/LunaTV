/* eslint-disable @next/next/no-img-element */

'use client';

import {
  ArrowRight,
  Disc3,
  ListPlus,
  Loader2,
  Play,
  Search,
  Sparkles,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, startTransition, useEffect, useState } from 'react';

import { cn } from '@/lib/cn';
import { formatDurationSeconds } from '@/lib/music/format';
import {
  type MusicPlayRecord,
  buildMusicTrackFromQueueItem,
  getAllMusicPlayRecords,
  getMusicFavoritesList,
  getMusicRecentTracks,
  subscribeToMusicProfileUpdates,
} from '@/lib/music/profile';
import {
  type MusicCollection,
  type MusicCollectionSummary,
  type MusicHomePayload,
  type MusicHomeSection,
  type MusicSectionTab,
  type MusicSource,
  type MusicTrack,
  buildQueueItemFromTrack,
} from '@/lib/music/types';
import {
  fetchMusicCollection,
  fetchMusicHome,
  fetchMusicSources,
  searchMusic,
} from '@/lib/transport/music-client';

import {
  getCurrentQueueTrack,
  getCurrentTrackKey,
  useMusicPlayerStore,
} from '@/stores/musicPlayerStore';

import MusicCollectionGrid from './MusicCollectionGrid';
import MusicSectionTabs from './MusicSectionTabs';
import MusicSourceTabs from './MusicSourceTabs';
import MusicTrackList from './MusicTrackList';

const COLLECTION_TABS = new Set<MusicSectionTab>(['rank', 'playlist', 'album']);

function isCollectionTab(tab: MusicSectionTab) {
  return COLLECTION_TABS.has(tab);
}

function resolveCollectionTab(
  collection: MusicCollectionSummary
): MusicSectionTab {
  if (collection.kind === 'rank' || collection.kind === 'artist-toplist') {
    return 'rank';
  }

  if (collection.kind === 'album') {
    return 'album';
  }

  return 'playlist';
}

function MusicEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className='flex min-h-[260px] flex-col items-center justify-center rounded-[32px] border border-white/70 bg-white/80 px-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900/80'>
      <Disc3 className='h-14 w-14 text-slate-300 dark:text-slate-600' />
      <div className='mt-5 text-xl font-semibold text-slate-950 dark:text-white'>
        {title}
      </div>
      <p className='mt-2 max-w-lg text-sm leading-6 text-slate-500 dark:text-slate-400'>
        {description}
      </p>
    </div>
  );
}

function MusicSectionSkeleton() {
  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <div className='h-6 w-36 rounded-full bg-slate-200/80 dark:bg-slate-800' />
        <div className='h-4 w-72 rounded-full bg-slate-200/70 dark:bg-slate-800/80' />
      </div>
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className='h-[260px] rounded-[28px] border border-white/70 bg-white/70 shadow-sm dark:border-slate-800 dark:bg-slate-900/70'
          />
        ))}
      </div>
    </div>
  );
}

function withLocalLibraryTab(source: MusicSource): MusicSource {
  if (source.tabs.includes('library')) {
    return source;
  }

  const searchIndex = source.tabs.indexOf('search');
  const nextTabs: MusicSectionTab[] =
    searchIndex >= 0
      ? [
          ...source.tabs.slice(0, searchIndex),
          'library',
          ...source.tabs.slice(searchIndex),
        ]
      : [...source.tabs, 'library'];

  return {
    ...source,
    tabs: nextTabs,
  };
}

function buildResumeTrackFromPlayRecord(record: MusicPlayRecord): MusicTrack {
  const durationSec =
    record.durationSec > 0
      ? record.durationSec
      : Math.max((record.durationMs || 0) / 1000, 0);
  const resumeLabel = `续播至 ${formatDurationSeconds(
    record.playTimeSec
  )} / ${formatDurationSeconds(durationSec)}`;

  return {
    ...buildMusicTrackFromQueueItem(record),
    subtitle: resumeLabel,
  };
}

function getMusicTrackKey(track: Pick<MusicTrack, 'source' | 'id'>): string {
  return `${track.source}:${track.id}`;
}

export default function MusicPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchString = searchParams.toString();
  const queryParams = new URLSearchParams(searchString);

  const [sources, setSources] = useState<MusicSource[]>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [homePayload, setHomePayload] = useState<MusicHomePayload | null>(null);
  const [homeLoading, setHomeLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<{
    tracks: MusicTrack[];
    collections: MusicCollectionSummary[];
  } | null>(null);
  const [selectedCollection, setSelectedCollection] =
    useState<MusicCollection | null>(null);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [resumeLibraryTracks, setResumeLibraryTracks] = useState<MusicTrack[]>(
    []
  );
  const [favoriteLibraryTracks, setFavoriteLibraryTracks] = useState<
    MusicTrack[]
  >([]);
  const [recentLibraryTracks, setRecentLibraryTracks] = useState<MusicTrack[]>(
    []
  );
  const [libraryLoading, setLibraryLoading] = useState(true);

  const activeQueueTrackKey = useMusicPlayerStore((state) =>
    getCurrentTrackKey(getCurrentQueueTrack(state))
  );
  const playQueue = useMusicPlayerStore((state) => state.playQueue);
  const enqueueTracks = useMusicPlayerStore((state) => state.enqueueTracks);

  const activeSourceModel =
    sources.find((source) => source.key === queryParams.get('source')) ||
    sources[0] ||
    null;
  const activeSource = activeSourceModel?.key || null;
  const requestedTab = queryParams.get('tab') as MusicSectionTab | null;
  const activeTab = activeSourceModel?.tabs.includes(
    requestedTab as MusicSectionTab
  )
    ? (requestedTab as MusicSectionTab)
    : activeSourceModel?.tabs[0] || 'home';
  const activeCollectionId = queryParams.get('id') || '';
  const activeQuery = (queryParams.get('q') || '').trim();

  useEffect(() => {
    let cancelled = false;

    setSourcesLoading(true);
    setSourceError(null);

    const loadSources = async () => {
      try {
        const nextSources = (await fetchMusicSources())
          .filter((source) => source.enabled)
          .map(withLocalLibraryTab);
        if (cancelled) {
          return;
        }

        setSources(nextSources);
        setSourcesLoading(false);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setSourcesLoading(false);
        setSourceError(
          error instanceof Error ? error.message : '获取音乐源失败'
        );
      }
    };

    void loadSources();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncLibrary = async () => {
      setLibraryLoading(true);

      const [favorites, recentTracks, playRecords] = await Promise.all([
        getMusicFavoritesList(),
        getMusicRecentTracks(),
        getAllMusicPlayRecords(),
      ]);

      if (cancelled) {
        return;
      }

      setResumeLibraryTracks(
        Object.values(playRecords)
          .filter((record) => !record.completed && record.playTimeSec > 0)
          .sort((left, right) => right.playedAt - left.playedAt)
          .map(buildResumeTrackFromPlayRecord)
      );
      setFavoriteLibraryTracks(favorites.map(buildMusicTrackFromQueueItem));
      setRecentLibraryTracks(recentTracks.map(buildMusicTrackFromQueueItem));
      setLibraryLoading(false);
    };

    void syncLibrary();

    const unsubscribeFavorites = subscribeToMusicProfileUpdates(
      'musicFavoritesUpdated',
      () => {
        void syncLibrary();
      }
    );
    const unsubscribeRecentTracks = subscribeToMusicProfileUpdates(
      'musicRecentTracksUpdated',
      () => {
        void syncLibrary();
      }
    );
    const unsubscribePlayRecords = subscribeToMusicProfileUpdates(
      'musicPlayRecordsUpdated',
      () => {
        void syncLibrary();
      }
    );

    return () => {
      cancelled = true;
      unsubscribeFavorites();
      unsubscribeRecentTracks();
      unsubscribePlayRecords();
    };
  }, []);

  useEffect(() => {
    setSearchInput(activeQuery);
  }, [activeQuery]);

  useEffect(() => {
    if (!sources.length || !activeSourceModel) {
      return;
    }

    const params = new URLSearchParams(searchString);
    let dirty = false;

    if (params.get('source') !== activeSourceModel.key) {
      params.set('source', activeSourceModel.key);
      dirty = true;
    }

    if (params.get('tab') !== activeTab) {
      params.set('tab', activeTab);
      dirty = true;
    }

    if (activeTab !== 'search' && params.has('q')) {
      params.delete('q');
      dirty = true;
    }

    if (!isCollectionTab(activeTab) && params.has('id')) {
      params.delete('id');
      dirty = true;
    }

    const normalizedQuery = (params.get('q') || '').trim();
    if (activeTab === 'search' && params.get('q') !== normalizedQuery) {
      if (normalizedQuery) {
        params.set('q', normalizedQuery);
      } else {
        params.delete('q');
      }
      dirty = true;
    }

    if (!dirty) {
      return;
    }

    const nextQueryString = params.toString();
    startTransition(() => {
      router.replace(
        nextQueryString ? `${pathname}?${nextQueryString}` : pathname,
        {
          scroll: false,
        }
      );
    });
  }, [
    activeSourceModel,
    activeTab,
    pathname,
    router,
    searchString,
    sources.length,
  ]);

  useEffect(() => {
    if (!activeSource) {
      return;
    }

    let cancelled = false;

    setHomeLoading(true);
    setContentError(null);
    setHomePayload(null);

    const loadHome = async () => {
      try {
        const nextHomePayload = await fetchMusicHome(activeSource);
        if (cancelled) {
          return;
        }

        setHomePayload(nextHomePayload);
        setHomeLoading(false);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setHomeLoading(false);
        setContentError(
          error instanceof Error ? error.message : '获取音乐内容失败'
        );
      }
    };

    void loadHome();

    return () => {
      cancelled = true;
    };
  }, [activeSource]);

  useEffect(() => {
    if (!activeSource || activeTab !== 'search') {
      setSearchLoading(false);
      setSearchResult(null);
      return;
    }

    if (!activeQuery) {
      setSearchLoading(false);
      setSearchResult(null);
      return;
    }

    let cancelled = false;

    setSearchLoading(true);
    setContentError(null);

    const runSearch = async () => {
      try {
        const result = await searchMusic({
          source: activeSource,
          query: activeQuery,
        });

        if (cancelled) {
          return;
        }

        setSearchResult({
          tracks: result.tracks,
          collections: result.collections,
        });
        setSearchLoading(false);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setSearchLoading(false);
        setContentError(
          error instanceof Error ? error.message : '搜索音乐失败'
        );
      }
    };

    void runSearch();

    return () => {
      cancelled = true;
    };
  }, [activeQuery, activeSource, activeTab]);

  useEffect(() => {
    if (!activeSource || !activeCollectionId || !isCollectionTab(activeTab)) {
      setCollectionLoading(false);
      setSelectedCollection(null);
      return;
    }

    let cancelled = false;

    setCollectionLoading(true);
    setContentError(null);

    const loadCollection = async () => {
      try {
        const collection = await fetchMusicCollection({
          source: activeSource,
          id: activeCollectionId,
        });

        if (cancelled) {
          return;
        }

        setSelectedCollection(collection);
        setCollectionLoading(false);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setSelectedCollection(null);
        setCollectionLoading(false);
        setContentError(
          error instanceof Error ? error.message : '获取歌单详情失败'
        );
      }
    };

    void loadCollection();

    return () => {
      cancelled = true;
    };
  }, [activeCollectionId, activeSource, activeTab]);

  const updateUrl = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchString);
    mutate(params);
    const nextQueryString = params.toString();

    if (nextQueryString === searchString) {
      return;
    }

    startTransition(() => {
      router.replace(
        nextQueryString ? `${pathname}?${nextQueryString}` : pathname,
        {
          scroll: false,
        }
      );
    });
  };

  const handleSourceChange = (sourceKey: MusicSource['key']) => {
    const nextSource = sources.find((source) => source.key === sourceKey);
    if (!nextSource) {
      return;
    }

    updateUrl((params) => {
      const nextTab = nextSource.tabs.includes(activeTab)
        ? activeTab
        : nextSource.tabs[0];

      params.set('source', sourceKey);
      params.set('tab', nextTab);
      params.delete('id');

      if (nextTab !== 'search') {
        params.delete('q');
      }
    });
  };

  const handleTabChange = (tab: MusicSectionTab) => {
    updateUrl((params) => {
      params.set('tab', tab);
      params.delete('id');
      if (tab !== 'search') {
        params.delete('q');
      }
    });
  };

  const handleSelectCollection = (collection: MusicCollectionSummary) => {
    updateUrl((params) => {
      params.set('source', collection.source);
      params.set('tab', resolveCollectionTab(collection));
      params.set('id', collection.id);
      params.delete('q');
    });
  };

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    updateUrl((params) => {
      params.set('tab', 'search');
      params.delete('id');

      const nextQuery = searchInput.trim();
      if (nextQuery) {
        params.set('q', nextQuery);
      } else {
        params.delete('q');
      }
    });
  };

  const handlePlayTracks = (tracks: MusicTrack[], startIndex = 0) => {
    const targetTrack = tracks[startIndex];
    if (!targetTrack?.playable) {
      return;
    }

    const playableTracks = tracks.filter((track) => track.playable);
    const playableStartIndex = playableTracks.findIndex(
      (track) => getMusicTrackKey(track) === getMusicTrackKey(targetTrack)
    );

    if (!playableTracks.length || playableStartIndex < 0) {
      return;
    }

    playQueue(playableTracks.map(buildQueueItemFromTrack), playableStartIndex);
  };

  const handleQueueTrack = (track: MusicTrack) => {
    if (!track.playable) {
      return;
    }

    enqueueTracks([buildQueueItemFromTrack(track)]);
  };

  const visibleSections = homePayload
    ? activeTab === 'home'
      ? homePayload.sections
      : homePayload.sections.filter((section) => section.tab === activeTab)
    : [];

  const renderHomeSection = (section: MusicHomeSection) => {
    if (section.kind === 'collection-list') {
      return (
        <MusicCollectionGrid
          key={section.id}
          title={section.title}
          description={section.description}
          collections={section.collections || []}
          activeCollectionId={activeCollectionId || undefined}
          onSelect={handleSelectCollection}
        />
      );
    }

    return (
      <MusicTrackList
        key={section.id}
        title={section.title}
        description={section.description}
        tracks={section.tracks || []}
        activeTrackKey={activeQueueTrackKey}
        onPlayTrack={handlePlayTracks}
        onQueueTrack={handleQueueTrack}
      />
    );
  };

  return (
    <div className='px-4 py-4 sm:px-6 lg:px-8'>
      <div className='mx-auto max-w-7xl space-y-6 pb-8'>
        <section className='overflow-hidden rounded-[36px] border border-white/70 bg-white/80 shadow-xl shadow-slate-950/5 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/75 dark:shadow-black/20'>
          <div className='grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-6'>
            <div className='space-y-5'>
              <div className='inline-flex items-center gap-2 rounded-full bg-emerald-500/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700 dark:text-emerald-300'>
                <Sparkles className='h-3.5 w-3.5' />
                Music MVP
              </div>

              <div className='space-y-3'>
                <h1 className='text-3xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-4xl'>
                  音乐
                </h1>
                <p className='max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300'>
                  统一 music client
                  已接通平台切换、榜单、热门、歌单、搜索和全局播放器；当前 Web
                  与桌面本地模式都已接入网易云真实数据，更多平台与离线能力会在后续阶段补齐。
                </p>
                {activeSourceModel?.description ? (
                  <div className='text-sm text-slate-500 dark:text-slate-400'>
                    当前平台：{activeSourceModel.name} ·{' '}
                    {activeSourceModel.description}
                  </div>
                ) : null}
              </div>

              {sourcesLoading && sources.length === 0 ? (
                <div className='h-14 rounded-[24px] bg-slate-100 dark:bg-slate-800' />
              ) : (
                <MusicSourceTabs
                  sources={sources}
                  activeSource={activeSource}
                  onChange={handleSourceChange}
                />
              )}

              {activeSourceModel ? (
                <MusicSectionTabs
                  tabs={activeSourceModel.tabs}
                  activeTab={activeTab}
                  onChange={handleTabChange}
                />
              ) : null}

              <form
                onSubmit={handleSearchSubmit}
                className='flex flex-col gap-3 rounded-[28px] border border-slate-200 bg-slate-50/85 p-4 dark:border-slate-800 dark:bg-slate-900/80 sm:flex-row'
              >
                <label className='relative flex-1'>
                  <Search className='pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400' />
                  <input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder='搜索歌曲、歌单或专辑'
                    className='h-12 w-full rounded-full border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white'
                  />
                </label>
                <button
                  type='submit'
                  className='inline-flex h-12 items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-medium text-white transition-colors hover:bg-emerald-600 dark:bg-white dark:text-slate-950 dark:hover:bg-emerald-300'
                >
                  搜索
                  <ArrowRight className='h-4 w-4' />
                </button>
              </form>
            </div>

            <div className='grid gap-3'>
              {homeLoading && !homePayload ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className='h-[108px] rounded-[28px] border border-white/70 bg-slate-100/80 dark:border-slate-800 dark:bg-slate-900/80'
                  />
                ))
              ) : homePayload?.spotlight?.length ? (
                homePayload.spotlight.slice(0, 3).map((track, index) => (
                  <button
                    key={`${track.source}:${track.id}`}
                    type='button'
                    disabled={!track.playable}
                    onClick={() =>
                      handlePlayTracks(homePayload.spotlight, index)
                    }
                    className={cn(
                      'group flex items-center gap-4 rounded-[28px] border border-white/75 bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-900/90 p-4 text-left text-white shadow-lg shadow-slate-950/10 transition-transform dark:border-slate-700',
                      track.playable
                        ? 'hover:-translate-y-0.5'
                        : 'cursor-not-allowed opacity-60'
                    )}
                  >
                    <div className='relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white/10'>
                      {track.cover ? (
                        <img
                          src={track.cover}
                          alt={track.title}
                          className='h-full w-full object-cover'
                        />
                      ) : null}
                    </div>
                    <div className='min-w-0 flex-1'>
                      <div className='text-[11px] uppercase tracking-[0.24em] text-emerald-200/70'>
                        Spotlight
                      </div>
                      <div className='mt-2 truncate text-base font-semibold'>
                        {track.title}
                      </div>
                      <div className='mt-1 truncate text-sm text-white/65'>
                        {track.artists.map((artist) => artist.name).join(' / ')}
                      </div>
                      {track.subtitle ? (
                        <div className='mt-1 truncate text-[11px] uppercase tracking-[0.16em] text-white/45'>
                          {track.subtitle}
                        </div>
                      ) : null}
                      {!track.playable ? (
                        <div className='mt-2 inline-flex rounded-full bg-white/14 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-white/80'>
                          暂不可播
                        </div>
                      ) : null}
                    </div>
                    <div
                      className={cn(
                        'flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-950 transition-transform',
                        track.playable ? 'group-hover:scale-105' : ''
                      )}
                    >
                      <Play className='h-4 w-4 fill-current' />
                    </div>
                  </button>
                ))
              ) : (
                <MusicEmptyState
                  title='等待音乐数据'
                  description='平台内容加载后，这里会展示当前来源最值得直接开听的曲目。'
                />
              )}
            </div>
          </div>
        </section>

        {sourceError ? (
          <MusicEmptyState
            title='音乐源加载失败'
            description={`${sourceError}。请稍后刷新页面重试。`}
          />
        ) : null}

        {contentError ? (
          <div className='rounded-[28px] border border-rose-200 bg-rose-50/85 px-5 py-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100'>
            {contentError}
          </div>
        ) : null}

        {!sourceError && (homeLoading || sourcesLoading) && !homePayload ? (
          <MusicSectionSkeleton />
        ) : null}

        {activeTab === 'library' ? (
          libraryLoading ? (
            <MusicSectionSkeleton />
          ) : resumeLibraryTracks.length ||
            favoriteLibraryTracks.length ||
            recentLibraryTracks.length ? (
            <div className='space-y-6'>
              {resumeLibraryTracks.length ? (
                <MusicTrackList
                  title='继续收听'
                  description='根据最近一次保存的播放进度，优先回到上次还没听完的曲目。'
                  tracks={resumeLibraryTracks}
                  activeTrackKey={activeQueueTrackKey}
                  onPlayTrack={handlePlayTracks}
                  onQueueTrack={handleQueueTrack}
                />
              ) : null}
              {recentLibraryTracks.length ? (
                <MusicTrackList
                  title='最近播放'
                  description='这里会保留最近实际开听过的曲目，方便快速续播。'
                  tracks={recentLibraryTracks}
                  activeTrackKey={activeQueueTrackKey}
                  onPlayTrack={handlePlayTracks}
                  onQueueTrack={handleQueueTrack}
                />
              ) : null}
              {favoriteLibraryTracks.length ? (
                <MusicTrackList
                  title='我的收藏'
                  description='独立于具体平台页面的本地收藏列表，后续可平滑切到统一 profile 真源。'
                  tracks={favoriteLibraryTracks}
                  activeTrackKey={activeQueueTrackKey}
                  onPlayTrack={handlePlayTracks}
                  onQueueTrack={handleQueueTrack}
                />
              ) : null}
            </div>
          ) : (
            <MusicEmptyState
              title='你的音乐资料库还是空的'
              description='开始播放、暂停或收藏曲目后，这里会逐步沉淀续播记录、最近播放与本地收藏。'
            />
          )
        ) : null}

        {activeTab === 'search' ? (
          searchLoading ? (
            <div className='flex min-h-[240px] items-center justify-center rounded-[32px] border border-white/70 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80'>
              <div className='inline-flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300'>
                <Loader2 className='h-4 w-4 animate-spin' />
                正在搜索 {activeSourceModel?.name || '音乐平台'}...
              </div>
            </div>
          ) : activeQuery ? (
            <div className='space-y-6'>
              {searchResult?.collections?.length ? (
                <MusicCollectionGrid
                  title={`“${activeQuery}” 的相关合集`}
                  description='先选歌单或榜单，再决定是否整组播放。'
                  collections={searchResult.collections}
                  activeCollectionId={activeCollectionId || undefined}
                  onSelect={handleSelectCollection}
                />
              ) : null}
              {searchResult?.tracks?.length ? (
                <MusicTrackList
                  title={`“${activeQuery}” 的相关曲目`}
                  description='可以直接播放，也可以加入当前队列的下一首。'
                  tracks={searchResult.tracks}
                  activeTrackKey={activeQueueTrackKey}
                  onPlayTrack={handlePlayTracks}
                  onQueueTrack={handleQueueTrack}
                />
              ) : null}
              {!searchResult?.tracks?.length &&
              !searchResult?.collections?.length ? (
                <MusicEmptyState
                  title='没有找到匹配内容'
                  description='可以换一个关键词，或者切回榜单 / 热门先浏览当前平台的数据。'
                />
              ) : null}
            </div>
          ) : (
            <MusicEmptyState
              title='输入关键词开始搜索'
              description='当前首批版本支持按平台搜索曲目和合集，搜索结果仍然统一进入全局播放器。'
            />
          )
        ) : null}

        {activeTab !== 'search' &&
        activeTab !== 'library' &&
        visibleSections.length > 0 ? (
          <div className='space-y-6'>
            {visibleSections.map(renderHomeSection)}
          </div>
        ) : null}

        {activeTab !== 'search' &&
        isCollectionTab(activeTab) &&
        collectionLoading ? (
          <MusicSectionSkeleton />
        ) : null}

        {activeTab !== 'search' &&
        isCollectionTab(activeTab) &&
        selectedCollection ? (
          <div className='space-y-6'>
            <section className='overflow-hidden rounded-[32px] border border-white/70 bg-white/85 shadow-sm dark:border-slate-800 dark:bg-slate-900/80'>
              <div className='grid gap-6 p-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:p-6'>
                <div className='overflow-hidden rounded-[28px] bg-slate-100 dark:bg-slate-800'>
                  {selectedCollection.cover ? (
                    <img
                      src={selectedCollection.cover}
                      alt={selectedCollection.title}
                      className='aspect-square w-full object-cover'
                    />
                  ) : (
                    <div className='flex aspect-square items-center justify-center'>
                      <Disc3 className='h-8 w-8 text-slate-400' />
                    </div>
                  )}
                </div>

                <div className='space-y-4'>
                  <div>
                    <div className='text-xs uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500'>
                      {selectedCollection.kind}
                    </div>
                    <h2 className='mt-2 text-2xl font-semibold text-slate-950 dark:text-white'>
                      {selectedCollection.title}
                    </h2>
                    <div className='mt-3 text-sm text-slate-500 dark:text-slate-400'>
                      {selectedCollection.curator || activeSourceModel?.name}
                      {selectedCollection.updatedAtLabel
                        ? ` · ${selectedCollection.updatedAtLabel}`
                        : ''}
                      {selectedCollection.trackCount
                        ? ` · ${selectedCollection.trackCount} 首`
                        : ''}
                    </div>
                    {selectedCollection.description ? (
                      <p className='mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300'>
                        {selectedCollection.description}
                      </p>
                    ) : null}
                  </div>

                  <div className='flex flex-wrap items-center gap-3'>
                    <button
                      type='button'
                      onClick={() =>
                        handlePlayTracks(selectedCollection.tracks, 0)
                      }
                      className='inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-600 dark:bg-white dark:text-slate-950 dark:hover:bg-emerald-300'
                    >
                      <Play className='h-4 w-4 fill-current' />
                      整组播放
                    </button>
                    <button
                      type='button'
                      onClick={() =>
                        enqueueTracks(
                          selectedCollection.tracks.map(buildQueueItemFromTrack)
                        )
                      }
                      className='inline-flex items-center gap-2 rounded-full border border-slate-200 px-5 py-3 text-sm font-medium text-slate-700 transition-colors hover:border-emerald-400 hover:text-emerald-700 dark:border-slate-700 dark:text-slate-200 dark:hover:border-emerald-400 dark:hover:text-emerald-300'
                    >
                      <ListPlus className='h-4 w-4' />
                      加入队列
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <MusicTrackList
              title='曲目列表'
              description='当前集合中的试听曲目，支持整组播放和逐首加入队列。'
              tracks={selectedCollection.tracks}
              activeTrackKey={activeQueueTrackKey}
              onPlayTrack={handlePlayTracks}
              onQueueTrack={handleQueueTrack}
            />
          </div>
        ) : null}

        {activeTab !== 'search' &&
        isCollectionTab(activeTab) &&
        !collectionLoading &&
        !selectedCollection &&
        !contentError ? (
          <MusicEmptyState
            title='选择一张榜单或歌单'
            description='首批版本会先展示列表和详情页结构；点开任意合集后即可进入统一播放器。'
          />
        ) : null}

        {activeTab !== 'search' &&
        activeTab !== 'library' &&
        !visibleSections.length &&
        !homeLoading &&
        !contentError &&
        (!isCollectionTab(activeTab) || Boolean(selectedCollection)) ? (
          <MusicEmptyState
            title='当前分区暂时没有内容'
            description='这一分区的正式平台接入可以等后续 provider 和桌面本地服务准备好后继续补齐。'
          />
        ) : null}
      </div>
    </div>
  );
}
