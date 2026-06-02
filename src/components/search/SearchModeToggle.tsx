'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import CapsuleSwitch from '@/components/CapsuleSwitch';

type SearchMode = 'new' | 'legacy';

interface SearchModeToggleProps {
  mode: SearchMode;
  className?: string;
}

const SEARCH_MODE_OPTIONS = [
  { label: '豆瓣', value: 'new' },
  { label: '全局', value: 'legacy' },
];

export default function SearchModeToggle({
  mode,
  className,
}: SearchModeToggleProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleModeChange = (nextMode: string) => {
    if (nextMode !== 'new' && nextMode !== 'legacy') {
      return;
    }

    if (nextMode === mode) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('mode', nextMode);

    const nextQueryString = nextParams.toString();
    router.replace(nextQueryString ? `/search?${nextQueryString}` : '/search');
  };

  return (
    <div className={`flex justify-end ${className || ''}`}>
      <CapsuleSwitch
        options={SEARCH_MODE_OPTIONS}
        active={mode}
        onChange={handleModeChange}
      />
    </div>
  );
}
