/* eslint-disable no-console,@typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

'use client';

import {
  Check,
  ChevronDown,
  Cloud,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Settings,
  Shield,
  User,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';

import {
  BROWSER_AUTH_UPDATED_EVENT,
  getAuthInfoFromBrowserCookie,
} from '@/lib/auth';
import {
  buildLoginPath,
  getDesktopAuthRequirement,
  logoutDesktopSession,
} from '@/lib/desktop/auth-session';
import { DESKTOP_RUNTIME_UPDATED_EVENT } from '@/lib/desktop/runtime-config';
import { changeDesktopPassword } from '@/lib/desktop/tauri-client';
import { purgeOfflineDownloads } from '@/lib/download/session';
import {
  getDefaultFluidSearchSetting,
  getPreferredFluidSearchSetting,
  isFluidSearchSupported,
  setPreferredFluidSearchSetting,
} from '@/lib/fluid-search';
import {
  AUDIO_SPIKE_PROTECTION_LEVEL_OPTIONS,
  AudioSpikeProtectionLevel,
  VISUAL_ENHANCEMENT_LEVEL_OPTIONS,
  VisualEnhancementLevel,
} from '@/lib/player-enhancement-types';
import {
  PLAYER_ENHANCEMENTS_UPDATED_EVENT,
  readPlayerEnhancementPreferences,
  resetPlayerEnhancementPreferences,
  updatePlayerEnhancementPreference,
} from '@/lib/player-enhancements';
import { resolveProfileRuntime } from '@/lib/profile/runtime';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { acquireScrollLock } from '@/lib/scroll-lock';
import { apiFetch } from '@/lib/transport/api-client';
import { useAppUpdateState } from '@/lib/use-app-update';
import { CURRENT_VERSION } from '@/lib/version';
import { UpdateStatus } from '@/lib/version_check';

import DesktopSettingsSection from './DesktopSettingsSection';
import { useNavigationFeedback } from './NavigationFeedbackProvider';
import { VersionPanel } from './VersionPanel';

interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
}

export const UserMenu: React.FC = () => {
  const router = useRouter();
  const { beginNavigation, pendingNavigation } = useNavigationFeedback();
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isVersionPanelOpen, setIsVersionPanelOpen] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [storageType, setStorageType] = useState<string>('localstorage');
  const [adminPanelEnabled, setAdminPanelEnabled] = useState(true);
  const [isDesktopTarget, setIsDesktopTarget] = useState(false);
  const [desktopProfileSyncEnabled, setDesktopProfileSyncEnabled] =
    useState(false);
  const [desktopAuthRequired, setDesktopAuthRequired] = useState(false);
  const [desktopAuthUsername, setDesktopAuthUsername] = useState('');
  const [desktopOwnerPasswordConfigured, setDesktopOwnerPasswordConfigured] =
    useState(false);
  const [supportsFluidSearch, setSupportsFluidSearch] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Body 滚动锁定 - 使用 overflow 方式避免布局问题
  useEffect(() => {
    if (isSettingsOpen || isChangePasswordOpen) {
      return acquireScrollLock({
        lockHtml: true,
      });
    }
  }, [isSettingsOpen, isChangePasswordOpen]);

  // 设置相关状态
  const [defaultAggregateSearch, setDefaultAggregateSearch] = useState(true);
  const [doubanProxyUrl, setDoubanProxyUrl] = useState('');
  const [enableOptimization, setEnableOptimization] = useState(true);
  const [fluidSearch, setFluidSearch] = useState(true);
  const [liveDirectConnect, setLiveDirectConnect] = useState(false);
  const [audioSpikeProtectionLevel, setAudioSpikeProtectionLevel] =
    useState<AudioSpikeProtectionLevel>('off');
  const [audioDynamicProtectionEnabled, setAudioDynamicProtectionEnabled] =
    useState(false);
  const [audioFixedCeilingEnabled, setAudioFixedCeilingEnabled] =
    useState(false);
  const [visualEnhancementLevel, setVisualEnhancementLevel] =
    useState<VisualEnhancementLevel>('off');
  const [doubanDataSource, setDoubanDataSource] = useState(
    'cmliussss-cdn-tencent'
  );
  const [doubanImageProxyType, setDoubanImageProxyType] = useState(
    'cmliussss-cdn-tencent'
  );
  const [doubanImageProxyUrl, setDoubanImageProxyUrl] = useState('');
  const [isDoubanDropdownOpen, setIsDoubanDropdownOpen] = useState(false);
  const [isDoubanImageProxyDropdownOpen, setIsDoubanImageProxyDropdownOpen] =
    useState(false);

  // 豆瓣数据源选项
  const doubanDataSourceOptions = [
    { value: 'direct', label: '直连（服务器直接请求豆瓣）' },
    { value: 'cors-proxy-zwei', label: 'Cors Proxy By Zwei' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（腾讯云）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
    { value: 'custom', label: '自定义代理' },
  ];
  const availableDoubanDataSourceOptions = isDesktopTarget
    ? doubanDataSourceOptions.filter((option) => option.value !== 'direct')
    : doubanDataSourceOptions;

  // 豆瓣图片代理选项
  const doubanImageProxyTypeOptions = [
    { value: 'server', label: '服务器代理（由服务器代理请求豆瓣）' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（腾讯云）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
    { value: 'custom', label: '自定义代理' },
  ];
  const availableDoubanImageProxyTypeOptions = isDesktopTarget
    ? doubanImageProxyTypeOptions.filter((option) => option.value !== 'server')
    : doubanImageProxyTypeOptions;

  // 修改密码相关状态
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');
  const updateState = useAppUpdateState();
  const updateStatus = updateState.updateStatus;

  // 确保组件已挂载
  useEffect(() => {
    setMounted(true);
  }, []);

  // 获取认证信息和存储类型
  useEffect(() => {
    let active = true;

    const syncMenuState = async () => {
      if (typeof window === 'undefined') {
        return;
      }

      const auth = getAuthInfoFromBrowserCookie();
      const runtimeConfig = getRuntimeConfig();
      const profileRuntime = resolveProfileRuntime(runtimeConfig);
      const isDesktop = profileRuntime.appTarget === 'desktop';
      const profileSyncEnabled =
        profileRuntime.runtimeKind === 'desktop-profile-sync';
      if (!active) {
        return;
      }

      setAuthInfo(auth);
      setStorageType(profileRuntime.storageType);
      setAdminPanelEnabled(runtimeConfig.ENABLE_ADMIN_PANEL !== false);
      setIsDesktopTarget(isDesktop);
      setDesktopProfileSyncEnabled(profileSyncEnabled);
      setSupportsFluidSearch(isFluidSearchSupported(runtimeConfig));

      if (!isDesktop || profileSyncEnabled) {
        setDesktopAuthRequired(false);
        setDesktopAuthUsername('');
        setDesktopOwnerPasswordConfigured(false);
        return;
      }

      try {
        const authRequirement = await getDesktopAuthRequirement();
        if (!active || !authRequirement) {
          return;
        }

        setDesktopAuthRequired(authRequirement.passwordRequired);
        setDesktopAuthUsername(authRequirement.username);
        setDesktopOwnerPasswordConfigured(
          authRequirement.ownerPasswordConfigured
        );
      } catch (_) {
        if (!active) {
          return;
        }

        setDesktopAuthRequired(false);
        setDesktopAuthUsername('');
        setDesktopOwnerPasswordConfigured(false);
      }
    };

    void syncMenuState();
    window.addEventListener(BROWSER_AUTH_UPDATED_EVENT, syncMenuState);

    return () => {
      active = false;
      window.removeEventListener(BROWSER_AUTH_UPDATED_EVENT, syncMenuState);
    };
  }, []);

  // 从 localStorage 读取设置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const runtimeConfig = getRuntimeConfig();
      const savedAggregateSearch = localStorage.getItem(
        'defaultAggregateSearch'
      );
      if (savedAggregateSearch !== null) {
        setDefaultAggregateSearch(JSON.parse(savedAggregateSearch));
      }

      const savedDoubanDataSource = localStorage.getItem('doubanDataSource');
      const defaultDoubanProxyType =
        (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE ||
        'cmliussss-cdn-tencent';
      const normalizedDesktopDoubanProxyType =
        runtimeConfig.APP_TARGET === 'desktop' &&
        defaultDoubanProxyType === 'direct'
          ? 'cmliussss-cdn-tencent'
          : defaultDoubanProxyType;
      if (savedDoubanDataSource !== null) {
        const normalizedSavedDoubanDataSource =
          runtimeConfig.APP_TARGET === 'desktop' &&
          savedDoubanDataSource === 'direct'
            ? 'cmliussss-cdn-tencent'
            : savedDoubanDataSource;
        setDoubanDataSource(normalizedSavedDoubanDataSource);
        if (normalizedSavedDoubanDataSource !== savedDoubanDataSource) {
          localStorage.setItem(
            'doubanDataSource',
            normalizedSavedDoubanDataSource
          );
        }
      } else if (normalizedDesktopDoubanProxyType) {
        setDoubanDataSource(normalizedDesktopDoubanProxyType);
      }

      const savedDoubanProxyUrl = localStorage.getItem('doubanProxyUrl');
      const defaultDoubanProxy =
        (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY || '';
      if (savedDoubanProxyUrl !== null) {
        setDoubanProxyUrl(savedDoubanProxyUrl);
      } else if (defaultDoubanProxy) {
        setDoubanProxyUrl(defaultDoubanProxy);
      }

      const savedDoubanImageProxyType = localStorage.getItem(
        'doubanImageProxyType'
      );
      const defaultDoubanImageProxyType =
        (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE ||
        'cmliussss-cdn-tencent';
      // 兼容历史数据：直连和豆瓣官方精品 CDN 统一使用服务器代理
      const normalizeImageProxyType = (type: string) =>
        type === 'direct' || type === 'img3' ? 'server' : type;
      const normalizeDesktopImageProxyType = (type: string) =>
        runtimeConfig.APP_TARGET === 'desktop' && type === 'server'
          ? 'cmliussss-cdn-tencent'
          : type;
      if (savedDoubanImageProxyType !== null) {
        const normalizedSavedDoubanImageProxyType =
          normalizeDesktopImageProxyType(
            normalizeImageProxyType(savedDoubanImageProxyType)
          );
        setDoubanImageProxyType(normalizedSavedDoubanImageProxyType);
        if (
          normalizedSavedDoubanImageProxyType !==
          normalizeImageProxyType(savedDoubanImageProxyType)
        ) {
          localStorage.setItem(
            'doubanImageProxyType',
            normalizedSavedDoubanImageProxyType
          );
        }
      } else if (defaultDoubanImageProxyType) {
        setDoubanImageProxyType(
          normalizeDesktopImageProxyType(
            normalizeImageProxyType(defaultDoubanImageProxyType)
          )
        );
      }

      const savedDoubanImageProxyUrl = localStorage.getItem(
        'doubanImageProxyUrl'
      );
      const defaultDoubanImageProxyUrl =
        (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY || '';
      if (savedDoubanImageProxyUrl !== null) {
        setDoubanImageProxyUrl(savedDoubanImageProxyUrl);
      } else if (defaultDoubanImageProxyUrl) {
        setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);
      }

      const savedEnableOptimization =
        localStorage.getItem('enableOptimization');
      if (savedEnableOptimization !== null) {
        setEnableOptimization(JSON.parse(savedEnableOptimization));
      }

      const savedFluidSearch = localStorage.getItem('fluidSearch');
      if (!supportsFluidSearch) {
        setFluidSearch(false);
        setPreferredFluidSearchSetting(false);
      } else if (savedFluidSearch !== null) {
        setFluidSearch(getPreferredFluidSearchSetting());
      } else {
        setFluidSearch(getPreferredFluidSearchSetting());
      }

      const savedLiveDirectConnect = localStorage.getItem('liveDirectConnect');
      if (savedLiveDirectConnect !== null) {
        setLiveDirectConnect(JSON.parse(savedLiveDirectConnect));
      }
    }
  }, [supportsFluidSearch]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const syncPlayerEnhancementPreferences = () => {
      const preferences = readPlayerEnhancementPreferences(getRuntimeConfig());
      setAudioSpikeProtectionLevel(preferences.audioSpikeProtectionLevel);
      setAudioDynamicProtectionEnabled(
        preferences.audioDynamicProtectionEnabled
      );
      setAudioFixedCeilingEnabled(preferences.audioFixedCeilingEnabled);
      setVisualEnhancementLevel(preferences.visualEnhancementLevel);
    };

    syncPlayerEnhancementPreferences();
    window.addEventListener(
      PLAYER_ENHANCEMENTS_UPDATED_EVENT,
      syncPlayerEnhancementPreferences
    );
    window.addEventListener(
      DESKTOP_RUNTIME_UPDATED_EVENT,
      syncPlayerEnhancementPreferences
    );

    return () => {
      window.removeEventListener(
        PLAYER_ENHANCEMENTS_UPDATED_EVENT,
        syncPlayerEnhancementPreferences
      );
      window.removeEventListener(
        DESKTOP_RUNTIME_UPDATED_EVENT,
        syncPlayerEnhancementPreferences
      );
    };
  }, []);

  const prefetchRoute = useCallback(
    (href: string) => {
      router.prefetch(href);
    },
    [router]
  );

  // 点击外部区域关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-datasource"]')) {
          setIsDoubanDropdownOpen(false);
        }
      }
    };

    if (isDoubanDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanImageProxyDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-image-proxy"]')) {
          setIsDoubanImageProxyDropdownOpen(false);
        }
      }
    };

    if (isDoubanImageProxyDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanImageProxyDropdownOpen]);

  const handleMenuClick = () => {
    setIsOpen(!isOpen);
  };

  const handleCloseMenu = () => {
    setIsOpen(false);
  };

  const openChangePasswordDialog = (notice = '') => {
    setIsChangePasswordOpen(true);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setPasswordNotice(notice);
  };

  const handleLogin = () => {
    setIsOpen(false);
    const currentPath =
      typeof window === 'undefined'
        ? '/'
        : `${window.location.pathname}${window.location.search}`;
    router.push(buildLoginPath(currentPath));
  };

  const handleLogout = async (options?: {
    skipPasswordSetupCheck?: boolean;
  }) => {
    setIsOpen(false);
    const logoutRedirectPath = isDesktopTarget ? buildLoginPath('/') : '/';
    const shouldRequireOwnerPasswordSetup =
      !options?.skipPasswordSetupCheck &&
      isDesktopTarget &&
      !desktopProfileSyncEnabled &&
      authInfo?.role === 'owner' &&
      !desktopOwnerPasswordConfigured;

    if (shouldRequireOwnerPasswordSetup) {
      openChangePasswordDialog('请先为站长设置密码，再退出当前账号。');
      return;
    }

    try {
      await purgeOfflineDownloads();
    } catch (error) {
      console.error('清理离线下载失败:', error);
    }

    if (isDesktopTarget && !desktopProfileSyncEnabled) {
      logoutDesktopSession({
        rememberLoggedOut: true,
      });
      window.location.href = logoutRedirectPath;
      return;
    }

    try {
      await apiFetch('/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('注销请求失败:', error);
    }

    if (isDesktopTarget) {
      logoutDesktopSession();
      window.location.href = logoutRedirectPath;
      return;
    }

    window.location.href = logoutRedirectPath;
  };

  const handleAdminPanel = () => {
    if (
      pendingNavigation?.kind === 'nav' &&
      pendingNavigation.href === '/admin'
    ) {
      setIsOpen(false);
      return;
    }

    flushSync(() => {
      setIsOpen(false);
      beginNavigation({
        href: '/admin',
        kind: 'nav',
        label: '管理面板',
      });
    });
    prefetchRoute('/admin');
    window.setTimeout(() => {
      router.push('/admin');
    }, 0);
  };

  const handleDesktopAccountSync = () => {
    if (
      pendingNavigation?.kind === 'nav' &&
      pendingNavigation.href === '/desktop-admin'
    ) {
      setIsOpen(false);
      return;
    }

    flushSync(() => {
      setIsOpen(false);
      beginNavigation({
        href: '/desktop-admin',
        kind: 'nav',
        label: '帐号同步',
      });
    });
    prefetchRoute('/desktop-admin');
    window.setTimeout(() => {
      router.push('/desktop-admin');
    }, 0);
  };

  const handleChangePassword = () => {
    setIsOpen(false);
    openChangePasswordDialog();
  };

  const handleCloseChangePassword = () => {
    setIsChangePasswordOpen(false);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setPasswordNotice('');
  };

  const submitPasswordChange = async () => {
    setPasswordError('');
    const normalizedNewPassword = newPassword.trim();
    const normalizedConfirmPassword = confirmPassword.trim();

    if (!normalizedNewPassword) {
      setPasswordError('新密码不能为空');
      return;
    }

    if (normalizedNewPassword !== normalizedConfirmPassword) {
      setPasswordError('两次输入的密码不一致');
      return;
    }

    setPasswordLoading(true);

    try {
      if (isDesktopTarget && !desktopProfileSyncEnabled) {
        if (!authInfo?.username) {
          setPasswordError('当前未登录，无法修改密码');
          return;
        }

        const nextAuthStatus = await changeDesktopPassword(
          authInfo.username,
          normalizedNewPassword
        );
        setDesktopAuthRequired(nextAuthStatus.passwordRequired);
        setDesktopAuthUsername(nextAuthStatus.username);
        setDesktopOwnerPasswordConfigured(
          nextAuthStatus.ownerPasswordConfigured
        );
      } else {
        const response = await apiFetch('/change-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            newPassword: normalizedNewPassword,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          setPasswordError(data.error || '修改密码失败');
          return;
        }
      }

      setIsChangePasswordOpen(false);
      setPasswordNotice('');
      await handleLogout({
        skipPasswordSetupCheck: true,
      });
    } catch (_) {
      setPasswordError('网络错误，请稍后重试');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSubmitChangePassword = async () => submitPasswordChange();

  const handleSettings = () => {
    setIsOpen(false);
    setIsSettingsOpen(true);
  };

  const handleCloseSettings = () => {
    setIsSettingsOpen(false);
  };

  // 设置相关的处理函数
  const handleAggregateToggle = (value: boolean) => {
    setDefaultAggregateSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(value));
    }
  };

  const handleDoubanProxyUrlChange = (value: string) => {
    setDoubanProxyUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanProxyUrl', value);
    }
  };

  const handleOptimizationToggle = (value: boolean) => {
    setEnableOptimization(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableOptimization', JSON.stringify(value));
    }
  };

  const handleFluidSearchToggle = (value: boolean) => {
    if (!supportsFluidSearch) {
      setFluidSearch(false);
      return;
    }

    setFluidSearch(value);
    setPreferredFluidSearchSetting(value);
  };

  const handleLiveDirectConnectToggle = (value: boolean) => {
    setLiveDirectConnect(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('liveDirectConnect', JSON.stringify(value));
    }
  };

  const handleAudioSpikeProtectionLevelChange = (
    value: AudioSpikeProtectionLevel
  ) => {
    setAudioSpikeProtectionLevel(value);
    updatePlayerEnhancementPreference('audioSpikeProtectionLevel', value);
  };

  const handleAudioDynamicProtectionToggle = (value: boolean) => {
    setAudioDynamicProtectionEnabled(value);
    updatePlayerEnhancementPreference('audioDynamicProtectionEnabled', value);
  };

  const handleAudioFixedCeilingToggle = (value: boolean) => {
    setAudioFixedCeilingEnabled(value);
    updatePlayerEnhancementPreference('audioFixedCeilingEnabled', value);
  };

  const handleVisualEnhancementLevelChange = (
    value: VisualEnhancementLevel
  ) => {
    setVisualEnhancementLevel(value);
    updatePlayerEnhancementPreference('visualEnhancementLevel', value);
  };

  const handleDoubanDataSourceChange = (value: string) => {
    setDoubanDataSource(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanDataSource', value);
    }
  };

  const handleDoubanImageProxyTypeChange = (value: string) => {
    setDoubanImageProxyType(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyType', value);
    }
  };

  const handleDoubanImageProxyUrlChange = (value: string) => {
    setDoubanImageProxyUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyUrl', value);
    }
  };

  // 获取感谢信息
  const getThanksInfo = (dataSource: string) => {
    switch (dataSource) {
      case 'cors-proxy-zwei':
        return {
          text: 'Thanks to @Zwei',
          url: 'https://github.com/bestzwei',
        };
      case 'cmliussss-cdn-tencent':
      case 'cmliussss-cdn-ali':
        return {
          text: 'Thanks to @CMLiussss',
          url: 'https://github.com/cmliu',
        };
      default:
        return null;
    }
  };

  const handleResetSettings = () => {
    const defaultDoubanProxyType =
      (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE ||
      'cmliussss-cdn-tencent';
    const normalizedDesktopDoubanProxyType =
      isDesktopTarget && defaultDoubanProxyType === 'direct'
        ? 'cmliussss-cdn-tencent'
        : defaultDoubanProxyType;
    const defaultDoubanProxy =
      (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY || '';
    let defaultDoubanImageProxyType =
      (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE ||
      'cmliussss-cdn-tencent';
    if (
      defaultDoubanImageProxyType === 'direct' ||
      defaultDoubanImageProxyType === 'img3'
    ) {
      defaultDoubanImageProxyType = 'server';
    }
    if (isDesktopTarget && defaultDoubanImageProxyType === 'server') {
      defaultDoubanImageProxyType = 'cmliussss-cdn-tencent';
    }
    const defaultDoubanImageProxyUrl =
      (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY || '';
    const runtimeConfig = getRuntimeConfig();
    const defaultFluidSearch =
      supportsFluidSearch && getDefaultFluidSearchSetting(runtimeConfig);
    const defaultEnhancementPreferences =
      resetPlayerEnhancementPreferences(runtimeConfig);

    setDefaultAggregateSearch(true);
    setEnableOptimization(true);
    setFluidSearch(defaultFluidSearch);
    setLiveDirectConnect(false);
    setAudioSpikeProtectionLevel(
      defaultEnhancementPreferences.audioSpikeProtectionLevel
    );
    setAudioDynamicProtectionEnabled(
      defaultEnhancementPreferences.audioDynamicProtectionEnabled
    );
    setAudioFixedCeilingEnabled(
      defaultEnhancementPreferences.audioFixedCeilingEnabled
    );
    setVisualEnhancementLevel(
      defaultEnhancementPreferences.visualEnhancementLevel
    );
    setDoubanProxyUrl(defaultDoubanProxy);
    setDoubanDataSource(normalizedDesktopDoubanProxyType);
    setDoubanImageProxyType(defaultDoubanImageProxyType);
    setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);

    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(true));
      localStorage.setItem('enableOptimization', JSON.stringify(true));
      setPreferredFluidSearchSetting(defaultFluidSearch);
      localStorage.setItem('liveDirectConnect', JSON.stringify(false));
      localStorage.setItem('doubanProxyUrl', defaultDoubanProxy);
      localStorage.setItem(
        'doubanDataSource',
        normalizedDesktopDoubanProxyType
      );
      localStorage.setItem('doubanImageProxyType', defaultDoubanImageProxyType);
      localStorage.setItem('doubanImageProxyUrl', defaultDoubanImageProxyUrl);
    }
  };

  const isOpeningAdmin =
    pendingNavigation?.kind === 'nav' && pendingNavigation.href === '/admin';
  const isOpeningDesktopAccountSync =
    pendingNavigation?.kind === 'nav' &&
    pendingNavigation.href === '/desktop-admin';

  // 检查是否显示管理面板按钮
  const isAuthenticated = Boolean(authInfo?.username);
  const isDesktopLocalAuthMode = isDesktopTarget && !desktopProfileSyncEnabled;
  const showAdminPanel = isDesktopTarget
    ? isAuthenticated &&
      (authInfo?.role === 'owner' || authInfo?.role === 'admin')
    : adminPanelEnabled &&
      (authInfo?.role === 'owner' || authInfo?.role === 'admin');
  const showDesktopAccountSyncEntry = isDesktopTarget && showAdminPanel;

  // 检查是否显示修改密码按钮
  const showChangePassword =
    isAuthenticated &&
    (isDesktopLocalAuthMode || storageType !== 'localstorage');
  const showLoginAction = !isAuthenticated;
  const showLogoutAction = isAuthenticated;

  useEffect(() => {
    if (!isOpen || !showAdminPanel) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      prefetchRoute('/admin');
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isOpen, prefetchRoute, showAdminPanel]);

  useEffect(() => {
    if (typeof window === 'undefined' || !showAdminPanel) {
      return;
    }

    const requestIdleCallbackFn = window.requestIdleCallback?.bind(window);
    const cancelIdleCallbackFn = window.cancelIdleCallback?.bind(window);

    if (requestIdleCallbackFn && cancelIdleCallbackFn) {
      const idleCallbackId = requestIdleCallbackFn(() => {
        prefetchRoute('/admin');
      });

      return () => {
        cancelIdleCallbackFn(idleCallbackId);
      };
    }

    const timeoutId = window.setTimeout(() => {
      prefetchRoute('/admin');
    }, 1200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [prefetchRoute, showAdminPanel]);

  // 角色中文映射
  const getRoleText = (role?: string) => {
    switch (role) {
      case 'owner':
        return '站长';
      case 'admin':
        return '管理员';
      case 'user':
        return '用户';
      default:
        return '未登录';
    }
  };

  // 菜单面板内容
  const menuPanel = (
    <>
      {/* 背景遮罩 - 普通菜单无需模糊 */}
      <div
        className='fixed inset-0 bg-transparent z-[1000]'
        onClick={handleCloseMenu}
      />

      {/* 菜单面板 */}
      <div className='fixed top-14 right-4 w-56 bg-white dark:bg-gray-900 rounded-lg shadow-xl z-[1001] border border-gray-200/50 dark:border-gray-700/50 overflow-hidden select-none'>
        {/* 用户信息区域 */}
        <div className='px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-gray-100/50 dark:from-gray-800 dark:to-gray-800/50'>
          <div className='space-y-1'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                当前用户
              </span>
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                  !isAuthenticated
                    ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                    : (authInfo?.role || 'user') === 'owner'
                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                    : (authInfo?.role || 'user') === 'admin'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                }`}
              >
                {isAuthenticated
                  ? getRoleText(authInfo?.role || 'user')
                  : '未登录'}
              </span>
            </div>
            <div className='flex items-center justify-between'>
              <div className='font-semibold text-gray-900 dark:text-gray-100 text-sm truncate'>
                {authInfo?.username || '未登录'}
              </div>
              <div className='text-[10px] text-gray-400 dark:text-gray-500'>
                数据存储：
                {storageType === 'localstorage' ? '本地' : storageType}
              </div>
            </div>
            {!isAuthenticated &&
            isDesktopTarget &&
            !desktopProfileSyncEnabled &&
            desktopAuthRequired &&
            desktopAuthUsername ? (
              <div className='text-[11px] text-gray-500 dark:text-gray-400'>
                本地管理账号：{desktopAuthUsername}
              </div>
            ) : null}
          </div>
        </div>

        {/* 菜单项 */}
        <div className='py-1'>
          {/* 设置按钮 */}
          <button
            onClick={handleSettings}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
          >
            <Settings className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>设置</span>
          </button>

          {/* 管理面板按钮 */}
          {showAdminPanel && (
            <button
              onClick={handleAdminPanel}
              onPointerDown={() => prefetchRoute('/admin')}
              onMouseEnter={() => prefetchRoute('/admin')}
              onFocus={() => prefetchRoute('/admin')}
              disabled={isOpeningAdmin}
              aria-busy={isOpeningAdmin}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm disabled:cursor-progress disabled:opacity-80'
            >
              <div className='relative flex h-4 w-4 items-center justify-center'>
                <Shield className='h-4 w-4 text-gray-500 dark:text-gray-400' />
                {isOpeningAdmin ? (
                  <Loader2 className='absolute -right-1.5 -top-1.5 h-3 w-3 animate-spin text-emerald-500 dark:text-emerald-400' />
                ) : null}
              </div>
              <span className='font-medium'>
                {isOpeningAdmin ? '正在打开管理面板...' : '管理面板'}
              </span>
            </button>
          )}

          {showDesktopAccountSyncEntry && (
            <button
              onClick={handleDesktopAccountSync}
              onPointerDown={() => prefetchRoute('/desktop-admin')}
              onMouseEnter={() => prefetchRoute('/desktop-admin')}
              onFocus={() => prefetchRoute('/desktop-admin')}
              disabled={isOpeningDesktopAccountSync}
              aria-busy={isOpeningDesktopAccountSync}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm disabled:cursor-progress disabled:opacity-80'
            >
              <div className='relative flex h-4 w-4 items-center justify-center'>
                <Cloud className='h-4 w-4 text-gray-500 dark:text-gray-400' />
                {isOpeningDesktopAccountSync ? (
                  <Loader2 className='absolute -right-1.5 -top-1.5 h-3 w-3 animate-spin text-emerald-500 dark:text-emerald-400' />
                ) : null}
              </div>
              <span className='font-medium'>
                {isOpeningDesktopAccountSync
                  ? '正在打开帐号同步...'
                  : '帐号同步'}
              </span>
            </button>
          )}

          {/* 修改密码按钮 */}
          {showChangePassword && (
            <button
              onClick={handleChangePassword}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
            >
              <KeyRound className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>修改密码</span>
            </button>
          )}

          {showLoginAction || showLogoutAction || showChangePassword ? (
            <div className='my-1 border-t border-gray-200 dark:border-gray-700'></div>
          ) : null}

          {showLoginAction ? (
            <button
              onClick={handleLogin}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors text-sm'
            >
              <LogIn className='w-4 h-4' />
              <span className='font-medium'>登录</span>
            </button>
          ) : null}

          {showLogoutAction ? (
            <button
              onClick={() => void handleLogout()}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm'
            >
              <LogOut className='w-4 h-4' />
              <span className='font-medium'>登出</span>
            </button>
          ) : null}

          <div className='my-1 border-t border-gray-200 dark:border-gray-700'></div>

          {/* 版本信息 */}
          <button
            onClick={() => {
              setIsVersionPanelOpen(true);
              handleCloseMenu();
            }}
            className='w-full px-3 py-2 text-center flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-xs'
          >
            <div className='flex items-center gap-1'>
              <span className='font-mono'>v{CURRENT_VERSION}</span>
              {!updateState.isChecking &&
                updateStatus &&
                updateStatus !== UpdateStatus.FETCH_FAILED && (
                  <div
                    className={`w-2 h-2 rounded-full -translate-y-2 ${
                      updateStatus === UpdateStatus.HAS_UPDATE
                        ? 'bg-yellow-500'
                        : updateStatus === UpdateStatus.NO_UPDATE
                        ? 'bg-green-400'
                        : ''
                    }`}
                  ></div>
                )}
            </div>
          </button>
        </div>
      </div>
    </>
  );

  // 设置面板内容
  const settingsPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={handleCloseSettings}
        onTouchMove={(e) => {
          // 只阻止滚动，允许其他触摸事件
          e.preventDefault();
        }}
        onWheel={(e) => {
          // 阻止滚轮滚动
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 设置面板 */}
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] flex flex-col'>
        {/* 内容容器 - 独立的滚动区域 */}
        <div
          className='flex-1 p-6 overflow-y-auto'
          data-panel-content
          style={{
            touchAction: 'pan-y', // 只允许垂直滚动
            overscrollBehavior: 'contain', // 防止滚动冒泡
          }}
        >
          {/* 标题栏 */}
          <div className='flex items-center justify-between mb-6'>
            <div className='flex items-center gap-3'>
              <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                本地设置
              </h3>
              <button
                onClick={handleResetSettings}
                className='px-2 py-1 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border border-red-200 hover:border-red-300 dark:border-red-800 dark:hover:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors'
                title='重置为默认设置'
              >
                恢复默认
              </button>
            </div>
            <button
              onClick={handleCloseSettings}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 设置项 */}
          <div className='space-y-6'>
            {/* 豆瓣数据源选择 */}
            <div className='space-y-3'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  豆瓣数据代理
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  {isDesktopTarget
                    ? '桌面版当前支持 CDN 和自定义代理；直连模式待本地服务接入后开放'
                    : '选择获取豆瓣数据的方式'}
                </p>
              </div>
              <div className='relative' data-dropdown='douban-datasource'>
                {/* 自定义下拉选择框 */}
                <button
                  type='button'
                  onClick={() => setIsDoubanDropdownOpen(!isDoubanDropdownOpen)}
                  className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
                >
                  {availableDoubanDataSourceOptions.find(
                    (option) => option.value === doubanDataSource
                  )?.label || availableDoubanDataSourceOptions[0]?.label}
                </button>

                {/* 下拉箭头 */}
                <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                  <ChevronDown
                    className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                      isDoubanDropdownOpen ? 'rotate-180' : ''
                    }`}
                  />
                </div>

                {/* 下拉选项列表 */}
                {isDoubanDropdownOpen && (
                  <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                    {availableDoubanDataSourceOptions.map((option) => (
                      <button
                        key={option.value}
                        type='button'
                        onClick={() => {
                          handleDoubanDataSourceChange(option.value);
                          setIsDoubanDropdownOpen(false);
                        }}
                        className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                          doubanDataSource === option.value
                            ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                            : 'text-gray-900 dark:text-gray-100'
                        }`}
                      >
                        <span className='truncate'>{option.label}</span>
                        {doubanDataSource === option.value && (
                          <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 感谢信息 */}
              {getThanksInfo(doubanDataSource) && (
                <div className='mt-3'>
                  <button
                    type='button'
                    onClick={() =>
                      window.open(
                        getThanksInfo(doubanDataSource)!.url,
                        '_blank'
                      )
                    }
                    className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
                  >
                    <span className='font-medium'>
                      {getThanksInfo(doubanDataSource)!.text}
                    </span>
                    <ExternalLink className='w-3.5 opacity-70' />
                  </button>
                </div>
              )}
            </div>

            {/* 豆瓣代理地址设置 - 仅在选择自定义代理时显示 */}
            {doubanDataSource === 'custom' && (
              <div className='space-y-3'>
                <div>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    豆瓣代理地址
                  </h4>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    自定义代理服务器地址
                  </p>
                </div>
                <input
                  type='text'
                  className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                  placeholder='例如: https://proxy.example.com/fetch?url='
                  value={doubanProxyUrl}
                  onChange={(e) => handleDoubanProxyUrlChange(e.target.value)}
                />
              </div>
            )}

            {/* 分割线 */}
            <div className='border-t border-gray-200 dark:border-gray-700'></div>

            {/* 豆瓣图片代理设置 */}
            <div className='space-y-3'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  豆瓣图片代理
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  {isDesktopTarget
                    ? '桌面版当前支持 CDN 和自定义图片代理；服务端图片代理待本地服务接入后开放'
                    : '选择获取豆瓣图片的方式'}
                </p>
              </div>
              <div className='relative' data-dropdown='douban-image-proxy'>
                {/* 自定义下拉选择框 */}
                <button
                  type='button'
                  onClick={() =>
                    setIsDoubanImageProxyDropdownOpen(
                      !isDoubanImageProxyDropdownOpen
                    )
                  }
                  className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
                >
                  {availableDoubanImageProxyTypeOptions.find(
                    (option) => option.value === doubanImageProxyType
                  )?.label || availableDoubanImageProxyTypeOptions[0]?.label}
                </button>

                {/* 下拉箭头 */}
                <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                  <ChevronDown
                    className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                      isDoubanDropdownOpen ? 'rotate-180' : ''
                    }`}
                  />
                </div>

                {/* 下拉选项列表 */}
                {isDoubanImageProxyDropdownOpen && (
                  <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                    {availableDoubanImageProxyTypeOptions.map((option) => (
                      <button
                        key={option.value}
                        type='button'
                        onClick={() => {
                          handleDoubanImageProxyTypeChange(option.value);
                          setIsDoubanImageProxyDropdownOpen(false);
                        }}
                        className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                          doubanImageProxyType === option.value
                            ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                            : 'text-gray-900 dark:text-gray-100'
                        }`}
                      >
                        <span className='truncate'>{option.label}</span>
                        {doubanImageProxyType === option.value && (
                          <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 感谢信息 */}
              {getThanksInfo(doubanImageProxyType) && (
                <div className='mt-3'>
                  <button
                    type='button'
                    onClick={() =>
                      window.open(
                        getThanksInfo(doubanImageProxyType)!.url,
                        '_blank'
                      )
                    }
                    className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
                  >
                    <span className='font-medium'>
                      {getThanksInfo(doubanImageProxyType)!.text}
                    </span>
                    <ExternalLink className='w-3.5 opacity-70' />
                  </button>
                </div>
              )}
            </div>

            {/* 豆瓣图片代理地址设置 - 仅在选择自定义代理时显示 */}
            {doubanImageProxyType === 'custom' && (
              <div className='space-y-3'>
                <div>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    豆瓣图片代理地址
                  </h4>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    自定义图片代理服务器地址
                  </p>
                </div>
                <input
                  type='text'
                  className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                  placeholder='例如: https://proxy.example.com/fetch?url='
                  value={doubanImageProxyUrl}
                  onChange={(e) =>
                    handleDoubanImageProxyUrlChange(e.target.value)
                  }
                />
              </div>
            )}

            {/* 分割线 */}
            <div className='border-t border-gray-200 dark:border-gray-700'></div>

            {/* 默认聚合搜索结果 */}
            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  默认聚合搜索结果
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  搜索时默认按标题和年份聚合显示结果
                </p>
              </div>
              <label className='flex items-center cursor-pointer'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='sr-only peer'
                    checked={defaultAggregateSearch}
                    onChange={(e) => handleAggregateToggle(e.target.checked)}
                  />
                  <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                  <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            {/* 优选和测速 */}
            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  优选和测速
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  如出现播放器劫持问题可关闭
                </p>
              </div>
              <label className='flex items-center cursor-pointer'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='sr-only peer'
                    checked={enableOptimization}
                    onChange={(e) => handleOptimizationToggle(e.target.checked)}
                  />
                  <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                  <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            <div className='flex items-center justify-between'>
              <div className='flex-1'>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  音量突增保护
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  动态保护只按疑似对白学习基线，固定峰值上限单独兜底爆响
                </p>
                <div className='mt-2 flex flex-wrap gap-2'>
                  {AUDIO_SPIKE_PROTECTION_LEVEL_OPTIONS.map((option) => {
                    const selected = audioSpikeProtectionLevel === option.value;

                    return (
                      <button
                        key={option.value}
                        type='button'
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          selected
                            ? 'border-green-500 bg-green-500 text-white'
                            : 'border-gray-300 bg-white text-gray-600 hover:border-green-400 hover:text-green-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-green-500 dark:hover:text-green-300'
                        }`}
                        onClick={() =>
                          handleAudioSpikeProtectionLevelChange(option.value)
                        }
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <div className='mt-3 space-y-3'>
                  <div
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 transition-colors ${
                      audioSpikeProtectionLevel === 'off'
                        ? 'border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-900/40 opacity-60'
                        : 'border-gray-200 bg-white/80 dark:border-gray-700 dark:bg-gray-900/40'
                    }`}
                  >
                    <div className='pr-4'>
                      <p className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        动态保护
                      </p>
                      <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                        只在疑似对白片段里学习基线，宏大 BGM
                        和场景音高过对白时再压
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={audioDynamicProtectionEnabled}
                          disabled={audioSpikeProtectionLevel === 'off'}
                          onChange={(e) =>
                            handleAudioDynamicProtectionToggle(e.target.checked)
                          }
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 peer-disabled:bg-gray-200 transition-colors dark:bg-gray-600 dark:peer-disabled:bg-gray-700'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>
                  <div
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 transition-colors ${
                      audioSpikeProtectionLevel === 'off'
                        ? 'border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-900/40 opacity-60'
                        : 'border-gray-200 bg-white/80 dark:border-gray-700 dark:bg-gray-900/40'
                    }`}
                  >
                    <div className='pr-4'>
                      <p className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        固定峰值上限
                      </p>
                      <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                        按当前档位限制输出峰值，兜住爆响、拟声和极端瞬态
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={audioFixedCeilingEnabled}
                          disabled={audioSpikeProtectionLevel === 'off'}
                          onChange={(e) =>
                            handleAudioFixedCeilingToggle(e.target.checked)
                          }
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 peer-disabled:bg-gray-200 transition-colors dark:bg-gray-600 dark:peer-disabled:bg-gray-700'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className='flex items-center justify-between'>
              <div className='flex-1'>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  去磨皮修正
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  通过本地实时画面修正压低过白高光，并恢复一些细节和层次
                </p>
                <div className='mt-2 flex flex-wrap gap-2'>
                  {VISUAL_ENHANCEMENT_LEVEL_OPTIONS.map((option) => {
                    const selected = visualEnhancementLevel === option.value;

                    return (
                      <button
                        key={option.value}
                        type='button'
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          selected
                            ? 'border-green-500 bg-green-500 text-white'
                            : 'border-gray-300 bg-white text-gray-600 hover:border-green-400 hover:text-green-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-green-500 dark:hover:text-green-300'
                        }`}
                        onClick={() =>
                          handleVisualEnhancementLevelChange(option.value)
                        }
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 流式搜索 */}
            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  流式搜索输出
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  {supportsFluidSearch
                    ? '启用搜索结果实时流式输出，关闭后使用传统一次性搜索'
                    : '当前运行时未启用流式搜索支持'}
                </p>
              </div>
              <label
                className={`flex items-center ${
                  supportsFluidSearch ? 'cursor-pointer' : 'cursor-not-allowed'
                }`}
              >
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='sr-only peer'
                    checked={fluidSearch}
                    disabled={!supportsFluidSearch}
                    onChange={(e) => handleFluidSearchToggle(e.target.checked)}
                  />
                  <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                  <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            {/* 直播视频浏览器直连 */}
            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  IPTV 视频浏览器直连
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  开启 IPTV 视频浏览器直连时，需要自备 Allow CORS 插件
                </p>
              </div>
              <label className='flex items-center cursor-pointer'>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='sr-only peer'
                    checked={liveDirectConnect}
                    onChange={(e) =>
                      handleLiveDirectConnectToggle(e.target.checked)
                    }
                  />
                  <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                  <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                </div>
              </label>
            </div>

            {isDesktopTarget ? (
              <DesktopSettingsSection isOpen={isSettingsOpen} />
            ) : null}
          </div>

          {/* 底部说明 */}
          <div className='mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              {isDesktopTarget
                ? '浏览器偏好仍保存在本地 localStorage，桌面服务配置保存在本地 JSON 配置文件中'
                : '这些设置保存在本地浏览器中'}
            </p>
          </div>
        </div>
      </div>
    </>
  );

  // 修改密码面板内容
  const changePasswordPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={handleCloseChangePassword}
        onTouchMove={(e) => {
          // 只阻止滚动，允许其他触摸事件
          e.preventDefault();
        }}
        onWheel={(e) => {
          // 阻止滚轮滚动
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 修改密码面板 */}
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] overflow-hidden'>
        {/* 内容容器 - 独立的滚动区域 */}
        <div
          className='h-full p-6'
          data-panel-content
          onTouchMove={(e) => {
            // 阻止事件冒泡到遮罩层，但允许内部滚动
            e.stopPropagation();
          }}
          style={{
            touchAction: 'auto', // 允许所有触摸操作
          }}
        >
          {/* 标题栏 */}
          <div className='flex items-center justify-between mb-6'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              修改密码
            </h3>
            <button
              onClick={handleCloseChangePassword}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 表单 */}
          {passwordNotice ? (
            <div className='mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200'>
              {passwordNotice}
            </div>
          ) : null}

          <div className='space-y-4'>
            {/* 新密码输入 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                新密码
              </label>
              <input
                type='password'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
                placeholder='请输入新密码'
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={passwordLoading}
              />
            </div>

            {/* 确认密码输入 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                确认密码
              </label>
              <input
                type='password'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
                placeholder='请再次输入新密码'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={passwordLoading}
              />
            </div>

            {/* 错误信息 */}
            {passwordError && (
              <div className='text-red-500 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded-md border border-red-200 dark:border-red-800'>
                {passwordError}
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className='flex gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <button
              onClick={handleCloseChangePassword}
              className='flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors'
              disabled={passwordLoading}
            >
              取消
            </button>
            <button
              onClick={handleSubmitChangePassword}
              className='flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              disabled={passwordLoading || !newPassword || !confirmPassword}
            >
              {passwordLoading ? '修改中...' : '确认修改'}
            </button>
          </div>

          {/* 底部说明 */}
          <div className='mt-4 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              修改密码后需要重新登录
            </p>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className='relative'>
        <button
          onClick={handleMenuClick}
          className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors'
          aria-label='User Menu'
        >
          <User className='w-full h-full' />
        </button>
        {updateStatus === UpdateStatus.HAS_UPDATE && (
          <div className='absolute top-[2px] right-[2px] w-2 h-2 bg-yellow-500 rounded-full'></div>
        )}
      </div>

      {/* 使用 Portal 将菜单面板渲染到 document.body */}
      {isOpen && mounted && createPortal(menuPanel, document.body)}

      {/* 使用 Portal 将设置面板渲染到 document.body */}
      {isSettingsOpen && mounted && createPortal(settingsPanel, document.body)}

      {/* 使用 Portal 将修改密码面板渲染到 document.body */}
      {isChangePasswordOpen &&
        mounted &&
        createPortal(changePasswordPanel, document.body)}

      {/* 版本面板 */}
      <VersionPanel
        isOpen={isVersionPanelOpen}
        onClose={() => setIsVersionPanelOpen(false)}
      />
    </>
  );
};
