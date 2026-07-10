'use client';

import { useEffect, useRef, useState } from 'react';

interface ErrorInfo {
  id: string;
  message: string;
  timestamp: number;
}

export function GlobalErrorIndicator() {
  const [currentError, setCurrentError] = useState<ErrorInfo | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const currentErrorRef = useRef<ErrorInfo | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const lastErrorRef = useRef<{
    message: string;
    timestamp: number;
  } | null>(null);

  useEffect(() => {
    // 监听自定义错误事件
    const handleError = (event: CustomEvent) => {
      const { message } = event.detail;
      const now = Date.now();
      const lastError = lastErrorRef.current;

      // Suppress rapid-fire duplicates so a noisy source does not pin the toast.
      if (
        lastError &&
        lastError.message === message &&
        now - lastError.timestamp < 30000
      ) {
        return;
      }

      const newError: ErrorInfo = {
        id: now.toString(),
        message,
        timestamp: now,
      };
      lastErrorRef.current = {
        message,
        timestamp: now,
      };

      // 如果已有错误，开始替换动画
      if (currentErrorRef.current) {
        setCurrentError(newError);
        setIsReplacing(true);

        // 动画完成后恢复正常
        setTimeout(() => {
          setIsReplacing(false);
        }, 200);
      } else {
        // 第一次显示错误
        setCurrentError(newError);
      }
      currentErrorRef.current = newError;

      setIsVisible(true);

      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }

      hideTimerRef.current = window.setTimeout(() => {
        setIsVisible(false);
        setCurrentError(null);
        setIsReplacing(false);
        currentErrorRef.current = null;
        hideTimerRef.current = null;
      }, 3200);
    };

    // 监听错误事件
    window.addEventListener('globalError', handleError as EventListener);

    return () => {
      window.removeEventListener('globalError', handleError as EventListener);
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, []);

  const handleClose = () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setIsVisible(false);
    setCurrentError(null);
    setIsReplacing(false);
    currentErrorRef.current = null;
  };

  if (!isVisible || !currentError) {
    return null;
  }

  return (
    <div className='fixed right-4 top-16 z-[2000] md:top-20'>
      {/* 错误卡片 */}
      <div
        className={`bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center justify-between min-w-[300px] max-w-[400px] transition-all duration-300 ${
          isReplacing ? 'scale-105 bg-red-400' : 'scale-100 bg-red-500'
        } animate-fade-in`}
      >
        <span className='text-sm font-medium flex-1 mr-3'>
          {currentError.message}
        </span>
        <button
          onClick={handleClose}
          className='text-white hover:text-red-100 transition-colors flex-shrink-0'
          aria-label='关闭错误提示'
        >
          <svg
            className='w-5 h-5'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M6 18L18 6M6 6l12 12'
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

// 全局错误触发函数
export function triggerGlobalError(message: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('globalError', {
        detail: { message },
      })
    );
  }
}
