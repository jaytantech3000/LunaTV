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
import { getRuntimeConfig } from '@/lib/runtime-config';

interface SiteContextValue {
  siteName: string;
  announcement?: string;
  adultContentFilterEnabled: boolean;
}

const SiteContext = createContext<SiteContextValue>({
  siteName: 'MoonTV',
  announcement:
    '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
  adultContentFilterEnabled: true,
});

export const useSite = () => useContext(SiteContext);

export function SiteProvider({
  children,
  siteName,
  announcement,
  adultContentFilterEnabled = true,
}: {
  children: ReactNode;
  siteName: string;
  announcement?: string;
  adultContentFilterEnabled?: boolean;
}) {
  const [sitePresentation, setSitePresentation] = useState({
    siteName,
    announcement,
    adultContentFilterEnabled,
  });

  useEffect(() => {
    const applyDesktopSitePresentation = () => {
      const desktopSitePresentation = getDesktopSitePresentation();
      const runtimeConfig = getRuntimeConfig();

      setSitePresentation({
        siteName: desktopSitePresentation.siteName || siteName,
        announcement:
          desktopSitePresentation.announcement !== undefined
            ? desktopSitePresentation.announcement
            : announcement,
        adultContentFilterEnabled:
          runtimeConfig.DISABLE_YELLOW_FILTER === undefined
            ? adultContentFilterEnabled
            : !runtimeConfig.DISABLE_YELLOW_FILTER,
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
  }, [adultContentFilterEnabled, announcement, siteName]);

  return (
    <SiteContext.Provider value={sitePresentation}>
      {children}
    </SiteContext.Provider>
  );
}
