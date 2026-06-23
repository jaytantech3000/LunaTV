'use client';

/* eslint-disable @next/next/no-img-element */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({
    alt,
    fill: _fill,
    ...props
  }: React.ComponentProps<'img'> & { fill?: boolean }) => (
    <img {...props} alt={alt || ''} />
  ),
}));

jest.mock('@/lib/scroll-lock', () => ({
  acquireScrollLock: jest.fn(() => jest.fn()),
}));

import MobileActionSheet from './MobileActionSheet';

describe('MobileActionSheet', () => {
  beforeEach(() => {
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        return window.setTimeout(() => callback(performance.now()), 0);
      });
    jest
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((handle: number) => {
        window.clearTimeout(handle);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function buildActions() {
    return [
      {
        id: 'play',
        label: '播放',
        icon: <span>play</span>,
        onClick: jest.fn(),
      },
    ];
  }

  it('closes when clicking outside the action sheet', async () => {
    function Wrapper() {
      const [isOpen, setIsOpen] = React.useState(true);

      return (
        <div>
          <button type='button'>outside</button>
          <MobileActionSheet
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            title='测试菜单'
            actions={buildActions()}
          />
          {!isOpen ? <div data-testid='sheet-closed'>closed</div> : null}
        </div>
      );
    }

    render(<Wrapper />);

    expect(screen.getByText('测试菜单')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.getByTestId('sheet-closed')).toBeInTheDocument();
    });
  });

  it('renders the sheet into document.body via portal', () => {
    const { container } = render(
      <MobileActionSheet
        isOpen={true}
        onClose={jest.fn()}
        title='portal-menu'
        actions={buildActions()}
      />
    );

    expect(container).not.toHaveTextContent('portal-menu');
    expect(screen.getByText('portal-menu')).toBeInTheDocument();
  });

  it('keeps the sheet open when clicking inside the panel', () => {
    const onClose = jest.fn();

    render(
      <MobileActionSheet
        isOpen={true}
        onClose={onClose}
        title='测试菜单'
        actions={buildActions()}
      />
    );

    fireEvent.pointerDown(screen.getByText('测试菜单'));

    expect(onClose).not.toHaveBeenCalled();
  });
});
