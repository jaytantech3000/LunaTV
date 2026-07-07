/* eslint-disable react-hooks/exhaustive-deps */

import React, { useEffect, useRef, useState } from 'react';

interface CapsuleSwitchProps {
  options: { label: string; value: string }[];
  active: string;
  onChange: (value: string) => void;
  className?: string;
}

const CapsuleSwitch: React.FC<CapsuleSwitchProps> = ({
  options,
  active,
  onChange,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  const activeIndex = options.findIndex((opt) => opt.value === active);

  const updateIndicatorPosition = () => {
    if (
      activeIndex < 0 ||
      !buttonRefs.current[activeIndex] ||
      !containerRef.current
    ) {
      return;
    }

    const button = buttonRefs.current[activeIndex];
    const container = containerRef.current;
    if (!button || !container) {
      return;
    }

    const buttonRect = button.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (buttonRect.width <= 0) {
      return;
    }

    setIndicatorStyle({
      left: buttonRect.left - containerRect.left,
      width: buttonRect.width,
    });
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(updateIndicatorPosition, 0);
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && containerRef.current
        ? new ResizeObserver(updateIndicatorPosition)
        : null;

    if (resizeObserver && containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener('resize', updateIndicatorPosition);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('resize', updateIndicatorPosition);
      resizeObserver?.disconnect();
    };
  }, [activeIndex, options.length]);

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex rounded-full border border-white/10 bg-[var(--luna-seg-fill)] p-1.5 shadow-[0_18px_38px_rgba(0,0,0,0.12)] backdrop-blur-2xl ${
        className || ''
      }`}
    >
      {indicatorStyle.width > 0 ? (
        <div
          className='absolute bottom-1.5 top-1.5 rounded-full bg-[var(--luna-seg-pill)] shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_10px_22px_rgba(0,0,0,0.08)] transition-all duration-200 ease-out'
          style={{
            left: `${indicatorStyle.left}px`,
            width: `${indicatorStyle.width}px`,
          }}
        />
      ) : null}

      {options.map((opt, index) => {
        const isActive = active === opt.value;

        return (
          <button
            key={opt.value}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            onClick={() => onChange(opt.value)}
            className={`relative z-10 min-w-[4.75rem] rounded-full px-5 py-2.5 text-sm font-semibold tracking-[0.01em] transition-colors duration-200 sm:min-w-[5.5rem] ${
              isActive
                ? 'text-[var(--luna-seg-text-active)]'
                : 'text-[var(--luna-seg-text)] hover:text-[var(--luna-seg-text-active)]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

export default CapsuleSwitch;
