'use client';

import { Check, ChevronDown, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';

import { DESKTOP_RUNTIME_UPDATED_EVENT } from '@/lib/desktop/runtime-config';
import {
  getDefaultFluidSearchSetting,
  getPreferredFluidSearchSetting,
  isFluidSearchSupported,
  setPreferredFluidSearchSetting,
} from '@/lib/fluid-search';
import {
  type AudioSpikeProtectionLevel,
  type VisualEnhancementLevel,
  AUDIO_SPIKE_PROTECTION_LEVEL_OPTIONS,
  VISUAL_ENHANCEMENT_LEVEL_OPTIONS,
} from '@/lib/player-enhancement-types';
import {
  PLAYER_ENHANCEMENTS_UPDATED_EVENT,
  readPlayerEnhancementPreferences,
  resetPlayerEnhancementPreferences,
  updatePlayerEnhancementPreference,
} from '@/lib/player-enhancements';
import { resolveProfileRuntime } from '@/lib/profile/runtime';
import { getRuntimeConfig } from '@/lib/runtime-config';

import DesktopSettingsSection from './DesktopSettingsSection';

interface LinkInfo {
  text: string;
  url: string;
}

function getWindowRuntimeConfig(): Record<string, unknown> {
  if (typeof window === 'undefined') {
    return {};
  }

  const runtimeConfig = (
    window as typeof window & {
      RUNTIME_CONFIG?: Record<string, unknown>;
    }
  ).RUNTIME_CONFIG;

  if (!runtimeConfig || typeof runtimeConfig !== 'object') {
    return {};
  }

  return runtimeConfig;
}

function readRuntimeString(key: string): string {
  const value = getWindowRuntimeConfig()[key];
  return typeof value === 'string' ? value : '';
}

function normalizeDoubanImageProxyType(
  value: string,
  isDesktopTarget: boolean
): string {
  let normalized = value;

  if (normalized === 'direct' || normalized === 'img3') {
    normalized = 'server';
  }

  if (isDesktopTarget && normalized === 'server') {
    return 'cmliussss-cdn-tencent';
  }

  return normalized;
}

function getThanksInfo(dataSource: string): LinkInfo | null {
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
}

export default function ConfigPageClient() {
  const [isDesktopTarget, setIsDesktopTarget] = useState(false);
  const [supportsFluidSearch, setSupportsFluidSearch] = useState(true);
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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const syncRuntimeState = () => {
      const runtimeConfig = getRuntimeConfig();
      const profileRuntime = resolveProfileRuntime(runtimeConfig);
      setIsDesktopTarget(profileRuntime.appTarget === 'desktop');
      setSupportsFluidSearch(isFluidSearchSupported(runtimeConfig));
    };

    syncRuntimeState();
    window.addEventListener(DESKTOP_RUNTIME_UPDATED_EVENT, syncRuntimeState);

    return () => {
      window.removeEventListener(
        DESKTOP_RUNTIME_UPDATED_EVENT,
        syncRuntimeState
      );
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const runtimeConfig = getRuntimeConfig();
    const savedAggregateSearch = localStorage.getItem('defaultAggregateSearch');
    if (savedAggregateSearch !== null) {
      setDefaultAggregateSearch(JSON.parse(savedAggregateSearch) as boolean);
    }

    const defaultDoubanProxyType =
      readRuntimeString('DOUBAN_PROXY_TYPE') || 'cmliussss-cdn-tencent';
    const normalizedDesktopDoubanProxyType =
      isDesktopTarget && defaultDoubanProxyType === 'direct'
        ? 'cmliussss-cdn-tencent'
        : defaultDoubanProxyType;
    const savedDoubanDataSource = localStorage.getItem('doubanDataSource');
    if (savedDoubanDataSource !== null) {
      const normalizedSavedDoubanDataSource =
        isDesktopTarget && savedDoubanDataSource === 'direct'
          ? 'cmliussss-cdn-tencent'
          : savedDoubanDataSource;
      setDoubanDataSource(normalizedSavedDoubanDataSource);
      if (normalizedSavedDoubanDataSource !== savedDoubanDataSource) {
        localStorage.setItem(
          'doubanDataSource',
          normalizedSavedDoubanDataSource
        );
      }
    } else {
      setDoubanDataSource(normalizedDesktopDoubanProxyType);
    }

    const savedDoubanProxyUrl = localStorage.getItem('doubanProxyUrl');
    const defaultDoubanProxy = readRuntimeString('DOUBAN_PROXY');
    if (savedDoubanProxyUrl !== null) {
      setDoubanProxyUrl(savedDoubanProxyUrl);
    } else {
      setDoubanProxyUrl(defaultDoubanProxy);
    }

    const savedDoubanImageProxyType = localStorage.getItem(
      'doubanImageProxyType'
    );
    const defaultDoubanImageProxyType = normalizeDoubanImageProxyType(
      readRuntimeString('DOUBAN_IMAGE_PROXY_TYPE') || 'cmliussss-cdn-tencent',
      isDesktopTarget
    );
    if (savedDoubanImageProxyType !== null) {
      const normalizedSavedDoubanImageProxyType = normalizeDoubanImageProxyType(
        savedDoubanImageProxyType,
        isDesktopTarget
      );
      setDoubanImageProxyType(normalizedSavedDoubanImageProxyType);
      if (normalizedSavedDoubanImageProxyType !== savedDoubanImageProxyType) {
        localStorage.setItem(
          'doubanImageProxyType',
          normalizedSavedDoubanImageProxyType
        );
      }
    } else {
      setDoubanImageProxyType(defaultDoubanImageProxyType);
    }

    const savedDoubanImageProxyUrl = localStorage.getItem(
      'doubanImageProxyUrl'
    );
    const defaultDoubanImageProxyUrl = readRuntimeString('DOUBAN_IMAGE_PROXY');
    if (savedDoubanImageProxyUrl !== null) {
      setDoubanImageProxyUrl(savedDoubanImageProxyUrl);
    } else {
      setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);
    }

    const savedEnableOptimization = localStorage.getItem('enableOptimization');
    if (savedEnableOptimization !== null) {
      setEnableOptimization(JSON.parse(savedEnableOptimization) as boolean);
    }

    if (!supportsFluidSearch) {
      setFluidSearch(false);
      setPreferredFluidSearchSetting(false);
    } else {
      setFluidSearch(getPreferredFluidSearchSetting());
    }

    const savedLiveDirectConnect = localStorage.getItem('liveDirectConnect');
    if (savedLiveDirectConnect !== null) {
      setLiveDirectConnect(JSON.parse(savedLiveDirectConnect) as boolean);
    }

    const enhancementPreferences =
      readPlayerEnhancementPreferences(runtimeConfig);
    setAudioSpikeProtectionLevel(
      enhancementPreferences.audioSpikeProtectionLevel
    );
    setAudioDynamicProtectionEnabled(
      enhancementPreferences.audioDynamicProtectionEnabled
    );
    setAudioFixedCeilingEnabled(
      enhancementPreferences.audioFixedCeilingEnabled
    );
    setVisualEnhancementLevel(enhancementPreferences.visualEnhancementLevel);
  }, [isDesktopTarget, supportsFluidSearch]);

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-datasource"]')) {
          setIsDoubanDropdownOpen(false);
        }
      }
    };

    if (!isDoubanDropdownOpen) {
      return;
    }

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
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

    if (!isDoubanImageProxyDropdownOpen) {
      return;
    }

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDoubanImageProxyDropdownOpen]);

  const handleAggregateToggle = (value: boolean) => {
    setDefaultAggregateSearch(value);
    localStorage.setItem('defaultAggregateSearch', JSON.stringify(value));
  };

  const handleDoubanProxyUrlChange = (value: string) => {
    setDoubanProxyUrl(value);
    localStorage.setItem('doubanProxyUrl', value);
  };

  const handleOptimizationToggle = (value: boolean) => {
    setEnableOptimization(value);
    localStorage.setItem('enableOptimization', JSON.stringify(value));
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
    localStorage.setItem('liveDirectConnect', JSON.stringify(value));
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
    localStorage.setItem('doubanDataSource', value);
  };

  const handleDoubanImageProxyTypeChange = (value: string) => {
    setDoubanImageProxyType(value);
    localStorage.setItem('doubanImageProxyType', value);
  };

  const handleDoubanImageProxyUrlChange = (value: string) => {
    setDoubanImageProxyUrl(value);
    localStorage.setItem('doubanImageProxyUrl', value);
  };

  const handleResetSettings = () => {
    const runtimeConfig = getRuntimeConfig();
    const defaultDoubanProxyType =
      readRuntimeString('DOUBAN_PROXY_TYPE') || 'cmliussss-cdn-tencent';
    const normalizedDesktopDoubanProxyType =
      isDesktopTarget && defaultDoubanProxyType === 'direct'
        ? 'cmliussss-cdn-tencent'
        : defaultDoubanProxyType;
    const defaultDoubanProxy = readRuntimeString('DOUBAN_PROXY');
    const defaultDoubanImageProxyType = normalizeDoubanImageProxyType(
      readRuntimeString('DOUBAN_IMAGE_PROXY_TYPE') || 'cmliussss-cdn-tencent',
      isDesktopTarget
    );
    const defaultDoubanImageProxyUrl = readRuntimeString('DOUBAN_IMAGE_PROXY');
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

    localStorage.setItem('defaultAggregateSearch', JSON.stringify(true));
    localStorage.setItem('enableOptimization', JSON.stringify(true));
    setPreferredFluidSearchSetting(defaultFluidSearch);
    localStorage.setItem('liveDirectConnect', JSON.stringify(false));
    localStorage.setItem('doubanProxyUrl', defaultDoubanProxy);
    localStorage.setItem('doubanDataSource', normalizedDesktopDoubanProxyType);
    localStorage.setItem('doubanImageProxyType', defaultDoubanImageProxyType);
    localStorage.setItem('doubanImageProxyUrl', defaultDoubanImageProxyUrl);
  };

  const renderThanksLink = (key: string) => {
    const linkInfo = getThanksInfo(key);

    if (!linkInfo) {
      return null;
    }

    return (
      <div className='mt-3'>
        <button
          type='button'
          onClick={() => window.open(linkInfo.url, '_blank')}
          className='flex w-full items-center justify-center gap-1.5 px-3 text-xs text-gray-500 dark:text-gray-400'
        >
          <span className='font-medium'>{linkInfo.text}</span>
          <ExternalLink className='w-3.5 opacity-70' />
        </button>
      </div>
    );
  };

  return (
    <div className='mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-10 pt-6 sm:px-6 lg:px-8'>
      <section className='space-y-2'>
        <div className='text-xs font-medium uppercase tracking-[0.24em] text-emerald-600/80 dark:text-emerald-400/80'>
          本地偏好
        </div>
        <h1 className='text-3xl font-semibold text-gray-900 dark:text-gray-100'>
          配置
        </h1>
        <p className='max-w-3xl text-sm text-gray-600 dark:text-gray-400'>
          这里统一管理浏览器本地偏好、桌面本地服务控制和桌面 JSON
          配置，旧版“本地设置”弹层已收口到当前页面。
        </p>
      </section>

      <section className='rounded-2xl border border-gray-200 bg-white px-5 py-5 dark:border-gray-800 dark:bg-gray-950'>
        <div className='flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-4 dark:border-gray-800'>
          <div>
            <h2 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
              本地设置
            </h2>
            <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
              浏览器偏好继续保存在本地存储；桌面运行时下，本地服务配置会在下方单独显示。
            </p>
          </div>
          <button
            type='button'
            onClick={handleResetSettings}
            className='rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-900/20'
          >
            恢复默认
          </button>
        </div>

        <div className='mt-6 space-y-6'>
          <div className='space-y-3'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                豆瓣数据代理
              </h4>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                {isDesktopTarget
                  ? '桌面版当前支持 CDN 和自定义代理；直连模式待本地服务接入后开放'
                  : '选择获取豆瓣数据的方式'}
              </p>
            </div>
            <div className='relative' data-dropdown='douban-datasource'>
              <button
                type='button'
                onClick={() => setIsDoubanDropdownOpen(!isDoubanDropdownOpen)}
                className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-10 text-left text-sm text-gray-900 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-500'
              >
                {availableDoubanDataSourceOptions.find(
                  (option) => option.value === doubanDataSource
                )?.label || availableDoubanDataSourceOptions[0]?.label}
              </button>
              <div className='pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3'>
                <ChevronDown
                  className={`w-4 text-gray-400 transition-transform duration-200 dark:text-gray-500 ${
                    isDoubanDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </div>

              {isDoubanDropdownOpen ? (
                <div className='absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800'>
                  {availableDoubanDataSourceOptions.map((option) => (
                    <button
                      key={option.value}
                      type='button'
                      onClick={() => {
                        handleDoubanDataSourceChange(option.value);
                        setIsDoubanDropdownOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-700 ${
                        doubanDataSource === option.value
                          ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                          : 'text-gray-900 dark:text-gray-100'
                      }`}
                    >
                      <span className='truncate'>{option.label}</span>
                      {doubanDataSource === option.value ? (
                        <Check className='ml-2 h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400' />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {renderThanksLink(doubanDataSource)}
          </div>

          {doubanDataSource === 'custom' ? (
            <div className='space-y-3'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  豆瓣代理地址
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  自定义代理服务器地址
                </p>
              </div>
              <input
                type='text'
                className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-500'
                placeholder='例如: https://proxy.example.com/fetch?url='
                value={doubanProxyUrl}
                onChange={(event) =>
                  handleDoubanProxyUrlChange(event.target.value)
                }
              />
            </div>
          ) : null}

          <div className='border-t border-gray-200 dark:border-gray-700' />

          <div className='space-y-3'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                豆瓣图片代理
              </h4>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                {isDesktopTarget
                  ? '桌面版当前支持 CDN 和自定义图片代理；服务端图片代理待本地服务接入后开放'
                  : '选择获取豆瓣图片的方式'}
              </p>
            </div>
            <div className='relative' data-dropdown='douban-image-proxy'>
              <button
                type='button'
                onClick={() =>
                  setIsDoubanImageProxyDropdownOpen(
                    !isDoubanImageProxyDropdownOpen
                  )
                }
                className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-10 text-left text-sm text-gray-900 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-500'
              >
                {availableDoubanImageProxyTypeOptions.find(
                  (option) => option.value === doubanImageProxyType
                )?.label || availableDoubanImageProxyTypeOptions[0]?.label}
              </button>
              <div className='pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3'>
                <ChevronDown
                  className={`w-4 text-gray-400 transition-transform duration-200 dark:text-gray-500 ${
                    isDoubanImageProxyDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </div>

              {isDoubanImageProxyDropdownOpen ? (
                <div className='absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800'>
                  {availableDoubanImageProxyTypeOptions.map((option) => (
                    <button
                      key={option.value}
                      type='button'
                      onClick={() => {
                        handleDoubanImageProxyTypeChange(option.value);
                        setIsDoubanImageProxyDropdownOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-700 ${
                        doubanImageProxyType === option.value
                          ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                          : 'text-gray-900 dark:text-gray-100'
                      }`}
                    >
                      <span className='truncate'>{option.label}</span>
                      {doubanImageProxyType === option.value ? (
                        <Check className='ml-2 h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400' />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {renderThanksLink(doubanImageProxyType)}
          </div>

          {doubanImageProxyType === 'custom' ? (
            <div className='space-y-3'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  豆瓣图片代理地址
                </h4>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  自定义图片代理服务器地址
                </p>
              </div>
              <input
                type='text'
                className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-500'
                placeholder='例如: https://proxy.example.com/fetch?url='
                value={doubanImageProxyUrl}
                onChange={(event) =>
                  handleDoubanImageProxyUrlChange(event.target.value)
                }
              />
            </div>
          ) : null}

          <div className='border-t border-gray-200 dark:border-gray-700' />

          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                默认聚合搜索结果
              </h4>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                搜索时默认按标题和年份聚合显示结果
              </p>
            </div>
            <label className='flex cursor-pointer items-center'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='peer sr-only'
                  checked={defaultAggregateSearch}
                  onChange={(event) =>
                    handleAggregateToggle(event.target.checked)
                  }
                />
                <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600' />
                <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5' />
              </div>
            </label>
          </div>

          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                优选和测速
              </h4>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                如出现播放器劫持问题可关闭
              </p>
            </div>
            <label className='flex cursor-pointer items-center'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='peer sr-only'
                  checked={enableOptimization}
                  onChange={(event) =>
                    handleOptimizationToggle(event.target.checked)
                  }
                />
                <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600' />
                <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5' />
              </div>
            </label>
          </div>

          <div className='flex items-center justify-between'>
            <div className='flex-1'>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                音量突增保护
              </h4>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
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
                      ? 'border-gray-200 bg-gray-50/80 opacity-60 dark:border-gray-700 dark:bg-gray-900/40'
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
                  <label className='flex cursor-pointer items-center'>
                    <div className='relative'>
                      <input
                        type='checkbox'
                        className='peer sr-only'
                        checked={audioDynamicProtectionEnabled}
                        disabled={audioSpikeProtectionLevel === 'off'}
                        onChange={(event) =>
                          handleAudioDynamicProtectionToggle(
                            event.target.checked
                          )
                        }
                      />
                      <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 peer-disabled:bg-gray-200 dark:bg-gray-600 dark:peer-disabled:bg-gray-700' />
                      <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5' />
                    </div>
                  </label>
                </div>
                <div
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 transition-colors ${
                    audioSpikeProtectionLevel === 'off'
                      ? 'border-gray-200 bg-gray-50/80 opacity-60 dark:border-gray-700 dark:bg-gray-900/40'
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
                  <label className='flex cursor-pointer items-center'>
                    <div className='relative'>
                      <input
                        type='checkbox'
                        className='peer sr-only'
                        checked={audioFixedCeilingEnabled}
                        disabled={audioSpikeProtectionLevel === 'off'}
                        onChange={(event) =>
                          handleAudioFixedCeilingToggle(event.target.checked)
                        }
                      />
                      <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 peer-disabled:bg-gray-200 dark:bg-gray-600 dark:peer-disabled:bg-gray-700' />
                      <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5' />
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
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
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

          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                流式搜索输出
              </h4>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
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
                  className='peer sr-only'
                  checked={fluidSearch}
                  disabled={!supportsFluidSearch}
                  onChange={(event) =>
                    handleFluidSearchToggle(event.target.checked)
                  }
                />
                <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600' />
                <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5' />
              </div>
            </label>
          </div>

          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                IPTV 视频浏览器直连
              </h4>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                开启 IPTV 视频浏览器直连时，需要自备 Allow CORS 插件
              </p>
            </div>
            <label className='flex cursor-pointer items-center'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='peer sr-only'
                  checked={liveDirectConnect}
                  onChange={(event) =>
                    handleLiveDirectConnectToggle(event.target.checked)
                  }
                />
                <div className='h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600' />
                <div className='absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5' />
              </div>
            </label>
          </div>
        </div>
      </section>

      {isDesktopTarget ? <DesktopSettingsSection isOpen={true} /> : null}
    </div>
  );
}
