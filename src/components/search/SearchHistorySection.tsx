'use client';

import { X } from 'lucide-react';

interface SearchHistorySectionProps {
  items: string[];
  onSelect: (keyword: string) => void;
  onClear: () => void | Promise<void>;
  onDelete: (keyword: string) => void | Promise<void>;
  className?: string;
}

export default function SearchHistorySection({
  items,
  onSelect,
  onClear,
  onDelete,
  className,
}: SearchHistorySectionProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className={className}>
      <div className='flex items-center gap-3'>
        <h2 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          搜索历史
        </h2>
        <button
          type='button'
          onClick={() => {
            void onClear();
          }}
          className='text-xs text-gray-500 transition-colors hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400'
        >
          清空
        </button>
      </div>
      <div className='mt-3 flex flex-wrap gap-2'>
        {items.map((keyword) => (
          <div key={keyword} className='group relative'>
            <button
              type='button'
              onClick={() => onSelect(keyword)}
              className='rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            >
              {keyword}
            </button>
            <button
              type='button'
              aria-label='删除搜索历史'
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void onDelete(keyword);
              }}
              className='absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gray-400 text-white opacity-0 transition-colors group-hover:opacity-100 hover:bg-red-500'
            >
              <X className='h-3 w-3' />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
