'use client';

interface MusicDownloadDesktopHintProps {
  compact?: boolean;
}

export function MusicDownloadDesktopHint(
  props: MusicDownloadDesktopHintProps
): JSX.Element {
  const { compact = false } = props;

  return (
    <div
      role='note'
      className={`rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/62 ${
        compact ? 'text-[11px] uppercase tracking-[0.22em]' : ''
      }`}
    >
      Downloads are available in the desktop app.
    </div>
  );
}
