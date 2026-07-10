/* eslint-disable no-console */
'use client';

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';

import { isAdultDownloadedContent } from '@/lib/download/offline';
import type { PlayRecord } from '@/lib/profile/client';
import {
  clearAllPlayRecords,
  getAllPlayRecords,
  getCachedPlayRecordsSnapshot,
  subscribeToDataUpdates,
} from '@/lib/profile/client';
import { isAdultLibraryEntry } from '@/lib/yellow';

import ScrollableRow from '@/components/ScrollableRow';
import { useSite } from '@/components/SiteProvider';
import VideoCard from '@/components/VideoCard';

import { useDownloadStore } from '@/stores/downloadStore';

interface ContinueWatchingProps {
  className?: string;
}

function mapPlayRecords(
  allRecords: Record<string, PlayRecord>
): (PlayRecord & { key: string })[] {
  return Object.entries(allRecords)
    .map(([key, record]) => ({
      ...record,
      key,
    }))
    .sort((a, b) => b.save_time - a.save_time);
}

export default function ContinueWatching({ className }: ContinueWatchingProps) {
  const { adultContentFilterEnabled } = useSite();
  const library = useDownloadStore((state) => state.library);
  const [playRecords, setPlayRecords] = useState<
    (PlayRecord & { key: string })[]
  >([]);
  const [loading, setLoading] = useState(true);

  useLayoutEffect(() => {
    const snapshot = getCachedPlayRecordsSnapshot();
    if (snapshot === null) {
      return;
    }

    setPlayRecords(mapPlayRecords(snapshot));
    setLoading(false);
  }, []);

  const updatePlayRecords = (allRecords: Record<string, PlayRecord>) => {
    setPlayRecords(mapPlayRecords(allRecords));
  };

  useEffect(() => {
    const fetchPlayRecords = async () => {
      try {
        const snapshot = getCachedPlayRecordsSnapshot();
        if (snapshot === null) {
          setLoading(true);
        }

        const allRecords = await getAllPlayRecords();
        updatePlayRecords(allRecords);
      } catch (error) {
        console.error('获取播放记录失败:', error);
        setPlayRecords([]);
      } finally {
        setLoading(false);
      }
    };

    void fetchPlayRecords();

    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        updatePlayRecords(newRecords);
      }
    );

    return unsubscribe;
  }, []);

  const visiblePlayRecords = useMemo(
    () =>
      adultContentFilterEnabled
        ? playRecords.filter((record) => {
            const offlineContent = record.offline_content_id
              ? library[record.offline_content_id]
              : undefined;
            if (offlineContent) {
              return !isAdultDownloadedContent(offlineContent);
            }

            return !isAdultLibraryEntry(record);
          })
        : playRecords,
    [adultContentFilterEnabled, library, playRecords]
  );

  if (!loading && visiblePlayRecords.length === 0) {
    return null;
  }

  const getProgress = (record: PlayRecord) => {
    if (record.total_time === 0) {
      return 0;
    }

    return (record.play_time / record.total_time) * 100;
  };

  const parseKey = (key: string) => {
    const [source, id] = key.split('+');
    return { source, id };
  };
  const cardContainerClassName =
    'w-[6.85rem] min-w-[6.85rem] sm:w-[11.2rem] sm:min-w-[11.2rem]';

  return (
    <section className={`mb-10 ${className || ''}`}>
      <div className='mb-5 flex items-center justify-between'>
        <h2 className='luna-section-title'>继续观看</h2>
        {!loading && visiblePlayRecords.length > 0 ? (
          <button
            className='luna-section-action'
            onClick={async () => {
              await clearAllPlayRecords();
              setPlayRecords([]);
            }}
          >
            清空
          </button>
        ) : null}
      </div>
      <ScrollableRow contentClassName='flex overflow-x-auto px-[0.08rem] py-1 pb-7 scrollbar-hide gap-[0.9rem] sm:gap-[1.08rem] sm:pb-8'>
        {loading
          ? Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={cardContainerClassName}>
                <div className='luna-skeleton-card relative aspect-[2/3] w-full animate-pulse'>
                  <div className='absolute inset-0 bg-white/10 dark:bg-white/5' />
                </div>
                <div className='luna-skeleton-line mt-3 h-4 animate-pulse' />
                <div className='luna-skeleton-line mt-2 h-3 w-3/4 animate-pulse' />
              </div>
            ))
          : visiblePlayRecords.map((record) => {
              const { source, id } = parseKey(record.key);

              return (
                <div key={record.key} className={cardContainerClassName}>
                  <VideoCard
                    id={id}
                    title={record.title}
                    poster={record.cover}
                    year={record.year}
                    source={source}
                    source_name={record.source_name}
                    progress={getProgress(record)}
                    episodes={record.total_episodes}
                    currentEpisode={record.index}
                    query={record.search_title}
                    playbackMode={record.playback_mode}
                    offlineContentId={record.offline_content_id}
                    from='playrecord'
                    onDelete={() =>
                      setPlayRecords((prev) =>
                        prev.filter((item) => item.key !== record.key)
                      )
                    }
                    type={record.total_episodes > 1 ? 'tv' : 'movie'}
                  />
                </div>
              );
            })}
      </ScrollableRow>
    </section>
  );
}
