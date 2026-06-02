'use client';

import React from 'react';

export type SearchContentType =
  | 'all'
  | 'movie'
  | 'series'
  | 'anime'
  | 'variety'
  | 'documentary';

export interface SearchFacetOption {
  key: string;
  label: string;
}

export interface SearchCustomTag {
  key: string;
  label: string;
  query: string;
  mediaType?: 'movie' | 'tv';
}

interface SearchQuickSelectorProps {
  contentTypes: SearchFacetOption[];
  regions: SearchFacetOption[];
  genres: SearchFacetOption[];
  customTags: SearchCustomTag[];
  selectedContentType: SearchContentType;
  selectedRegionKey: string;
  selectedGenreKey: string;
  selectedCustomTagKey: string;
  onContentTypeChange: (contentType: SearchContentType) => void;
  onRegionToggle: (regionKey: string) => void;
  onGenreToggle: (genreKey: string) => void;
  onCustomTagToggle: (tag: SearchCustomTag) => void;
  onReset: () => void;
  className?: string;
}

function SearchQuickSelector({
  contentTypes,
  regions,
  genres,
  customTags,
  selectedContentType,
  selectedRegionKey,
  selectedGenreKey,
  selectedCustomTagKey,
  onContentTypeChange,
  onRegionToggle,
  onGenreToggle,
  onCustomTagToggle,
  onReset,
  className,
}: SearchQuickSelectorProps) {
  const hasActiveSelection =
    selectedContentType !== 'all' ||
    !!selectedRegionKey ||
    !!selectedGenreKey ||
    !!selectedCustomTagKey;

  const renderGroup = (
    title: string,
    items: SearchFacetOption[],
    selectedKey: string,
    onSelect: (key: string) => void
  ) => {
    if (items.length === 0) {
      return null;
    }

    return (
      <div className='space-y-2'>
        <div className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400'>
          {title}
        </div>
        <div className='flex flex-wrap gap-2'>
          {items.map((item) => {
            const isActive = selectedKey === item.key;
            return (
              <button
                key={item.key}
                type='button'
                onClick={() => onSelect(item.key)}
                className={`rounded-full border px-3 py-1.5 text-xs sm:text-sm transition-colors ${
                  isActive
                    ? 'border-green-500 bg-green-500 text-white'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-green-300 hover:text-green-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300 dark:hover:border-green-600 dark:hover:text-green-400'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <section
      className={`w-full rounded-2xl border border-gray-200/70 bg-white/85 p-4 shadow-sm backdrop-blur-sm dark:border-gray-800 dark:bg-gray-900/70 ${
        className || ''
      }`}
    >
      {hasActiveSelection && (
        <div className='flex justify-end'>
          <button
            type='button'
            onClick={onReset}
            className='text-xs sm:text-sm text-gray-500 transition-colors hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400'
          >
            重置
          </button>
        </div>
      )}

      <div className={`space-y-4 ${hasActiveSelection ? 'mt-3' : ''}`}>
        {renderGroup('类型', contentTypes, selectedContentType, (key) =>
          onContentTypeChange(key as SearchContentType)
        )}
        {renderGroup('地区', regions, selectedRegionKey, onRegionToggle)}
        {renderGroup('常见标签', genres, selectedGenreKey, onGenreToggle)}
        {customTags.length > 0 &&
          renderGroup('自定义标签', customTags, selectedCustomTagKey, (key) => {
            const tag = customTags.find((item) => item.key === key);
            if (tag) {
              onCustomTagToggle(tag);
            }
          })}
      </div>
    </section>
  );
}

export default SearchQuickSelector;
