'use client';

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const mockRouter = {
  back: jest.fn(),
  prefetch: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
};

const beginNavigation = jest.fn();

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: React.PropsWithChildren<
    React.AnchorHTMLAttributes<HTMLAnchorElement> & {
      href: string;
      prefetch?: boolean;
    }
  >) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/search'),
  useRouter: jest.fn(() => mockRouter),
  useSearchParams: jest.fn(() => new URLSearchParams()),
}));

jest.mock('./NavigationFeedbackProvider', () => ({
  isModifiedNavigationEvent: jest.fn(() => false),
  useNavigationFeedback: jest.fn(() => ({
    beginNavigation,
    pendingNavigation: null,
  })),
}));

import Sidebar from './Sidebar';
import { SiteProvider } from './SiteProvider';

describe('Sidebar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    localStorage.clear();
    delete window.__sidebarCollapsed;
    delete window.RUNTIME_CONFIG;
    document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('shows navigation feedback before pushing sidebar routes', () => {
    render(
      <SiteProvider siteName='LunaTV'>
        <Sidebar activePath='/search' />
      </SiteProvider>
    );

    fireEvent.click(screen.getByText('电影'));

    expect(beginNavigation).toHaveBeenCalledWith({
      href: '/douban?type=movie',
      kind: 'nav',
      label: '电影',
    });
    expect(mockRouter.push).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(mockRouter.push).toHaveBeenCalledWith('/douban?type=movie');
  });

  it('shows the follow-updates entry on desktop', async () => {
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
    };

    render(
      <SiteProvider siteName='LunaTV'>
        <Sidebar activePath='/follow-updates' />
      </SiteProvider>
    );

    expect(await screen.findByText('追更')).toBeInTheDocument();
  });
});
