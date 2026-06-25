'use client';

import { MusicSource } from '@/lib/music/types';
import { cn } from '@/lib/cn';

interface MusicSourceTabsProps {
  sources: MusicSource[];
  activeSource: MusicSource['key'] | null;
  onChange: (source: MusicSource['key']) => void;
}

export default function MusicSourceTabs({
  sources,
  activeSource,
  onChange,
}: MusicSourceTabsProps) {
  return (
    <div className='flex gap-2 overflow-x-auto pb-1 scrollbar-hide'>
      {sources.map((source) => {
        const active = source.key === activeSource;
        return (
          <button
            key={source.key}
            type='button'
            onClick={() => onChange(source.key)}
            className={cn(
              'group relative shrink-0 overflow-hidden rounded-2xl border px-4 py-3 text-left transition-all duration-200',
              active
                ? 'border-emerald-400/70 bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                : 'border-white/70 bg-white/70 text-slate-700 shadow-sm hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-slate-500'
            )}
          >
            <div className='text-[11px] uppercase tracking-[0.28em] opacity-70'>
              {source.provider}
            </div>
            <div className='mt-1 text-sm font-semibold'>{source.name}</div>
          </button>
        );
      })}
    </div>
  );
}
