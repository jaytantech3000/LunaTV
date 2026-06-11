'use client';

import { AudioSpikeProtectionStatus } from '@/lib/player-enhancement-runtime';
import { getAudioSpikeProtectionLevelLabel } from '@/lib/player-enhancement-types';

function formatDbValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '--';
  }

  return `${value.toFixed(1)} dBFS`;
}

interface PlayerEnhancementStatusOverlayProps {
  status: AudioSpikeProtectionStatus | null;
}

export default function PlayerEnhancementStatusOverlay({
  status,
}: PlayerEnhancementStatusOverlayProps) {
  if (!status || status.level === 'off') {
    return null;
  }

  return (
    <div className='pointer-events-none absolute top-3 right-3 z-[65] rounded-2xl border border-white/15 bg-black/70 px-3 py-2 text-[11px] text-white shadow-lg backdrop-blur-sm'>
      <div className='flex items-center gap-2'>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 font-medium ${
            status.limited ? 'bg-red-500/85' : 'bg-emerald-500/85'
          }`}
        >
          {status.limited ? '限制中' : '监测中'}
        </span>
        <span className='text-white/80'>
          {getAudioSpikeProtectionLevelLabel(status.level)}
        </span>
      </div>
      <div className='mt-1 flex items-center gap-3 text-white/85'>
        <span>输入 {formatDbValue(status.inputDb)}</span>
        <span>输出 {formatDbValue(status.currentDb)}</span>
        <span>上限 {formatDbValue(status.ceilingDb)}</span>
      </div>
      <div className='mt-1 text-white/70'>
        {status.reductionDb > 0.1
          ? `当前压制 ${status.reductionDb.toFixed(1)} dB`
          : '当前未触发额外压制'}
      </div>
    </div>
  );
}
