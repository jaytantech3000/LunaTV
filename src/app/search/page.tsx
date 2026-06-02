'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useLayoutEffect, useState } from 'react';

import LegacySearchPage from '@/components/search/LegacySearchPage';
import NewSearchPage from '@/components/search/NewSearchPage';

type SearchMode = 'new' | 'legacy';

function SearchPageSwitcher() {
  const searchParams = useSearchParams();
  const mode: SearchMode =
    searchParams.get('mode') === 'legacy' ? 'legacy' : 'new';
  const [mountedModes, setMountedModes] = useState<Record<SearchMode, boolean>>(
    () => ({
      new: mode === 'new',
      legacy: mode === 'legacy',
    })
  );

  useLayoutEffect(() => {
    setMountedModes((previousModes) =>
      previousModes[mode]
        ? previousModes
        : {
            ...previousModes,
            [mode]: true,
          }
    );
  }, [mode]);

  return (
    <>
      {mountedModes.new ? (
        <div
          className={mode === 'new' ? 'block' : 'hidden'}
          aria-hidden={mode !== 'new'}
        >
          <NewSearchPage active={mode === 'new'} />
        </div>
      ) : null}
      {mountedModes.legacy ? (
        <div
          className={mode === 'legacy' ? 'block' : 'hidden'}
          aria-hidden={mode !== 'legacy'}
        >
          <LegacySearchPage active={mode === 'legacy'} />
        </div>
      ) : null}
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageSwitcher />
    </Suspense>
  );
}
