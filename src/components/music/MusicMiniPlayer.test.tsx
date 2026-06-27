'use client';

import { fireEvent, render, screen } from '@testing-library/react';

import type { PlayerQueueItem } from '@/lib/music/types';

import MusicMiniPlayer from './MusicMiniPlayer';

const track: PlayerQueueItem = {
  trackId: 'netease-track-1',
  source: 'netease',
  title: '霓虹夜航',
  artistsText: 'Luna Drive',
  cover: 'https://example.com/cover.jpg',
  durationMs: 188000,
  albumTitle: 'Midnight Circuits',
  subtitle: '夜色电子',
};

describe('MusicMiniPlayer', () => {
  it('renders volume, stop, and dismiss controls', () => {
    const handleVolumeChange = jest.fn();
    const handleStop = jest.fn();
    const handleDismiss = jest.fn();

    render(
      <MusicMiniPlayer
        track={track}
        sidebarCollapsed={false}
        isPlaying={true}
        isTrackLoading={false}
        trackError={null}
        currentTimeSec={24}
        durationSec={188}
        volume={0.45}
        muted={false}
        onTogglePlay={() => undefined}
        onPlayPrevious={() => undefined}
        onPlayNext={() => undefined}
        onSeek={() => undefined}
        onVolumeChange={handleVolumeChange}
        onToggleMute={() => undefined}
        onStop={handleStop}
        onDismiss={handleDismiss}
        onExpand={() => undefined}
      />
    );

    fireEvent.change(screen.getByRole('slider', { name: '音量' }), {
      target: { value: '0.2' },
    });
    fireEvent.click(screen.getByRole('button', { name: '停止播放' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭播放器' }));

    expect(handleVolumeChange).toHaveBeenCalledWith(0.2);
    expect(handleStop).toHaveBeenCalledTimes(1);
    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });
});
