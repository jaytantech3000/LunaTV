'use client';

import { fireEvent, render, screen } from '@testing-library/react';

import { AudioSpikeProtectionStatus } from '@/lib/player-enhancement-runtime';

import PlayerEnhancementStatusOverlay from './PlayerEnhancementStatusOverlay';

function buildStatus(
  overrides: Partial<AudioSpikeProtectionStatus> = {}
): AudioSpikeProtectionStatus {
  return {
    level: 'standard',
    enabled: true,
    dynamicProtectionEnabled: true,
    fixedCeilingEnabled: true,
    inputDb: -7.6,
    currentDb: -9.8,
    baselineDb: -23.4,
    ceilingDb: -4.5,
    reductionDb: 2.2,
    dynamicReductionDb: 2.2,
    fixedCeilingReductionDb: 0,
    limited: false,
    ...overrides,
  };
}

describe('PlayerEnhancementStatusOverlay', () => {
  it('starts collapsed and expands only after click', () => {
    render(<PlayerEnhancementStatusOverlay status={buildStatus()} />);

    expect(
      screen.getByRole('button', { name: '展开音量突增保护详情' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/输入 -7.6 dBFS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/当前压制 2.2 dB/)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: '展开音量突增保护详情' })
    );

    expect(
      screen.getByRole('button', { name: '收起音量突增保护详情' })
    ).toBeInTheDocument();
    expect(screen.getByText('输入 -7.6 dBFS')).toBeInTheDocument();
    expect(screen.getByText('当前压制 2.2 dB（动态）')).toBeInTheDocument();
  });

  it('collapses again after the protection is disabled and re-enabled', () => {
    const { rerender } = render(
      <PlayerEnhancementStatusOverlay status={buildStatus()} />
    );

    fireEvent.click(
      screen.getByRole('button', { name: '展开音量突增保护详情' })
    );
    expect(screen.getByText('输入 -7.6 dBFS')).toBeInTheDocument();

    rerender(
      <PlayerEnhancementStatusOverlay
        status={buildStatus({
          enabled: false,
        })}
      />
    );
    expect(
      screen.queryByRole('button', { name: '收起音量突增保护详情' })
    ).not.toBeInTheDocument();

    rerender(<PlayerEnhancementStatusOverlay status={buildStatus()} />);

    expect(
      screen.getByRole('button', { name: '展开音量突增保护详情' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/输入 -7.6 dBFS/)).not.toBeInTheDocument();
  });
});
