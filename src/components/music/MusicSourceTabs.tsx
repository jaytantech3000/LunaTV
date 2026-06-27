'use client';

import { cn } from '@/lib/cn';
import { MusicSource } from '@/lib/music/types';

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
    <div className='flex gap-1 overflow-x-auto border-b border-slate-200 pb-1 scrollbar-hide dark:border-slate-800'>
      {sources.map((source) => {
        const active = source.key === activeSource;
        return (
          <button
            key={source.key}
            type='button'
            onClick={() => onChange(source.key)}
            className={cn(
              'group relative shrink-0 rounded-2xl px-4 py-3 text-left transition-colors',
              active
                ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white'
            )}
          >
            <div className='text-[10px] uppercase tracking-[0.26em] opacity-55'>
              {source.provider}
            </div>
            <div className='mt-1 text-sm font-semibold'>{source.name}</div>
            {active ? (
              <div className='mt-2 h-0.5 w-8 rounded-full bg-emerald-400 dark:bg-emerald-300' />
            ) : (
              <div className='mt-2 h-0.5 w-8 rounded-full bg-transparent' />
            )}
          </button>
        );
      })}
    </div>
  );
}
