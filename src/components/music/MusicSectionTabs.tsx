'use client';

import type { MusicSectionTab } from '@/lib/music/types';
import { getMusicTabLabel } from '@/lib/music/format';
import { cn } from '@/lib/cn';

interface MusicSectionTabsProps {
  tabs: MusicSectionTab[];
  activeTab: MusicSectionTab;
  onChange: (tab: MusicSectionTab) => void;
}

export default function MusicSectionTabs({
  tabs,
  activeTab,
  onChange,
}: MusicSectionTabsProps) {
  return (
    <div className='flex gap-2 overflow-x-auto pb-1 scrollbar-hide'>
      {tabs.map((tab) => {
        const active = tab === activeTab;
        return (
          <button
            key={tab}
            type='button'
            onClick={() => onChange(tab)}
            className={cn(
              'shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors',
              active
                ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950'
                : 'border-slate-200 bg-white/80 text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100'
            )}
          >
            {getMusicTabLabel(tab)}
          </button>
        );
      })}
    </div>
  );
}
