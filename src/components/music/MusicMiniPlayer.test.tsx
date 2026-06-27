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
  it('renders yesplaymusic-style queue, lyrics, repeat, shuffle, and favorite controls', () => {
    const handleVolumeChange = jest.fn();
    const handleFavorite = jest.fn();
    const handleQueue = jest.fn();
    const handleLyrics = jest.fn();
    const handleRepeat = jest.fn();
    const handleShuffle = jest.fn();
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
        repeatMode='all'
        shuffleEnabled={false}
        isFavorited={false}
        isFavoriteLoading={false}
        onTogglePlay={() => undefined}
        onPlayPrevious={() => undefined}
        onPlayNext={() => undefined}
        onSeek={() => undefined}
        onVolumeChange={handleVolumeChange}
        onToggleMute={() => undefined}
        onToggleFavorite={handleFavorite}
        onCycleRepeatMode={handleRepeat}
        onToggleShuffle={handleShuffle}
        onDismiss={handleDismiss}
        onOpenQueue={handleQueue}
        onOpenLyrics={handleLyrics}
      />
    );

    expect(
      screen.getByRole('group', { name: '播放器控制条' })
    ).toBeInTheDocument();
    expect(screen.getByText('夜色电子')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('slider', { name: '音量' }), {
      target: { value: '0.2' },
    });
    fireEvent.click(screen.getByRole('button', { name: '收藏当前歌曲' }));
    fireEvent.click(screen.getByRole('button', { name: '切换重复模式' }));
    fireEvent.click(screen.getByRole('button', { name: '切换随机播放' }));
    fireEvent.click(screen.getByRole('button', { name: '打开播放队列' }));
    fireEvent.click(screen.getAllByRole('button', { name: '打开歌词视图' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '关闭播放器' }));

    expect(handleVolumeChange).toHaveBeenCalledWith(0.2);
    expect(handleFavorite).toHaveBeenCalledTimes(1);
    expect(handleRepeat).toHaveBeenCalledTimes(1);
    expect(handleShuffle).toHaveBeenCalledTimes(1);
    expect(handleQueue).toHaveBeenCalledTimes(1);
    expect(handleLyrics).toHaveBeenCalledTimes(1);
    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });
});
