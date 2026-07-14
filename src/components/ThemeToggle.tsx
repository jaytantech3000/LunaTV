/* eslint-disable @typescript-eslint/no-explicit-any,react-hooks/exhaustive-deps */

'use client';

import { Moon, Sun } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

interface ThemeToggleProps {
  variant?: 'default' | 'ghost';
}

export function ThemeToggle({ variant = 'default' }: ThemeToggleProps) {
  const [mounted, setMounted] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();
  const pathname = usePathname();
  const buttonClassName =
    variant === 'ghost'
      ? 'luna-toolbar-button luna-toolbar-button--ghost'
      : 'luna-toolbar-button';
  const iconClassName = 'h-[1.26rem] w-[1.26rem]';

  const setThemeColor = (theme?: string) => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = theme === 'dark' ? '#0c111c' : '#f9fbfe';
      document.head.appendChild(meta);
    } else {
      meta.setAttribute('content', theme === 'dark' ? '#0c111c' : '#f9fbfe');
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // 监听主题变化和路由变化，确保主题色始终同步
  useEffect(() => {
    if (mounted) {
      setThemeColor(resolvedTheme);
    }
  }, [mounted, resolvedTheme, pathname]);

  if (!mounted) {
    // 渲染一个占位符以避免布局偏移
    return <div className='h-[2.625rem] w-[2.625rem]' />;
  }

  const toggleTheme = () => {
    // 检查浏览器是否支持 View Transitions API
    const targetTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    setThemeColor(targetTheme);
    if (!(document as any).startViewTransition) {
      setTheme(targetTheme);
      return;
    }

    (document as any).startViewTransition(() => {
      setTheme(targetTheme);
    });
  };

  return (
    <button
      onClick={toggleTheme}
      className={buttonClassName}
      aria-label='Toggle theme'
    >
      {resolvedTheme === 'dark' ? (
        <Sun className={iconClassName} strokeWidth={1.7} />
      ) : (
        <Moon className={iconClassName} strokeWidth={1.7} />
      )}
    </button>
  );
}
