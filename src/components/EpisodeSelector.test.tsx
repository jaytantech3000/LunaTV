'use client';

import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  })),
}));

import EpisodeSelector from './EpisodeSelector';

describe('EpisodeSelector', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      value: jest.fn(),
      writable: true,
    });
  });

  it('marks new episodes in the episode grid', () => {
    render(
      <EpisodeSelector
        totalEpisodes={4}
        episodes_titles={['第1集', '第2集', '第3集', '第4集']}
        value={1}
        newEpisodeStart={3}
        newEpisodeEnd={4}
      />
    );

    expect(screen.getAllByText('新')).toHaveLength(2);
  });
});
