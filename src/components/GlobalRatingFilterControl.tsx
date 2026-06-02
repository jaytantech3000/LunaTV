'use client';

import { SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  DEFAULT_GLOBAL_MINIMUM_RATING,
  normalizeMinimumRating,
} from '@/lib/rating-filter';

import { useGlobalRatingFilterStore } from '@/stores/useGlobalRatingFilterStore';

const PRESET_RATINGS = [6, 7, 8, 9];

function formatRating(value: number): string {
  return normalizeMinimumRating(value).toFixed(1);
}

export default function GlobalRatingFilterControl() {
  const containerRef = useRef<HTMLDivElement>(null);
  const enabled = useGlobalRatingFilterStore((state) => state.enabled);
  const minimumRating = useGlobalRatingFilterStore(
    (state) => state.minimumRating
  );
  const hasHydrated = useGlobalRatingFilterStore((state) => state.hasHydrated);
  const setEnabled = useGlobalRatingFilterStore((state) => state.setEnabled);
  const setMinimumRating = useGlobalRatingFilterStore(
    (state) => state.setMinimumRating
  );
  const [isOpen, setIsOpen] = useState(false);
  const [draftRating, setDraftRating] = useState(
    formatRating(DEFAULT_GLOBAL_MINIMUM_RATING)
  );

  useEffect(() => {
    setDraftRating(formatRating(minimumRating));
  }, [minimumRating]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const applyDraftRating = () => {
    const numericRating = Number.parseFloat(draftRating);
    const normalizedRating = normalizeMinimumRating(
      Number.isFinite(numericRating)
        ? numericRating
        : DEFAULT_GLOBAL_MINIMUM_RATING
    );
    setDraftRating(formatRating(normalizedRating));
    setMinimumRating(normalizedRating);
  };

  if (!hasHydrated) {
    return <div className='h-10 w-10' />;
  }

  return (
    <div ref={containerRef} className='relative'>
      <button
        type='button'
        onClick={() => setIsOpen((previousValue) => !previousValue)}
        className={`relative flex h-10 w-10 items-center justify-center rounded-full p-2 transition-colors ${
          enabled
            ? 'bg-green-500/15 text-green-600 hover:bg-green-500/20 dark:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/20'
            : 'text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50'
        }`}
        aria-label='打开评分过滤器'
        aria-expanded={isOpen}
      >
        <SlidersHorizontal className='h-full w-full' />
        {enabled ? (
          <span className='absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-green-500 dark:bg-green-400' />
        ) : null}
      </button>

      {isOpen ? (
        <div className='absolute right-0 top-full z-[1200] mt-2 w-72 rounded-2xl border border-gray-200/70 bg-white/95 p-4 shadow-xl backdrop-blur-xl dark:border-gray-700/70 dark:bg-gray-900/95'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <p className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                评分过滤
              </p>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                低于指定分数的已评分内容将被隐藏
              </p>
            </div>
            <button
              type='button'
              onClick={() => setIsOpen(false)}
              className='rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300'
              aria-label='关闭评分过滤器'
            >
              <X className='h-4 w-4' />
            </button>
          </div>

          <div className='mt-4 flex items-center justify-between rounded-2xl bg-gray-50 px-3 py-3 dark:bg-gray-800/70'>
            <div>
              <p className='text-sm font-medium text-gray-800 dark:text-gray-100'>
                启用过滤
              </p>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                当前阈值 {formatRating(minimumRating)}
              </p>
            </div>
            <label className='relative inline-flex cursor-pointer items-center'>
              <input
                type='checkbox'
                className='peer sr-only'
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              <span className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600' />
              <span className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5' />
            </label>
          </div>

          <div className='mt-4 space-y-3'>
            <div className='flex items-center justify-between text-xs text-gray-500 dark:text-gray-400'>
              <span>最低评分</span>
              <span>{formatRating(minimumRating)}</span>
            </div>

            <input
              type='range'
              min='0'
              max='10'
              step='0.1'
              value={minimumRating}
              onChange={(event) =>
                setMinimumRating(Number.parseFloat(event.target.value))
              }
              disabled={!enabled}
              className='h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-green-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700'
            />

            <div className='flex items-center gap-2'>
              <input
                type='number'
                min='0'
                max='10'
                step='0.1'
                inputMode='decimal'
                value={draftRating}
                disabled={!enabled}
                onChange={(event) => setDraftRating(event.target.value)}
                onBlur={applyDraftRating}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    applyDraftRating();
                  }
                }}
                className='h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none transition-colors focus:border-green-400 focus:ring-2 focus:ring-green-400/30 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:disabled:bg-gray-800'
              />
              <button
                type='button'
                onClick={applyDraftRating}
                disabled={!enabled}
                className='h-10 shrink-0 rounded-xl bg-green-500 px-3 text-sm font-medium text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700'
              >
                应用
              </button>
            </div>

            <div className='flex flex-wrap gap-2'>
              {PRESET_RATINGS.map((presetRating) => (
                <button
                  key={presetRating}
                  type='button'
                  onClick={() => {
                    setMinimumRating(presetRating);
                    setDraftRating(formatRating(presetRating));
                  }}
                  disabled={!enabled}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    minimumRating === presetRating
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {formatRating(presetRating)}
                </button>
              ))}
            </div>

            <p className='text-xs leading-5 text-gray-500 dark:text-gray-400'>
              未评分内容会保留显示，只过滤已存在评分的卡片。
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
