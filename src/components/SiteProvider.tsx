'use client';

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';

import {
  DESKTOP_RUNTIME_UPDATED_EVENT,
  getDesktopSitePresentation,
} from '@/lib/desktop/runtime-config';

const SiteContext = createContext<{ siteName: string; announcement?: string }>({
  // 默认值
  siteName: 'MoonTV',
  announcement:
    '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
});

export const useSite = () => useContext(SiteContext);

export function SiteProvider({
  children,
  siteName,
  announcement,
}: {
  children: ReactNode;
  siteName: string;
  announcement?: string;
}) {
  const [sitePresentation, setSitePresentation] = useState({
    siteName,
    announcement,
  });

  useEffect(() => {
    const applyDesktopSitePresentation = () => {
      const desktopSitePresentation = getDesktopSitePresentation();

      setSitePresentation({
        siteName: desktopSitePresentation.siteName || siteName,
        announcement:
          desktopSitePresentation.announcement !== undefined
            ? desktopSitePresentation.announcement
            : announcement,
      });
    };

    applyDesktopSitePresentation();
    window.addEventListener(
      DESKTOP_RUNTIME_UPDATED_EVENT,
      applyDesktopSitePresentation
    );

    return () => {
      window.removeEventListener(
        DESKTOP_RUNTIME_UPDATED_EVENT,
        applyDesktopSitePresentation
      );
    };
  }, [announcement, siteName]);

  return (
    <SiteContext.Provider value={sitePresentation}>
      {children}
    </SiteContext.Provider>
  );
}
