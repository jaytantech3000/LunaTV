'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

jest.mock('@/lib/scroll-lock', () => ({
  acquireScrollLock: jest.fn(() => jest.fn()),
}));

import { VersionPanel } from './VersionPanel';

describe('VersionPanel', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.localStorage.clear();
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('CHANGELOG.en')) {
        return Promise.resolve(
          new Response(
            [
              '## [100.1.4] - 2026-06-17',
              '',
              '### Fixed',
              '',
              '- Fix remote english release note.',
            ].join('\n')
          )
        );
      }

      return Promise.resolve(
        new Response(
          [
            '## [100.1.4] - 2026-06-17',
            '',
            '### Fixed',
            '',
            '- 修复远程中文发布说明。',
          ].join('\n')
        )
      );
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('switches locale and reloads the matching remote changelog file', async () => {
    render(<VersionPanel isOpen onClose={jest.fn()} />);

    expect(await screen.findByText('版本信息')).toBeInTheDocument();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/CHANGELOG'),
        expect.objectContaining({ cache: 'no-store' })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/CHANGELOG.en'),
        expect.objectContaining({ cache: 'no-store' })
      );
    });

    expect(await screen.findByText('Version Info')).toBeInTheDocument();
    expect(screen.getByText('Changelog')).toBeInTheDocument();
    expect(screen.getByText('Open Repository')).toBeInTheDocument();
    expect(
      window.localStorage.getItem('lunatv:version-panel:changelog-locale')
    ).toBe('en');
  });
});
