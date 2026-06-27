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
  it('renders the expanded player as a dialog and exposes queue, lyrics, repeat, and shuffle controls', () => {
    const handlePanelChange = jest.fn();
    const handleRepeat = jest.fn();
    const handleShuffle = jest.fn();

    render(
      <MusicFullscreenPlayer
        open={true}
        track={queue[0]}
        queue={queue}
        currentIndex={0}
        repeatMode='all'
        shuffleEnabled={false}
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
        activePanel='lyrics'
        onMinimize={() => undefined}
        onDismiss={() => undefined}
        onTogglePlay={() => undefined}
        onPlayPrevious={() => undefined}
        onPlayNext={() => undefined}
        onCycleRepeatMode={handleRepeat}
        onToggleShuffle={handleShuffle}
        onSeek={() => undefined}
        onVolumeChange={() => undefined}
        onToggleMute={() => undefined}
        onToggleFavorite={() => undefined}
        onSelectQueueIndex={() => undefined}
        onPanelChange={handlePanelChange}
      />
    );

    expect(
      screen.getByRole('dialog', { name: '展开播放器' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '切换到队列视图' }));
    fireEvent.click(screen.getByRole('button', { name: '切换重复模式' }));
    fireEvent.click(screen.getByRole('button', { name: '切换随机播放' }));

    expect(handlePanelChange).toHaveBeenCalledWith('queue');
    expect(handleRepeat).toHaveBeenCalledTimes(1);
    expect(handleShuffle).toHaveBeenCalledTimes(1);
  });
});
