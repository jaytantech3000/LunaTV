'use client';

import { render, screen } from '@testing-library/react';
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
  usePathname: jest.fn(() => '/'),
  useRouter: jest.fn(() => mockRouter),
}));

jest.mock('./NavigationFeedbackProvider', () => ({
  isModifiedNavigationEvent: jest.fn(() => false),
  useNavigationFeedback: jest.fn(() => ({
    beginNavigation,
    pendingNavigation: null,
  })),
}));

import MobileBottomNav from './MobileBottomNav';

const removedRuntimeKey = ['ENABLE', 'WEB', 'MUSIC'].join('_');

describe('MobileBottomNav', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete window.RUNTIME_CONFIG;
  });

  it('does not show the legacy music entry even if runtime config still carries the old flag', () => {
    window.RUNTIME_CONFIG = {
      [removedRuntimeKey]: true,
    };

    render(<MobileBottomNav activePath='/' />);

    expect(screen.queryByText('音乐')).not.toBeInTheDocument();
  });
});
