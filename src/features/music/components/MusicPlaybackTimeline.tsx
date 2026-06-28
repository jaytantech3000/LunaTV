'use client';

import { formatMusicClock } from '../services/music-formatters';
import { usePlaybackStore } from '../state/playback-store';

interface MusicPlaybackTimelineProps {
  compact?: boolean;
}

export function MusicPlaybackTimeline(props: MusicPlaybackTimelineProps) {
  const { compact = false } = props;
  const durationMs = usePlaybackStore((state) => state.durationMs);
  const positionMs = usePlaybackStore((state) => state.positionMs);
  const requestSeek = usePlaybackStore((state) => state.requestSeek);
  const safeDurationMs = Math.max(durationMs, 1);
  const safePositionMs = Math.min(positionMs, safeDurationMs);

  return (
    <div
      className={compact ? 'space-y-1.5' : 'space-y-2'}
      data-testid={
        compact ? 'music-playback-timeline-compact' : 'music-playback-timeline'
      }
    >
      <input
        type='range'
        min={0}
        max={safeDurationMs}
        step={1000}
        value={safePositionMs}
        aria-label='Seek playback'
        onChange={(event) => requestSeek(Number(event.currentTarget.value))}
        className={
          compact
            ? 'h-1 w-full cursor-pointer appearance-none rounded-full bg-white/14 accent-white'
            : 'h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/12 accent-white'
        }
      />
      <div
        className={`flex items-center justify-between tabular-nums text-white/55 ${
          compact ? 'text-[11px]' : 'text-xs'
        }`}
      >
        <span>{formatMusicClock(positionMs)}</span>
        <span>{formatMusicClock(durationMs)}</span>
      </div>
    </div>
  );
}
