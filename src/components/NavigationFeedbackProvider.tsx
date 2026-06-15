'use client';

import { Loader2 } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

interface PendingNavigationState {
  href: string;
  kind: 'nav' | 'card';
  label: string;
  startedAt: number;
}

interface NavigationFeedbackContextValue {
  beginNavigation: (input: {
    href: string;
    kind?: PendingNavigationState['kind'];
    label?: string;
  }) => void;
  clearNavigation: () => void;
  pendingNavigation: PendingNavigationState | null;
}

const NavigationFeedbackContext =
  createContext<NavigationFeedbackContextValue | null>(null);

function NavigationFeedbackOverlay({
  pendingNavigation,
}: {
  pendingNavigation: PendingNavigationState | null;
}) {
  if (!pendingNavigation) {
    return null;
  }

  return (
    <div className='pointer-events-none fixed inset-x-0 top-0 z-[12000] flex justify-center pt-3'>
      <div className='absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-emerald-500/10'>
        <div className='navigation-feedback-progress h-full w-1/3 rounded-full bg-emerald-400/90 shadow-[0_0_18px_rgba(52,211,153,0.55)]' />
      </div>

      <div className='mx-4 flex max-w-[min(92vw,540px)] items-center gap-2 rounded-full border border-emerald-400/20 bg-black/75 px-3 py-2 text-xs text-white shadow-2xl shadow-black/30 backdrop-blur-xl'>
        <Loader2 className='h-3.5 w-3.5 shrink-0 animate-spin text-emerald-300' />
        <span className='shrink-0 text-emerald-200'>
          {pendingNavigation.kind === 'nav' ? '正在前往' : '正在打开'}
        </span>
        <span className='truncate text-white/90'>
          {pendingNavigation.label}
        </span>
      </div>
    </div>
  );
}

export function NavigationFeedbackProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingNavigationState | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  const clearNavigation = useCallback(() => {
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }

    setPendingNavigation(null);
  }, []);

  const beginNavigation = useCallback(
    ({
      href,
      kind = 'nav',
      label = '页面',
    }: {
      href: string;
      kind?: PendingNavigationState['kind'];
      label?: string;
    }) => {
      clearNavigation();
      setPendingNavigation({
        href,
        kind,
        label,
        startedAt: Date.now(),
      });

      clearTimerRef.current = window.setTimeout(() => {
        setPendingNavigation(null);
        clearTimerRef.current = null;
      }, 8000);
    },
    [clearNavigation]
  );

  useEffect(() => {
    clearNavigation();
  }, [pathname, searchParamsKey, clearNavigation]);

  useEffect(
    () => () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
    },
    []
  );

  const contextValue = useMemo(
    () => ({
      beginNavigation,
      clearNavigation,
      pendingNavigation,
    }),
    [beginNavigation, clearNavigation, pendingNavigation]
  );

  return (
    <NavigationFeedbackContext.Provider value={contextValue}>
      {children}
      <NavigationFeedbackOverlay pendingNavigation={pendingNavigation} />
    </NavigationFeedbackContext.Provider>
  );
}

export function useNavigationFeedback() {
  const context = useContext(NavigationFeedbackContext);
  if (!context) {
    throw new Error(
      'useNavigationFeedback must be used within NavigationFeedbackProvider'
    );
  }

  return context;
}

export function isModifiedNavigationEvent(
  event:
    | React.MouseEvent<HTMLElement>
    | React.PointerEvent<HTMLElement>
    | MouseEvent
): boolean {
  return (
    ('button' in event && event.button !== 0) ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}
