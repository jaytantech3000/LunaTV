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

      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
        {collections.map((collection) => {
          const active = activeCollectionId === collection.id;
          return (
            <article
              key={collection.id}
              className={cn(
                'group relative overflow-hidden rounded-[28px] border text-left transition-all duration-200',
                active
                  ? 'border-emerald-400 bg-white shadow-lg shadow-emerald-500/10 dark:border-emerald-400/60 dark:bg-slate-900'
                  : 'border-white/80 bg-white/80 shadow-sm hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-600'
              )}
            >
              <button
                type='button'
                onClick={() => onSelect(collection)}
                className='block w-full text-left'
              >
                <div className='relative aspect-[4/3] overflow-hidden'>
                  <img
                    src={collection.cover}
                    alt={collection.title}
                    className='h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]'
                  />
                  <div className='absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/10 to-transparent' />
                  <div className='absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-white/16 px-3 py-1 text-xs font-medium text-white backdrop-blur'>
                    <Disc3 className='h-3.5 w-3.5' />
                    {collection.trackCount || 0} 首
                  </div>
                </div>
                <div className='space-y-2 p-5'>
                  <div className='flex items-start justify-between gap-3'>
                    <div>
                      <div className='text-base font-semibold text-slate-950 dark:text-white'>
                        {collection.title}
                      </div>
                      <div className='mt-1 text-xs uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500'>
                        {collection.kind}
                      </div>
                    </div>
                    {collection.accentColor ? (
                      <span
                        aria-hidden='true'
                        className='mt-1 h-3 w-3 rounded-full'
                        style={{ backgroundColor: collection.accentColor }}
                      />
                    ) : null}
                  </div>
                  {collection.description ? (
                    <p className='text-sm leading-6 text-slate-500 dark:text-slate-400'>
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
                className='absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/18 text-white backdrop-blur transition-transform duration-200 group-hover:scale-105'
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
