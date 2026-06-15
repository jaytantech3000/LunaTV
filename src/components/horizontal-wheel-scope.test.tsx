'use client';

import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  })),
}));

import EpgScrollableRow from './EpgScrollableRow';
import EpisodeSelector from './EpisodeSelector';

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

  it('prefers the related video callback over direct location navigation', () => {
    const onRelatedVideoSelect = jest.fn();

    render(
      <EpisodeSelector
        totalEpisodes={1}
        episodes_titles={['HD']}
        value={1}
        sourceSwitchEnabled={false}
        episodeTabLabel='相关视频'
        episodeListVariant='related-videos'
        relatedVideos={[
          {
            contentId: 'adult-source-a:1',
            title: 'Miuzxc 深夜企划',
            poster: '',
            sourceName: '🔞线路A',
            year: '2026',
            episodeCount: 1,
            href: '/play?offline=1&contentId=adult-source-a%3A1',
          },
        ]}
        onRelatedVideoSelect={onRelatedVideoSelect}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Miuzxc 深夜企划/i }));

    expect(onRelatedVideoSelect).toHaveBeenCalledWith(
      'adult-source-a:1',
      '/play?offline=1&contentId=adult-source-a%3A1'
    );
  });

  it('renders a more button for related videos and calls the header action', () => {
    const onEpisodeHeaderAction = jest.fn();

    render(
      <EpisodeSelector
        totalEpisodes={1}
        episodes_titles={['HD']}
        value={1}
        sourceSwitchEnabled={false}
        episodeTabLabel='相关视频'
        episodeListVariant='related-videos'
        relatedVideos={[]}
        episodeHeaderActionLabel='更多'
        onEpisodeHeaderAction={onEpisodeHeaderAction}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '更多' }));

    expect(onEpisodeHeaderAction).toHaveBeenCalledTimes(1);
  });
});
