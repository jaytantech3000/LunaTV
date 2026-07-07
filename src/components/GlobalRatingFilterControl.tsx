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
    return <div className='h-[2.625rem] w-[2.625rem]' />;
  }

  return (
    <div ref={containerRef} className='relative'>
      <button
        type='button'
        onClick={() => setIsOpen((previousValue) => !previousValue)}
        className={`luna-toolbar-button relative ${
          enabled ? 'text-[var(--luna-accent)]' : ''
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
        <div className='luna-popover absolute right-0 top-full z-[1200] mt-3 w-72 rounded-[1.75rem] p-4 text-[var(--luna-copy-strong)]'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <p className='text-sm font-semibold text-[var(--luna-copy-strong)]'>
                评分过滤
              </p>
              <p className='mt-1 text-xs text-[var(--luna-copy-muted)]'>
                低于指定分数的已评分内容将被隐藏
              </p>
            </div>
            <button
              type='button'
              onClick={() => setIsOpen(false)}
              className='luna-toolbar-button h-8 w-8 p-1 text-[var(--luna-copy-muted)]'
              aria-label='关闭评分过滤器'
            >
              <X className='h-4 w-4' />
            </button>
          </div>

          <div className='mt-4 flex items-center justify-between rounded-[1.25rem] border border-[var(--luna-card-border)] bg-[var(--luna-card-fill)] px-3 py-3'>
            <div>
              <p className='text-sm font-medium text-[var(--luna-copy-strong)]'>
                启用过滤
              </p>
              <p className='mt-1 text-xs text-[var(--luna-copy-muted)]'>
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
              <span className='h-6 w-11 rounded-full bg-white/30 transition-colors peer-checked:bg-[var(--luna-accent)] dark:bg-white/10' />
              <span className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5' />
            </label>
          </div>

          <div className='mt-4 space-y-3'>
            <div className='flex items-center justify-between text-xs text-[var(--luna-copy-muted)]'>
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
              className='h-2 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-[var(--luna-accent)] disabled:cursor-not-allowed disabled:opacity-50'
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
                className='h-10 w-full rounded-[1rem] border border-[var(--luna-card-border)] bg-white/50 px-3 text-sm text-[var(--luna-copy-strong)] outline-none transition-colors focus:border-[var(--luna-accent)] focus:ring-2 focus:ring-[var(--luna-accent-soft)] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-[var(--luna-copy-muted)] dark:bg-black/20'
              />
              <button
                type='button'
                onClick={applyDraftRating}
                disabled={!enabled}
                className='h-10 shrink-0 rounded-[1rem] bg-[var(--luna-accent)] px-3 text-sm font-medium text-white transition-colors hover:opacity-95 disabled:cursor-not-allowed disabled:bg-white/20'
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
                      ? 'bg-[var(--luna-accent)] text-white'
                      : 'bg-white/20 text-[var(--luna-copy-muted)] hover:bg-white/30'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {formatRating(presetRating)}
                </button>
              ))}
            </div>

            <p className='text-xs leading-5 text-[var(--luna-copy-muted)]'>
              未评分内容会保留显示，只过滤已存在评分的卡片。
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
