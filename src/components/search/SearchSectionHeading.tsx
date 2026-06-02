'use client';

import { ReactNode } from 'react';

interface SearchSectionHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export default function SearchSectionHeading({
  title,
  description,
  meta,
  actions,
  className,
}: SearchSectionHeadingProps) {
  return (
    <div
      className={`mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${
        className || ''
      }`}
    >
      <div>
        <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
          {title}
        </h2>
        {description ? (
          <div className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
            {description}
          </div>
        ) : null}
        {meta ? (
          <div className='mt-1 text-xs text-gray-400 dark:text-gray-500'>
            {meta}
          </div>
        ) : null}
      </div>

      {actions ? <div>{actions}</div> : null}
    </div>
  );
}
