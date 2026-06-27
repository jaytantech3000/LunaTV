'use client';

import { fireEvent, render, screen } from '@testing-library/react';

import type { MusicLyricPayload, PlayerQueueItem } from '@/lib/music/types';

import MusicFullscreenPlayer from './MusicFullscreenPlayer';

const queue: PlayerQueueItem[] = [
  {
    trackId: 'netease-track-1',
    source: 'netease',
    title: '霓虹夜航',
    artistsText: 'Luna Drive',
    cover: 'https://example.com/cover.jpg',
    durationMs: 188000,
    albumTitle: 'Midnight Circuits',
    subtitle: '夜色电子',
  },
];

const lyrics: MusicLyricPayload = {
  trackId: 'netease-track-1',
  source: 'netease',
  lines: [
    {
      timeMs: 1000,
      text: '第一句歌词',
    },
  ],
};

describe('MusicFullscreenPlayer', () => {
  it('renders the expanded player as a dialog and switches to the queue tab', () => {
    render(
      <MusicFullscreenPlayer
        open={true}
        track={queue[0]}
        queue={queue}
        currentIndex={0}
        playMode='list-loop'
        isPlaying={true}
        isTrackLoading={false}
        trackError={null}
        currentTimeSec={24}
        durationSec={188}
        volume={0.45}
        muted={false}
        lyrics={lyrics}
        isFavorited={false}
        isFavoriteLoading={false}
        onMinimize={() => undefined}
        onDismiss={() => undefined}
        onStop={() => undefined}
        onTogglePlay={() => undefined}
        onPlayPrevious={() => undefined}
        onPlayNext={() => undefined}
        onCyclePlayMode={() => undefined}
        onSeek={() => undefined}
        onVolumeChange={() => undefined}
        onToggleMute={() => undefined}
        onToggleFavorite={() => undefined}
        onSelectQueueIndex={() => undefined}
      />
    );

    expect(
      screen.getByRole('dialog', { name: '展开播放器' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '队列' }));

    expect(screen.getAllByText('霓虹夜航').length).toBeGreaterThan(1);
  });
});
