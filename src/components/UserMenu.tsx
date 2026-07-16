/* eslint-disable no-console,@typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

'use client';

import {
  Cloud,
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
import {
  type UserMenuStorageTag,
  buildUserMenuStorageTags,
} from '@/lib/desktop/user-menu-storage-tags';
import { purgeOfflineDownloads } from '@/lib/download/session';
import type { ResolvedProfileRuntime } from '@/lib/profile/contracts';
import { resolveProfileRuntime } from '@/lib/profile/runtime';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { acquireScrollLock } from '@/lib/scroll-lock';
import { apiFetch } from '@/lib/transport/api-client';
import { useAppUpdateState } from '@/lib/use-app-update';
import { CURRENT_VERSION } from '@/lib/version';
import { UpdateStatus } from '@/lib/version_check';

import { useNavigationFeedback } from './NavigationFeedbackProvider';
import { VersionPanel } from './VersionPanel';

interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
}

interface UserMenuProps {
  variant?: 'default' | 'ghost';
}

const STORAGE_TAG_TONE_CLASSES: Record<UserMenuStorageTag['tone'], string> = {
  green:
    'border-emerald-200/70 bg-emerald-50/60 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-300',
  gray: 'border-gray-200/70 bg-gray-50/60 text-gray-600 dark:border-gray-700/70 dark:bg-gray-800/50 dark:text-gray-300',
};

function StorageTag({ tag }: { tag: UserMenuStorageTag }) {
  return (
    <span
      data-testid={`user-menu-storage-tag-${tag.key}`}
      title={tag.detail}
      className={`flex min-h-6 min-w-0 flex-1 items-center gap-1 rounded-md border px-1.5 py-0.5 text-left text-[10px] font-medium leading-tight ${
        STORAGE_TAG_TONE_CLASSES[tag.tone]
      }`}
    >
      <span
        data-testid={`user-menu-storage-status-dot-${tag.key}`}
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          tag.tone === 'green' ? 'bg-emerald-400' : 'bg-gray-400'
        }`}
      />
      <span className='truncate'>{tag.label}</span>
    </span>
  );
}

export const UserMenu: React.FC<UserMenuProps> = ({ variant = 'default' }) => {
  const router = useRouter();
  const { beginNavigation, pendingNavigation } = useNavigationFeedback();
  const [isOpen, setIsOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isVersionPanelOpen, setIsVersionPanelOpen] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [profileRuntime, setProfileRuntime] =
    useState<ResolvedProfileRuntime | null>(null);
  const [storageType, setStorageType] = useState<string>('localstorage');
  const [adminPanelEnabled, setAdminPanelEnabled] = useState(true);
  const [isDesktopTarget, setIsDesktopTarget] = useState(false);
  const [desktopProfileSyncEnabled, setDesktopProfileSyncEnabled] =
    useState(false);
  const [desktopAuthRequired, setDesktopAuthRequired] = useState(false);
  const [desktopAuthUsername, setDesktopAuthUsername] = useState('');
  const [desktopOwnerPasswordConfigured, setDesktopOwnerPasswordConfigured] =
    useState(false);
  const [mounted, setMounted] = useState(false);
  const isGhost = variant === 'ghost';
  const buttonClassName = isGhost
    ? 'luna-toolbar-button luna-toolbar-button--ghost'
    : 'luna-toolbar-button';
  const iconClassName = isGhost ? 'h-[1.26rem] w-[1.26rem]' : 'w-full h-full';

  // Body 滚动锁定 - 使用 overflow 方式避免布局问题
  useEffect(() => {
    if (isChangePasswordOpen) {
      return acquireScrollLock({
        lockHtml: true,
      });
    }
  }, [isChangePasswordOpen]);

  // 修改密码相关状态
  const [currentPassword, setCurrentPassword] = useState('');
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
      const resolvedProfileRuntime = resolveProfileRuntime(runtimeConfig);
      const isDesktop = resolvedProfileRuntime.appTarget === 'desktop';
      const profileSyncEnabled =
        resolvedProfileRuntime.runtimeKind === 'desktop-profile-sync';
      if (!active) {
        return;
      }

      setAuthInfo(auth);
      setProfileRuntime(resolvedProfileRuntime);
      setStorageType(resolvedProfileRuntime.storageType);
      setAdminPanelEnabled(runtimeConfig.ENABLE_ADMIN_PANEL !== false);
      setIsDesktopTarget(isDesktop);
      setDesktopProfileSyncEnabled(profileSyncEnabled);

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
    window.addEventListener(DESKTOP_RUNTIME_UPDATED_EVENT, syncMenuState);

    return () => {
      active = false;
      window.removeEventListener(BROWSER_AUTH_UPDATED_EVENT, syncMenuState);
      window.removeEventListener(DESKTOP_RUNTIME_UPDATED_EVENT, syncMenuState);
    };
  }, []);

  const prefetchRoute = useCallback(
    (href: string) => {
      router.prefetch(href);
    },
    [router]
  );

  const handleMenuClick = () => {
    setIsOpen(!isOpen);
  };

  const handleCloseMenu = () => {
    setIsOpen(false);
  };

  const openChangePasswordDialog = (notice = '') => {
    setIsChangePasswordOpen(true);
    setCurrentPassword('');
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
      pendingNavigation.href === '/account-sync'
    ) {
      setIsOpen(false);
      return;
    }

    flushSync(() => {
      setIsOpen(false);
      beginNavigation({
        href: '/account-sync',
        kind: 'nav',
        label: '帐号同步',
      });
    });
    prefetchRoute('/account-sync');
    window.setTimeout(() => {
      router.push('/account-sync');
    }, 0);
  };

  const handleChangePassword = () => {
    setIsOpen(false);
    openChangePasswordDialog();
  };

  const handleCloseChangePassword = () => {
    setIsChangePasswordOpen(false);
    setCurrentPassword('');
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
          currentPassword,
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
    if (
      pendingNavigation?.kind === 'nav' &&
      pendingNavigation.href === '/config'
    ) {
      setIsOpen(false);
      return;
    }

    flushSync(() => {
      setIsOpen(false);
      beginNavigation({
        href: '/config',
        kind: 'nav',
        label: '设置',
      });
    });
    prefetchRoute('/config');
    window.setTimeout(() => {
      router.push('/config');
    }, 0);
  };

  const isOpeningConfig =
    pendingNavigation?.kind === 'nav' && pendingNavigation.href === '/config';
  const isOpeningAdmin =
    pendingNavigation?.kind === 'nav' && pendingNavigation.href === '/admin';
  const isOpeningDesktopAccountSync =
    pendingNavigation?.kind === 'nav' &&
    pendingNavigation.href === '/account-sync';
  const storageTags = profileRuntime
    ? buildUserMenuStorageTags(profileRuntime)
    : [];

  // 检查是否显示管理面板按钮
  const isAuthenticated = Boolean(authInfo?.username);
  const isDesktopLocalAuthMode = isDesktopTarget && !desktopProfileSyncEnabled;
  const showAdminPanel = isDesktopTarget
    ? true
    : adminPanelEnabled &&
      (authInfo?.role === 'owner' || authInfo?.role === 'admin');
  const showDesktopAccountSyncEntry = isDesktopTarget;

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
      <div className='luna-popover fixed right-4 top-16 z-[1001] w-60 overflow-hidden rounded-[1.5rem] select-none'>
        {/* 用户信息区域 */}
        <div className='border-b border-[var(--luna-popover-border)] bg-white/10 px-4 py-3 dark:bg-white/5'>
          <div className='space-y-1'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-medium uppercase tracking-wider text-[var(--luna-copy-muted)]'>
                当前用户
              </span>
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium ${
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
                  : '访客'}
              </span>
            </div>
            <div className='flex items-center justify-between'>
              <div className='truncate text-sm font-semibold text-[var(--luna-copy-strong)]'>
                {authInfo?.username || '访客'}
              </div>
            </div>
            {storageTags.length > 0 ? (
              <div
                className='mt-1.5 flex gap-1'
                data-testid='user-menu-storage-tags'
              >
                {storageTags.map((tag) => (
                  <StorageTag key={tag.key} tag={tag} />
                ))}
              </div>
            ) : null}
            {!isAuthenticated &&
            isDesktopTarget &&
            !desktopProfileSyncEnabled &&
            desktopAuthRequired &&
            desktopAuthUsername ? (
              <div className='text-[11px] text-[var(--luna-copy-muted)]'>
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
            onPointerDown={() => prefetchRoute('/config')}
            onMouseEnter={() => prefetchRoute('/config')}
            onFocus={() => prefetchRoute('/config')}
            disabled={isOpeningConfig}
            aria-busy={isOpeningConfig}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm disabled:cursor-progress disabled:opacity-80'
          >
            <div className='relative flex h-4 w-4 items-center justify-center'>
              <Settings className='h-4 w-4 text-gray-500 dark:text-gray-400' />
              {isOpeningConfig ? (
                <Loader2 className='absolute -right-1.5 -top-1.5 h-3 w-3 animate-spin text-emerald-500 dark:text-emerald-400' />
              ) : null}
            </div>
            <span className='font-medium'>
              {isOpeningConfig ? '正在打开设置...' : '设置'}
            </span>
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
              onPointerDown={() => prefetchRoute('/account-sync')}
              onMouseEnter={() => prefetchRoute('/account-sync')}
              onFocus={() => prefetchRoute('/account-sync')}
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
                    data-testid='user-menu-version-status-dot'
                    title={
                      updateStatus === UpdateStatus.NO_UPDATE
                        ? '本地服务运行正常'
                        : undefined
                    }
                    className={`h-1.5 w-1.5 rounded-full ${
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
            {isDesktopTarget &&
            !desktopProfileSyncEnabled &&
            desktopAuthRequired ? (
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                  当前密码
                </label>
                <input
                  type='password'
                  autoComplete='current-password'
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
                  placeholder='请输入当前密码'
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={passwordLoading}
                />
              </div>
            ) : null}
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
          className={buttonClassName}
          aria-label='User Menu'
        >
          <User className={iconClassName} strokeWidth={1.72} />
        </button>
        {updateStatus === UpdateStatus.HAS_UPDATE && (
          <div
            className={`absolute rounded-full bg-yellow-500 ${
              isGhost
                ? 'right-[1px] top-[1px] h-1.5 w-1.5'
                : 'right-[2px] top-[2px] h-2 w-2'
            }`}
          ></div>
        )}
      </div>

      {/* 使用 Portal 将菜单面板渲染到 document.body */}
      {isOpen && mounted && createPortal(menuPanel, document.body)}

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
