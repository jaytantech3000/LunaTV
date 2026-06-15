'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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
  const [isExpanded, setIsExpanded] = useState(false);
  const previousEnabledRef = useRef(false);

  useEffect(() => {
    const enabled = Boolean(status?.enabled);

    if (!enabled || !previousEnabledRef.current) {
      setIsExpanded(false);
    }

    previousEnabledRef.current = enabled;
  }, [status?.enabled]);

  if (!status || !status.enabled) {
    return null;
  }

  const modeLabels = [
    status.dynamicProtectionEnabled ? '动态保护' : null,
    status.fixedCeilingEnabled ? '固定上限' : null,
  ].filter(Boolean);

  return (
    <div className='pointer-events-auto absolute top-3 right-3 z-[65] text-[11px] text-white'>
      <div className='rounded-2xl border border-white/15 bg-black/70 shadow-lg backdrop-blur-sm'>
        <button
          type='button'
          onClick={() => setIsExpanded((currentState) => !currentState)}
          aria-expanded={isExpanded}
          aria-label={
            isExpanded ? '收起音量突增保护详情' : '展开音量突增保护详情'
          }
          className='flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5'
        >
          <span
            className={`inline-flex rounded-full px-2 py-0.5 font-medium ${
              status.limited ? 'bg-red-500/85' : 'bg-emerald-500/85'
            }`}
          >
            {status.limited ? '限制中' : '监测中'}
          </span>
          <span className='text-white/85'>
            {getAudioSpikeProtectionLevelLabel(status.level)}
          </span>
          {modeLabels.length > 0 && (
            <span className='hidden text-white/55 sm:inline'>
              {modeLabels.join(' / ')}
            </span>
          )}
          <span className='ml-auto text-white/55'>
            {isExpanded ? (
              <ChevronUp className='h-3.5 w-3.5' />
            ) : (
              <ChevronDown className='h-3.5 w-3.5' />
            )}
          </span>
        </button>

        {isExpanded && (
          <div className='border-t border-white/10 px-3 py-2'>
            <div className='flex flex-wrap items-center gap-3 text-white/85'>
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
        )}
      </div>
    </div>
  );
}
