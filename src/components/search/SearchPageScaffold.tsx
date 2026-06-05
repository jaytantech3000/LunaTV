'use client';

import { ChevronUp, Search, X } from 'lucide-react';
import React from 'react';

import PageLayout from '@/components/PageLayout';
import SearchHistorySection from '@/components/search/SearchHistorySection';
import SearchModeToggle from '@/components/search/SearchModeToggle';

type SearchMode = 'new' | 'legacy';

interface SearchHistoryConfig {
  items: string[];
  visible: boolean;
  onSelect: (keyword: string) => void;
  onClear: () => void | Promise<void>;
  onDelete: (keyword: string) => void | Promise<void>;
}

interface SearchPageScaffoldProps {
  mode: SearchMode;
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  onSearchSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onClearSearch: () => void;
  searchInputRef?: React.Ref<HTMLInputElement>;
  searchInputId?: string;
  searchPlaceholder?: string;
  onSearchInputFocus?: () => void;
  searchSuggestions?: React.ReactNode;
  searchHistory?: SearchHistoryConfig;
  topModule?: React.ReactNode;
  children: React.ReactNode;
  showBackToTop?: boolean;
  onScrollToTop?: () => void;
  contentWidthClassName?: string;
}

export default function SearchPageScaffold({
  mode,
  searchValue,
  onSearchValueChange,
  onSearchSubmit,
  onClearSearch,
  searchInputRef,
  searchInputId = 'searchInput',
  searchPlaceholder = '搜索片名',
  onSearchInputFocus,
  searchSuggestions,
  searchHistory,
  topModule,
  children,
  showBackToTop = false,
  onScrollToTop,
  contentWidthClassName = 'max-w-[95%]',
}: SearchPageScaffoldProps) {
  return (
    <PageLayout activePath='/search'>
      <div className='px-4 py-4 sm:px-10 sm:py-8'>
        <div className={`mx-auto ${contentWidthClassName}`}>
          <form onSubmit={onSearchSubmit} className='relative'>
            <Search className='pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500' />
            <input
              ref={searchInputRef}
              id={searchInputId}
              type='text'
              autoComplete='off'
              value={searchValue}
              onChange={(event) => onSearchValueChange(event.target.value)}
              onFocus={onSearchInputFocus}
              placeholder={searchPlaceholder}
              className='h-12 w-full rounded-2xl border border-gray-200/70 bg-white/90 py-3 pl-11 pr-24 text-sm text-gray-700 shadow-sm outline-none transition-all focus:border-green-400 focus:ring-2 focus:ring-green-400/30 dark:border-gray-700 dark:bg-gray-900/80 dark:text-gray-200'
            />
            <div className='absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1'>
              {searchValue && (
                <button
                  type='button'
                  onClick={onClearSearch}
                  className='rounded-full p-2 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
                  aria-label='清空搜索内容'
                >
                  <X className='h-4 w-4' />
                </button>
              )}
              <button
                type='submit'
                className='rounded-full bg-green-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-600'
              >
                搜索
              </button>
            </div>

            {searchSuggestions}
          </form>

          <SearchModeToggle mode={mode} className='mt-5 lg:mt-6' />
        </div>

        {searchHistory?.visible ? (
          <div className={`mx-auto mt-4 ${contentWidthClassName}`}>
            <SearchHistorySection
              items={searchHistory.items}
              onSelect={searchHistory.onSelect}
              onClear={searchHistory.onClear}
              onDelete={searchHistory.onDelete}
            />
          </div>
        ) : null}

        {topModule ? (
          <div className={`mx-auto mt-4 ${contentWidthClassName}`}>
            {topModule}
          </div>
        ) : null}

        <div
          className={`mx-auto mt-8 overflow-visible ${contentWidthClassName}`}
        >
          {children}
        </div>
      </div>

      {onScrollToTop ? (
        <button
          type='button'
          onClick={onScrollToTop}
          className={`fixed bottom-20 right-6 z-[500] flex h-12 w-12 items-center justify-center rounded-full bg-green-500/90 text-white shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out hover:bg-green-500 md:bottom-6 ${
            showBackToTop
              ? 'pointer-events-auto translate-y-0 opacity-100'
              : 'pointer-events-none translate-y-4 opacity-0'
          }`}
          aria-label='返回顶部'
        >
          <ChevronUp className='h-6 w-6' />
        </button>
      ) : null}
    </PageLayout>
  );
}
