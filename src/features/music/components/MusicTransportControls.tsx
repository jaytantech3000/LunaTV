'use client';

import { useMusicDataStore } from '../state/music-data-store';
import {
  selectCurrentQueueItem,
  usePlaybackStore,
} from '../state/playback-store';

interface MusicTransportControlsProps {
  compact?: boolean;
}

export function MusicTransportControls(props: MusicTransportControlsProps) {
  const { compact = false } = props;
  const currentTrack = usePlaybackStore(selectCurrentQueueItem);
  const playPrevious = usePlaybackStore((state) => state.playPrevious);
  const playState = usePlaybackStore((state) => state.playState);
  const setPlayState = usePlaybackStore((state) => state.setPlayState);
  const advancePlayback = useMusicDataStore((state) => state.advancePlayback);
  const trashCurrentPersonalFmTrack = useMusicDataStore(
    (state) => state.trashCurrentPersonalFmTrack
  );
  const canControlPlayback = Boolean(currentTrack);
  const personalFmActive = currentTrack?.fromContext === 'fm';
  const isPlaying = playState === 'playing';
  const secondaryButtonClass = compact
    ? 'rounded-full border border-white/12 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-white/72 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:border-white/8 disabled:text-white/28'
    : 'rounded-full border border-white/12 px-4 py-2 text-xs uppercase tracking-[0.22em] text-white/72 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:border-white/8 disabled:text-white/28';
  const primaryButtonClass = compact
    ? 'rounded-full bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-950 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/25 disabled:text-slate-700'
    : 'rounded-full bg-white px-5 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-950 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/25 disabled:text-slate-700';

  return (
    <div
      className={`flex items-center ${compact ? 'gap-2' : 'gap-3'}`}
      data-testid={
        compact
          ? 'music-transport-controls-compact'
          : 'music-transport-controls'
      }
    >
      <button
        type='button'
        aria-label='Previous track'
        onClick={playPrevious}
        disabled={!canControlPlayback}
        className={secondaryButtonClass}
      >
        Prev
      </button>
      <button
        type='button'
        aria-label={isPlaying ? 'Pause track' : 'Resume track'}
        onClick={() => setPlayState(isPlaying ? 'paused' : 'playing')}
        disabled={!canControlPlayback}
        className={primaryButtonClass}
      >
        {isPlaying ? 'Pause' : 'Play'}
      </button>
      <button
        type='button'
        aria-label='Next track'
        onClick={() => {
          void advancePlayback();
        }}
        disabled={!canControlPlayback}
        className={secondaryButtonClass}
      >
        Next
      </button>
      {personalFmActive ? (
        <button
          type='button'
          aria-label='Trash FM track'
          onClick={() => {
            void trashCurrentPersonalFmTrack();
          }}
          disabled={!canControlPlayback}
          className={secondaryButtonClass}
        >
          Trash
        </button>
      ) : null}
    </div>
  );
}
