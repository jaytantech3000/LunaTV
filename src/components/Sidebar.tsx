/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import {
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

// 可替换为你自己的 logo 图片
const Logo = () => {
  const { siteName } = useSite();
  return (
    <Link
      href='/'
      className='flex items-center justify-center h-16 select-none hover:opacity-80 transition-opacity duration-200'
    >
      <span className='text-2xl font-bold text-green-600 tracking-tight'>
        {siteName}
      </span>
    </Link>
  );
};

interface SidebarProps {
  onToggle?: (collapsed: boolean) => void;
  activePath?: string;
}

// 在浏览器环境下通过全局变量缓存折叠状态，避免组件重新挂载时出现初始值闪烁
declare global {
  interface Window {
    __sidebarCollapsed?: boolean;
  }
}

const Sidebar = ({ onToggle, activePath }: SidebarProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const browserLocation = useBrowserLocation();
  const { beginNavigation, pendingNavigation } = useNavigationFeedback();
  const followUpdatesHref = '/follow-updates';
  // 若同一次 SPA 会话中已经读取过折叠状态，则直接复用，避免闪烁
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (
      typeof window !== 'undefined' &&
      typeof window.__sidebarCollapsed === 'boolean'
    ) {
      return window.__sidebarCollapsed;
    }
    return false; // 默认展开
  });

  // 首次挂载时读取 localStorage，以便刷新后仍保持上次的折叠状态
  useLayoutEffect(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    if (saved !== null) {
      const val = JSON.parse(saved);
      setIsCollapsed(val);
      window.__sidebarCollapsed = val;
    }
  }, []);

  // 当折叠状态变化时，同步到 <html> data 属性，供首屏 CSS 使用
  useLayoutEffect(() => {
    if (typeof document !== 'undefined') {
      if (isCollapsed) {
        document.documentElement.dataset.sidebarCollapsed = 'true';
      } else {
        delete document.documentElement.dataset.sidebarCollapsed;
      }
    }
  }, [isCollapsed]);

  const currentFullPath = activePath ?? (browserLocation.href || pathname);

  const [active, setActive] = useState(activePath ?? currentFullPath);

  useLayoutEffect(() => {
    if (typeof activePath === 'string') {
      setActive(activePath);
    } else {
      setActive(currentFullPath);
    }
  }, [activePath, currentFullPath]);

  const handleToggle = useCallback(() => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem('sidebarCollapsed', JSON.stringify(newState));
    if (typeof window !== 'undefined') {
      window.__sidebarCollapsed = newState;
    }
    onToggle?.(newState);
  }, [isCollapsed, onToggle]);

  const contextValue = {
    isCollapsed,
  };

  const buildDiscoveryMenuItems = useCallback(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    const nextItems = [
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

  const [menuItems, setMenuItems] = useState([
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
  ]);
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

  return (
    <SidebarContext.Provider value={contextValue}>
      {/* 在移动端隐藏侧边栏 */}
      <div className='hidden md:flex'>
        <aside
          data-sidebar
          className={`fixed top-0 left-0 h-screen bg-white/40 backdrop-blur-xl transition-all duration-300 border-r border-gray-200/50 z-10 shadow-lg dark:bg-gray-900/70 dark:border-gray-700/50 ${
            isCollapsed ? 'w-16' : 'w-64'
          }`}
          style={{
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className='flex h-full flex-col'>
            {/* 顶部 Logo 区域 */}
            <div className='relative h-16'>
              <div
                className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
                  isCollapsed ? 'opacity-0' : 'opacity-100'
                }`}
              >
                <div className='w-[calc(100%-4rem)] flex justify-center'>
                  {!isCollapsed && <Logo />}
                </div>
              </div>
              <button
                onClick={handleToggle}
                className={`absolute top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100/50 transition-colors duration-200 z-10 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700/50 ${
                  isCollapsed ? 'left-1/2 -translate-x-1/2' : 'right-2'
                }`}
              >
                <Menu className='h-4 w-4' />
              </button>
            </div>

            {/* 首页和搜索导航 */}
            <nav className='px-2 mt-4 space-y-1'>
              <Link
                href='/'
                prefetch
                onPointerDown={() => handleNavPointerDown('/')}
                onClick={(event) => handleNavClick(event, '/', '首页')}
                onMouseEnter={() => prefetchRoute('/')}
                onFocus={() => prefetchRoute('/')}
                data-active={isPathActive('/')}
                className={`group flex items-center rounded-lg px-2 py-2 pl-4 text-gray-700 hover:bg-gray-100/30 hover:text-green-600 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 font-medium transition-colors duration-200 min-h-[40px] dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 ${
                  isCollapsed ? 'w-full max-w-none mx-0' : 'mx-0'
                } gap-3 justify-start`}
              >
                <div className='w-4 h-4 flex items-center justify-center'>
                  <Home className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                </div>
                {!isCollapsed && (
                  <span className='whitespace-nowrap transition-opacity duration-200 opacity-100'>
                    首页
                  </span>
                )}
                {pendingNavigationHref === '/' && !isCollapsed ? (
                  <Loader2 className='ml-auto h-3.5 w-3.5 animate-spin text-green-600 dark:text-green-400' />
                ) : null}
              </Link>
              <Link
                href='/search'
                prefetch
                onPointerDown={() => handleNavPointerDown('/search')}
                onClick={(event) => handleNavClick(event, '/search', '搜索')}
                onMouseEnter={() => prefetchRoute('/search')}
                onFocus={() => prefetchRoute('/search')}
                data-active={isPathActive('/search')}
                className={`group flex items-center rounded-lg px-2 py-2 pl-4 text-gray-700 hover:bg-gray-100/30 hover:text-green-600 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 font-medium transition-colors duration-200 min-h-[40px] dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 ${
                  isCollapsed ? 'w-full max-w-none mx-0' : 'mx-0'
                } gap-3 justify-start`}
              >
                <div className='w-4 h-4 flex items-center justify-center'>
                  <Search className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                </div>
                {!isCollapsed && (
                  <span className='whitespace-nowrap transition-opacity duration-200 opacity-100'>
                    搜索
                  </span>
                )}
                {pendingNavigationHref === '/search' && !isCollapsed ? (
                  <Loader2 className='ml-auto h-3.5 w-3.5 animate-spin text-green-600 dark:text-green-400' />
                ) : null}
              </Link>
              <Link
                href='/downloads'
                prefetch
                onPointerDown={() => handleNavPointerDown('/downloads')}
                onClick={(event) => handleNavClick(event, '/downloads', '下载')}
                onMouseEnter={() => prefetchRoute('/downloads')}
                onFocus={() => prefetchRoute('/downloads')}
                data-active={isPathActive('/downloads')}
                className={`group flex items-center rounded-lg px-2 py-2 pl-4 text-gray-700 hover:bg-gray-100/30 hover:text-green-600 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 font-medium transition-colors duration-200 min-h-[40px] dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 ${
                  isCollapsed ? 'w-full max-w-none mx-0' : 'mx-0'
                } gap-3 justify-start`}
              >
                <div className='w-4 h-4 flex items-center justify-center'>
                  <Download className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                </div>
                {!isCollapsed && (
                  <span className='whitespace-nowrap transition-opacity duration-200 opacity-100'>
                    下载
                  </span>
                )}
                {pendingNavigationHref === '/downloads' && !isCollapsed ? (
                  <Loader2 className='ml-auto h-3.5 w-3.5 animate-spin text-green-600 dark:text-green-400' />
                ) : null}
              </Link>
              {showFollowUpdatesEntry ? (
                <Link
                  href={followUpdatesHref}
                  prefetch
                  onPointerDown={() => handleNavPointerDown(followUpdatesHref)}
                  onClick={(event) =>
                    handleNavClick(event, followUpdatesHref, '追更')
                  }
                  onMouseEnter={() => prefetchRoute(followUpdatesHref)}
                  onFocus={() => prefetchRoute(followUpdatesHref)}
                  data-active={isPathActive(followUpdatesHref)}
                  className={`group flex items-center rounded-lg px-2 py-2 pl-4 text-gray-700 hover:bg-gray-100/30 hover:text-green-600 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 font-medium transition-colors duration-200 min-h-[40px] dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 ${
                    isCollapsed ? 'w-full max-w-none mx-0' : 'mx-0'
                  } gap-3 justify-start`}
                >
                  <div className='w-4 h-4 flex items-center justify-center'>
                    <Clock3 className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                  </div>
                  {!isCollapsed && (
                    <span className='whitespace-nowrap transition-opacity duration-200 opacity-100'>
                      追更
                    </span>
                  )}
                  {pendingNavigationHref === followUpdatesHref &&
                  !isCollapsed ? (
                    <Loader2 className='ml-auto h-3.5 w-3.5 animate-spin text-green-600 dark:text-green-400' />
                  ) : null}
                </Link>
              ) : null}
            </nav>

            {/* 菜单项 */}
            <div className='flex-1 overflow-y-auto px-2 pt-4'>
              <div className='space-y-1'>
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      prefetch
                      onPointerDown={() => handleNavPointerDown(item.href)}
                      onClick={(event) =>
                        handleNavClick(event, item.href, item.label)
                      }
                      onMouseEnter={() => prefetchRoute(item.href)}
                      onFocus={() => prefetchRoute(item.href)}
                      data-active={isPathActive(item.href)}
                      className={`group flex items-center rounded-lg px-2 py-2 pl-4 text-sm text-gray-700 hover:bg-gray-100/30 hover:text-green-600 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 transition-colors duration-200 min-h-[40px] dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 ${
                        isCollapsed ? 'w-full max-w-none mx-0' : 'mx-0'
                      } gap-3 justify-start`}
                    >
                      <div className='w-4 h-4 flex items-center justify-center'>
                        <Icon className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                      </div>
                      {!isCollapsed && (
                        <span className='whitespace-nowrap transition-opacity duration-200 opacity-100'>
                          {item.label}
                        </span>
                      )}
                      {pendingNavigationHref === item.href && !isCollapsed ? (
                        <Loader2 className='ml-auto h-3.5 w-3.5 animate-spin text-green-600 dark:text-green-400' />
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
        <div
          className={`transition-all duration-300 sidebar-offset ${
            isCollapsed ? 'w-16' : 'w-64'
          }`}
        ></div>
      </div>
    </SidebarContext.Provider>
  );
};

export default Sidebar;
