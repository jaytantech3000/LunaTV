'use client';

import { cn } from '@/lib/cn';
import { getMusicTabLabel } from '@/lib/music/format';
import type { MusicSectionTab } from '@/lib/music/types';

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
    <div className='flex gap-1 overflow-x-auto pb-1 scrollbar-hide'>
      {tabs.map((tab) => {
        const active = tab === activeTab;
        return (
          <button
            key={tab}
            type='button'
            onClick={() => onChange(tab)}
            className={cn(
              'shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100'
            )}
          >
            {getMusicTabLabel(tab)}
          </button>
        );
      })}
    </div>
  );
}
