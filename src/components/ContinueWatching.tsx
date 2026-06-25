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

  // 处理播放记录数据更新的函数
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

        // 从缓存或API获取所有播放记录
        const allRecords = await getAllPlayRecords();
        updatePlayRecords(allRecords);
      } catch (error) {
        console.error('获取播放记录失败:', error);
        setPlayRecords([]);
      } finally {
        setLoading(false);
      }
    };

    fetchPlayRecords();

    // 监听播放记录更新事件
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

  // 如果没有播放记录，则不渲染组件
  if (!loading && visiblePlayRecords.length === 0) {
    return null;
  }

  // 计算播放进度百分比
  const getProgress = (record: PlayRecord) => {
    if (record.total_time === 0) return 0;
    return (record.play_time / record.total_time) * 100;
  };

  // 从 key 中解析 source 和 id
  const parseKey = (key: string) => {
    const [source, id] = key.split('+');
    return { source, id };
  };

  return (
    <section className={`mb-8 ${className || ''}`}>
      <div className='mb-4 flex items-center justify-between'>
        <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
          继续观看
        </h2>
        {!loading && visiblePlayRecords.length > 0 && (
          <button
            className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            onClick={async () => {
              await clearAllPlayRecords();
              setPlayRecords([]);
            }}
          >
            清空
          </button>
        )}
      </div>
      <ScrollableRow>
        {loading
          ? // 加载状态显示灰色占位数据
            Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
              >
                <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                  <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                </div>
                <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                <div className='mt-1 h-3 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
              </div>
            ))
          : // 显示真实数据
            visiblePlayRecords.map((record) => {
              const { source, id } = parseKey(record.key);
              return (
                <div
                  key={record.key}
                  className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                >
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
                        prev.filter((r) => r.key !== record.key)
                      )
                    }
                    type={record.total_episodes > 1 ? 'tv' : ''}
                  />
                </div>
              );
            })}
      </ScrollableRow>
    </section>
  );
}
