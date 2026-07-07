import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface ScrollableRowProps {
  children: React.ReactNode;
  scrollDistance?: number;
}

export default function ScrollableRow({
  children,
  scrollDistance = 1000,
}: ScrollableRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const checkScroll = () => {
    if (!containerRef.current) {
      return;
    }

    const { scrollWidth, clientWidth, scrollLeft } = containerRef.current;
    const threshold = 1;
    const canScrollRight = scrollWidth - (scrollLeft + clientWidth) > threshold;
    const canScrollLeft = scrollLeft > threshold;

    setShowRightScroll(canScrollRight);
    setShowLeftScroll(canScrollLeft);
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);

    const resizeObserver = new ResizeObserver(() => {
      checkScroll();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', checkScroll);
      resizeObserver.disconnect();
    };
  }, [children]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new MutationObserver(() => {
      window.setTimeout(checkScroll, 100);
    });

    observer.observe(containerRef.current, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });

    return () => observer.disconnect();
  }, []);

  const handleScrollRightClick = () => {
    if (!containerRef.current) {
      return;
    }

    containerRef.current.scrollBy({
      left: scrollDistance,
      behavior: 'smooth',
    });
  };

  const handleScrollLeftClick = () => {
    if (!containerRef.current) {
      return;
    }

    containerRef.current.scrollBy({
      left: -scrollDistance,
      behavior: 'smooth',
    });
  };

  return (
    <div
      className='relative'
      onMouseEnter={() => {
        setIsHovered(true);
        checkScroll();
      }}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        ref={containerRef}
        className='flex gap-5 overflow-x-auto px-1 py-2 pb-8 scrollbar-hide sm:gap-[1.15rem] sm:pb-10'
        onScroll={checkScroll}
      >
        {children}
      </div>

      {showLeftScroll ? (
        <div
          className={`pointer-events-none absolute inset-y-0 left-0 z-[600] hidden w-14 items-center justify-center transition-opacity duration-200 sm:flex ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <button
            onClick={handleScrollLeftClick}
            className='luna-scroll-arrow pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full transition-transform duration-200 hover:-translate-x-0.5'
            aria-label='向左滚动'
          >
            <ChevronLeft className='h-5 w-5' />
          </button>
        </div>
      ) : null}

      {showRightScroll ? (
        <div
          className={`pointer-events-none absolute inset-y-0 right-0 z-[600] hidden w-16 items-center justify-center transition-opacity duration-200 sm:flex ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className='absolute bottom-4 top-4 right-5 w-4'>
            <div className='luna-scroll-track absolute bottom-0 left-1/2 top-0 w-[3px] -translate-x-1/2 rounded-full opacity-70' />
            <div className='luna-scroll-thumb absolute left-1/2 top-[18%] h-[32%] w-[3px] -translate-x-1/2 rounded-full' />
          </div>
          <button
            onClick={handleScrollRightClick}
            className='luna-scroll-arrow pointer-events-auto relative right-0.5 flex h-12 w-12 items-center justify-center rounded-full transition-transform duration-200 hover:translate-x-0.5'
            aria-label='向右滚动'
          >
            <ChevronRight className='h-5 w-5' />
          </button>
        </div>
      ) : null}
    </div>
  );
}
