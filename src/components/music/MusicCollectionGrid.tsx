/* eslint-disable @next/next/no-img-element */

'use client';

import { Disc3, Play } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { MusicCollectionSummary } from '@/lib/music/types';

interface MusicCollectionGridProps {
  title: string;
  description?: string;
  collections: MusicCollectionSummary[];
  activeCollectionId?: string | null;
  onSelect: (collection: MusicCollectionSummary) => void;
  onPlayCollection?: (collection: MusicCollectionSummary) => void;
}

export default function MusicCollectionGrid({
  title,
  description,
  collections,
  activeCollectionId,
  onSelect,
  onPlayCollection,
}: MusicCollectionGridProps) {
  return (
    <section className='space-y-4'>
      <div className='flex items-end justify-between gap-3'>
        <div className='space-y-1'>
          <h2 className='text-xl font-semibold text-slate-950 dark:text-white'>
            {title}
          </h2>
          {description ? (
            <p className='text-sm text-slate-500 dark:text-slate-400'>
              {description}
            </p>
          ) : null}
        </div>
        <div className='text-xs uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500'>
          共 {collections.length} 项
        </div>
      </div>

      <div className='grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'>
        {collections.map((collection) => {
          const active = activeCollectionId === collection.id;
          return (
            <article
              key={collection.id}
              className={cn(
                'group relative overflow-hidden rounded-[24px] text-left transition-all duration-200',
                active
                  ? 'bg-slate-50 shadow-[0_16px_40px_rgba(16,185,129,0.08)] ring-1 ring-emerald-400/55 dark:bg-slate-900 dark:ring-emerald-400/40'
                  : 'bg-transparent hover:-translate-y-0.5 dark:hover:bg-slate-900/30'
              )}
            >
              <button
                type='button'
                onClick={() => onSelect(collection)}
                className='block w-full text-left'
              >
                <div className='relative aspect-square overflow-hidden rounded-[24px] bg-slate-200 shadow-sm dark:bg-slate-800'>
                  {collection.cover ? (
                    <img
                      src={collection.cover}
                      alt={collection.title}
                      className='h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]'
                    />
                  ) : (
                    <div className='flex h-full w-full items-center justify-center'>
                      <Disc3 className='h-8 w-8 text-slate-500/70 dark:text-white/35' />
                    </div>
                  )}
                  <div className='absolute inset-0 bg-gradient-to-t from-slate-950/38 via-transparent to-transparent' />
                  <div className='absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur'>
                    <Disc3 className='h-3 w-3' />
                    {collection.trackCount || 0} 首
                  </div>
                </div>
                <div className='space-y-2 px-1 pb-1 pt-3'>
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <div className='truncate text-[15px] font-semibold text-slate-950 dark:text-white'>
                        {collection.title}
                      </div>
                      <div className='mt-1 text-[11px] uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500'>
                        {collection.kind}
                      </div>
                    </div>
                    {collection.accentColor ? (
                      <span
                        aria-hidden='true'
                        className='mt-1 h-2.5 w-2.5 rounded-full'
                        style={{ backgroundColor: collection.accentColor }}
                      />
                    ) : null}
                  </div>
                  {collection.description ? (
                    <p className='line-clamp-2 text-sm leading-6 text-slate-500 dark:text-slate-400'>
                      {collection.description}
                    </p>
                  ) : null}
                </div>
              </button>
              <button
                type='button'
                aria-label={`直接播放 ${collection.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onPlayCollection?.(collection);
                }}
                className='absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-slate-950 shadow-lg shadow-slate-900/10 transition-transform duration-200 group-hover:scale-105 dark:bg-black/72 dark:text-white'
              >
                <Play className='h-4 w-4 fill-current' />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
