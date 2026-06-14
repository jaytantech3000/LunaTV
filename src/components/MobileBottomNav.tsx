/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import {
  Cat,
  Clover,
  Download,
  Film,
  Home,
  Loader2,
  Radio,
  Star,
  Tv,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type MouseEvent, useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

import {
  isModifiedNavigationEvent,
  useNavigationFeedback,
} from './NavigationFeedbackProvider';

interface MobileBottomNavProps {
  /**
   * 主动指定当前激活的路径。当未提供时，自动使用 usePathname() 获取的路径。
   */
  activePath?: string;
}

const MobileBottomNav = ({ activePath }: MobileBottomNavProps) => {
  const pathname = usePathname();
  const router = useRouter();
  const { beginNavigation, pendingNavigation } = useNavigationFeedback();

  // 当前激活路径：优先使用传入的 activePath，否则回退到浏览器地址
  const currentActive = activePath ?? pathname;

  const [navItems, setNavItems] = useState([
    { icon: Home, label: '首页', href: '/' },
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
    {
      icon: Radio,
      label: '直播',
      href: '/live',
    },
    {
      icon: Download,
      label: '下载',
      href: '/downloads',
    },
  ]);

  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      setNavItems((prevItems) => [
        ...prevItems,
        {
          icon: Star,
          label: '自定义',
          href: '/douban?type=custom',
        },
      ]);
    }
  }, []);

  const prefetchRoute = useCallback(
    (href: string) => {
      router.prefetch(href);
    },
    [router]
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
    (
      event: MouseEvent<HTMLAnchorElement>,
      href: string,
      label: string
    ) => {
      if (event.defaultPrevented || isModifiedNavigationEvent(event)) {
        return;
      }

      event.preventDefault();
      if (
        decodeURIComponent(currentActive) === decodeURIComponent(href) ||
        pendingNavigationHref === href
      ) {
        return;
      }

      flushSync(() => {
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
      currentActive,
      pendingNavigationHref,
      prefetchRoute,
      pushRouteWithPaint,
    ]
  );

  const isActive = (href: string) => {
    const typeMatch = href.match(/type=([^&]+)/)?.[1];

    // 解码URL以进行正确的比较
    const decodedActive = decodeURIComponent(currentActive);
    const decodedItemHref = decodeURIComponent(href);

    return (
      decodedActive === decodedItemHref ||
      (decodedActive.startsWith('/douban') &&
        decodedActive.includes(`type=${typeMatch}`))
    );
  };

  return (
    <nav
      className='md:hidden fixed left-0 right-0 z-[600] bg-white/90 backdrop-blur-xl border-t border-gray-200/50 overflow-hidden dark:bg-gray-900/80 dark:border-gray-700/50'
      style={{
        /* 紧贴视口底部，同时在内部留出安全区高度 */
        bottom: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
        minHeight: 'calc(3.5rem + env(safe-area-inset-bottom))',
      }}
    >
      <ul className='flex items-center overflow-x-auto scrollbar-hide'>
        {navItems.map((item) => {
          const active = isActive(item.href);
          const isPending = pendingNavigationHref === item.href;
          return (
            <li
              key={item.href}
              className='flex-shrink-0'
              style={{ width: `${100 / navItems.length}vw`, minWidth: `${100 / navItems.length}vw` }}
            >
              <Link
                href={item.href}
                prefetch
                onClick={(event) =>
                  handleNavClick(event, item.href, item.label)
                }
                onPointerDown={() => prefetchRoute(item.href)}
                onMouseEnter={() => prefetchRoute(item.href)}
                onFocus={() => prefetchRoute(item.href)}
                className='flex flex-col items-center justify-center w-full h-14 gap-1 text-xs'
              >
                <div className='relative flex items-center justify-center'>
                  <item.icon
                    className={`h-6 w-6 ${active
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-gray-500 dark:text-gray-400'
                      }`}
                  />
                  {isPending ? (
                    <Loader2 className='absolute -right-2 -top-1 h-3 w-3 animate-spin text-green-500 dark:text-green-400' />
                  ) : null}
                </div>
                <span
                  className={
                    active
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-gray-600 dark:text-gray-300'
                  }
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default MobileBottomNav;
