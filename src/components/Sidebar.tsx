/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import {
  type LucideIcon,
  Cat,
  Clock3,
  Clover,
  Download,
  Film,
  Home,
  Loader2,
  Menu,
  Radio,
  Search,
  Star,
  Tv,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  type MouseEvent,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { flushSync } from 'react-dom';

import { DESKTOP_RUNTIME_UPDATED_EVENT } from '@/lib/desktop/runtime-config';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { useBrowserLocation } from '@/hooks/useBrowserLocation';

import {
  isModifiedNavigationEvent,
  useNavigationFeedback,
} from './NavigationFeedbackProvider';
import { useSite } from './SiteProvider';

interface SidebarContextType {
  isCollapsed: boolean;
}

const SidebarContext = createContext<SidebarContextType>({
  isCollapsed: false,
});

export const useSidebar = () => useContext(SidebarContext);

const Logo = () => {
  const { siteName } = useSite();

  return (
    <Link
      href='/'
      className='flex h-14 items-center px-3 select-none transition-opacity duration-200 hover:opacity-85'
    >
      <span className='luna-sidebar-wordmark truncate'>{siteName}</span>
    </Link>
  );
};

interface SidebarProps {
  onToggle?: (collapsed: boolean) => void;
  activePath?: string;
}

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

declare global {
  interface Window {
    __sidebarCollapsed?: boolean;
  }
}

const basePrimaryItems: NavItem[] = [
  {
    icon: Home,
    label: '首页',
    href: '/',
  },
  {
    icon: Search,
    label: '搜索',
    href: '/search',
  },
  {
    icon: Download,
    label: '下载',
    href: '/downloads',
  },
];

const defaultDiscoveryItems: NavItem[] = [
  {
    icon: Film,
    label: '电影',
    href: '/douban?type=movie',
  },
  {
    icon: Tv,
    label: '剧集',
    href: '/douban?type=tv',
  },
  {
    icon: Cat,
    label: '动漫',
    href: '/douban?type=anime',
  },
  {
    icon: Clover,
    label: '综艺',
    href: '/douban?type=show',
  },
];

const followUpdatesItem: NavItem = {
  icon: Clock3,
  label: '追更',
  href: '/follow-updates',
};

const Sidebar = ({ onToggle, activePath }: SidebarProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const browserLocation = useBrowserLocation();
  const { beginNavigation, pendingNavigation } = useNavigationFeedback();
  const followUpdatesHref = followUpdatesItem.href;
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (
      typeof window !== 'undefined' &&
      typeof window.__sidebarCollapsed === 'boolean'
    ) {
      return window.__sidebarCollapsed;
    }

    return false;
  });

  useLayoutEffect(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    if (saved === null) {
      return;
    }

    const nextValue = JSON.parse(saved);
    setIsCollapsed(nextValue);
    window.__sidebarCollapsed = nextValue;
  }, []);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    if (isCollapsed) {
      document.documentElement.dataset.sidebarCollapsed = 'true';
      return;
    }

    delete document.documentElement.dataset.sidebarCollapsed;
  }, [isCollapsed]);

  const currentFullPath = activePath ?? (browserLocation.href || pathname);
  const [active, setActive] = useState(activePath ?? currentFullPath);

  useLayoutEffect(() => {
    if (typeof activePath === 'string') {
      setActive(activePath);
      return;
    }

    setActive(currentFullPath);
  }, [activePath, currentFullPath]);

  const handleToggle = useCallback(() => {
    const nextValue = !isCollapsed;
    setIsCollapsed(nextValue);
    localStorage.setItem('sidebarCollapsed', JSON.stringify(nextValue));
    if (typeof window !== 'undefined') {
      window.__sidebarCollapsed = nextValue;
    }
    onToggle?.(nextValue);
  }, [isCollapsed, onToggle]);

  const contextValue = useMemo(
    () => ({
      isCollapsed,
    }),
    [isCollapsed]
  );

  const buildDiscoveryMenuItems = useCallback((): NavItem[] => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    const nextItems = [...defaultDiscoveryItems];

    if (runtimeConfig?.ENABLE_WEB_LIVE) {
      nextItems.push({
        icon: Radio,
        label: '直播',
        href: '/live',
      });
    }

    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      nextItems.push({
        icon: Star,
        label: '自定义',
        href: '/douban?type=custom',
      });
    }

    return nextItems;
  }, []);

  const [menuItems, setMenuItems] = useState<NavItem[]>(defaultDiscoveryItems);
  const [showFollowUpdatesEntry, setShowFollowUpdatesEntry] = useState(false);

  useEffect(() => {
    const applyRuntimeMenuItems = () => {
      setMenuItems(buildDiscoveryMenuItems());
    };

    applyRuntimeMenuItems();
    window.addEventListener(
      DESKTOP_RUNTIME_UPDATED_EVENT,
      applyRuntimeMenuItems
    );

    return () => {
      window.removeEventListener(
        DESKTOP_RUNTIME_UPDATED_EVENT,
        applyRuntimeMenuItems
      );
    };
  }, [buildDiscoveryMenuItems]);

  useEffect(() => {
    const syncFollowUpdatesEntryVisibility = () => {
      const runtimeConfig = getRuntimeConfig();
      setShowFollowUpdatesEntry(runtimeConfig.APP_TARGET === 'desktop');
    };

    syncFollowUpdatesEntryVisibility();
    window.addEventListener(
      DESKTOP_RUNTIME_UPDATED_EVENT,
      syncFollowUpdatesEntryVisibility
    );

    return () => {
      window.removeEventListener(
        DESKTOP_RUNTIME_UPDATED_EVENT,
        syncFollowUpdatesEntryVisibility
      );
    };
  }, []);

  const prefetchRoute = useCallback(
    (href: string) => {
      router.prefetch(href);
    },
    [router]
  );

  useEffect(() => {
    const prefetchTargets = [
      '/',
      '/search',
      '/downloads',
      ...(showFollowUpdatesEntry ? [followUpdatesHref] : []),
      ...menuItems.map((item) => item.href),
    ];
    const uniqueTargets = Array.from(new Set(prefetchTargets));
    const timeoutId = window.setTimeout(() => {
      uniqueTargets.forEach((href) => prefetchRoute(href));
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [followUpdatesHref, menuItems, prefetchRoute, showFollowUpdatesEntry]);

  const handleNavPointerDown = useCallback(
    (href: string) => {
      setActive(href);
      prefetchRoute(href);
    },
    [prefetchRoute]
  );

  const pendingNavigationHref =
    pendingNavigation?.kind === 'nav' ? pendingNavigation.href : null;

  const pushRouteWithPaint = useCallback(
    (href: string) => {
      window.setTimeout(() => {
        router.push(href);
      }, 0);
    },
    [router]
  );

  const handleNavClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, href: string, label: string) => {
      if (event.defaultPrevented || isModifiedNavigationEvent(event)) {
        return;
      }

      event.preventDefault();
      if (
        decodeURIComponent(currentFullPath) === decodeURIComponent(href) ||
        pendingNavigationHref === href
      ) {
        setActive(href);
        return;
      }

      flushSync(() => {
        setActive(href);
        beginNavigation({
          href,
          kind: 'nav',
          label,
        });
      });
      prefetchRoute(href);
      pushRouteWithPaint(href);
    },
    [
      beginNavigation,
      currentFullPath,
      pendingNavigationHref,
      prefetchRoute,
      pushRouteWithPaint,
    ]
  );

  const isPathActive = useCallback(
    (href: string) => {
      if (href === '/') {
        return pathname === '/';
      }

      if (href === '/search') {
        return pathname === '/search';
      }

      const typeMatch = href.match(/type=([^&]+)/)?.[1];
      const decodedActive = decodeURIComponent(active);
      const decodedItemHref = decodeURIComponent(href);

      return (
        decodedActive === decodedItemHref ||
        (pathname === '/douban' &&
          Boolean(typeMatch) &&
          decodedActive.includes(`type=${typeMatch}`))
      );
    },
    [active, pathname]
  );

  const sidebarWidthClass = isCollapsed ? 'w-[5.4rem]' : 'w-[17rem]';
  const sidebarSpacerClass = isCollapsed ? 'w-[6.4rem]' : 'w-[18rem]';
  const navItemClassName = `luna-sidebar-link ${
    isCollapsed ? 'justify-center px-0' : 'px-[0.88rem]'
  } py-[0.72rem]`;
  const navLabelClassName =
    'whitespace-nowrap text-[14px] font-medium tracking-[0.01em]';
  const navIconClassName = 'luna-sidebar-icon h-[1rem] w-[1rem]';

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;

    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch
        onPointerDown={() => handleNavPointerDown(item.href)}
        onClick={(event) => handleNavClick(event, item.href, item.label)}
        onMouseEnter={() => prefetchRoute(item.href)}
        onFocus={() => prefetchRoute(item.href)}
        data-active={isPathActive(item.href)}
        className={navItemClassName}
      >
        <div className='flex h-5 w-5 items-center justify-center'>
          <Icon className={navIconClassName} />
        </div>
        {!isCollapsed && (
          <span className={navLabelClassName}>{item.label}</span>
        )}
        {pendingNavigationHref === item.href && !isCollapsed ? (
          <Loader2 className='ml-auto h-3.5 w-3.5 animate-spin opacity-80' />
        ) : null}
      </Link>
    );
  };

  return (
    <SidebarContext.Provider value={contextValue}>
      <div className='hidden md:flex'>
        <aside
          data-sidebar
          className={`fixed bottom-4 left-4 top-4 z-20 transition-all duration-300 ${sidebarWidthClass}`}
        >
          <div className='luna-sidebar-shell flex h-full flex-col rounded-[2rem] px-4 py-5'>
            <div className='relative h-14'>
              <div
                className={`absolute inset-y-0 left-0 right-12 flex items-center transition-opacity duration-200 ${
                  isCollapsed ? 'opacity-0' : 'opacity-100'
                }`}
              >
                {!isCollapsed && <Logo />}
              </div>
              <button
                onClick={handleToggle}
                className={`luna-sidebar-toggle absolute top-1/2 z-10 -translate-y-1/2 ${
                  isCollapsed ? 'left-1/2 -translate-x-1/2' : 'right-2'
                }`}
                aria-label={isCollapsed ? '展开侧边栏' : '折叠侧边栏'}
              >
                <Menu className='h-4 w-4' />
              </button>
            </div>

            <nav className='mt-4 space-y-1.5 px-1'>
              {basePrimaryItems.map(renderNavItem)}
              {showFollowUpdatesEntry ? renderNavItem(followUpdatesItem) : null}
            </nav>

            <div className='flex-1 overflow-y-auto px-1 pt-5'>
              <div className='space-y-1.5'>{menuItems.map(renderNavItem)}</div>
            </div>
          </div>
        </aside>
        <div
          className={`transition-all duration-300 ${sidebarSpacerClass}`}
        ></div>
      </div>
    </SidebarContext.Provider>
  );
};

export default Sidebar;
