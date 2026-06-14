'use client';

import { render } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  })),
}));

import EpisodeSelector from './EpisodeSelector';
import EpgScrollableRow from './EpgScrollableRow';

function buildEpisodeTitles(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `第${index + 1}集`);
}

describe('horizontal wheel scope', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      value: jest.fn(),
      writable: true,
    });
  });

  it('does not register document-level wheel listeners in EpisodeSelector', () => {
    const addEventListenerSpy = jest.spyOn(document, 'addEventListener');

    render(
      <EpisodeSelector
        totalEpisodes={120}
        episodes_titles={buildEpisodeTitles(120)}
        value={1}
      />
    );

    expect(
      addEventListenerSpy.mock.calls.some(([type]) => type === 'wheel')
    ).toBe(false);
  });

  it('does not register document-level wheel listeners in EpgScrollableRow', () => {
    const addEventListenerSpy = jest.spyOn(document, 'addEventListener');

    render(
      <EpgScrollableRow
        programs={[
          {
            start: '20250614080000 +0800',
            end: '20250614090000 +0800',
            title: '晨间节目',
          },
          {
            start: '20250614090000 +0800',
            end: '20250614100000 +0800',
            title: '午间节目',
          },
        ]}
      />
    );

    expect(
      addEventListenerSpy.mock.calls.some(([type]) => type === 'wheel')
    ).toBe(false);
  });
});
