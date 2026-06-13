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
  if (!status || !status.enabled) {
    return null;
  }

  const modeLabels = [
    status.dynamicProtectionEnabled ? '动态保护' : null,
    status.fixedCeilingEnabled ? '固定上限' : null,
  ].filter(Boolean);

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
        {modeLabels.length > 0 && (
          <span className='text-white/55'>{modeLabels.join(' / ')}</span>
        )}
      </div>
      <div className='mt-1 flex items-center gap-3 text-white/85'>
        <span>输入 {formatDbValue(status.inputDb)}</span>
        <span>输出 {formatDbValue(status.currentDb)}</span>
        {status.fixedCeilingEnabled && (
          <span>上限 {formatDbValue(status.ceilingDb)}</span>
        )}
      </div>
      <div className='mt-1 text-white/70'>
        {status.reductionDb > 0.1
          ? `当前压制 ${status.reductionDb.toFixed(1)} dB${
              status.dynamicReductionDb > status.fixedCeilingReductionDb
                ? '（动态）'
                : status.fixedCeilingReductionDb > 0
                  ? '（固定上限）'
                  : ''
            }`
          : '当前未触发额外压制'}
      </div>
    </div>
  );
}
