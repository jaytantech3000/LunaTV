import {
  DEFAULT_MAX_HLS_RECOVERIES,
  HlsFatalErrorRecovery,
} from './hls-recovery';

function createActions() {
  const calls = {
    startLoad: 0,
    recoverMediaError: 0,
    swapAudioCodec: 0,
    destroyed: 0,
  };
  return {
    calls,
    actions: {
      startLoad: () => {
        calls.startLoad += 1;
      },
      recoverMediaError: () => {
        calls.recoverMediaError += 1;
      },
      swapAudioCodec: () => {
        calls.swapAudioCodec += 1;
      },
    },
  };
}

describe('HlsFatalErrorRecovery', () => {
  it('uses the default recovery budget of 3', () => {
    expect(DEFAULT_MAX_HLS_RECOVERIES).toBe(3);
  });

  it('recovers fatal network errors up to the cap, then gives up', () => {
    const { calls, actions } = createActions();
    const exhausted: string[] = [];
    const recovery = new HlsFatalErrorRecovery(actions, {
      onExhausted: ({ type, message }) => {
        exhausted.push(type);
        expect(message).toContain('网络');
      },
    });

    recovery.handleFatal('network');
    recovery.handleFatal('network');
    recovery.handleFatal('network');
    expect(calls.startLoad).toBe(3);

    recovery.handleFatal('network');
    expect(calls.startLoad).toBe(3);
    expect(exhausted).toEqual(['network']);
    expect(recovery.isExhausted()).toBe(true);
  });

  it('ignores errors after giving up', () => {
    const { calls, actions } = createActions();
    const recovery = new HlsFatalErrorRecovery(actions, {
      onExhausted: () => undefined,
    });

    recovery.handleFatal('other');
    recovery.handleFatal('network');
    recovery.handleFatal('media');

    expect(calls.startLoad).toBe(0);
    expect(calls.recoverMediaError).toBe(0);
  });

  it('recovers the first media error with recoverMediaError only', () => {
    const { calls, actions } = createActions();
    const recovery = new HlsFatalErrorRecovery(actions);

    recovery.handleFatal('media');

    expect(calls.recoverMediaError).toBe(1);
    expect(calls.swapAudioCodec).toBe(0);
  });

  it('swaps the audio codec on the second media recovery', () => {
    const { calls, actions } = createActions();
    const recovery = new HlsFatalErrorRecovery(actions);

    recovery.handleFatal('media');
    recovery.handleFatal('media');

    expect(calls.recoverMediaError).toBe(2);
    expect(calls.swapAudioCodec).toBe(1);
  });

  it('gives up after exhausting the media recovery budget', () => {
    const { calls, actions } = createActions();
    const exhausted: string[] = [];
    const recovery = new HlsFatalErrorRecovery(actions, {
      onExhausted: ({ type }) => {
        exhausted.push(type);
      },
    });

    recovery.handleFatal('media');
    recovery.handleFatal('media');
    recovery.handleFatal('media');
    recovery.handleFatal('media');

    expect(calls.recoverMediaError).toBe(3);
    expect(exhausted).toEqual(['media']);
  });

  it('falls back to recoverMediaError-only when swapAudioCodec is unavailable', () => {
    const calls = { recoverMediaError: 0 };
    const recovery = new HlsFatalErrorRecovery({
      startLoad: () => undefined,
      recoverMediaError: () => {
        calls.recoverMediaError += 1;
      },
    });

    recovery.handleFatal('media');
    recovery.handleFatal('media');
    recovery.handleFatal('media');

    expect(calls.recoverMediaError).toBe(3);
    expect(recovery.isExhausted()).toBe(false);
  });

  it('stops immediately on unrecoverable fatal errors', () => {
    const { calls, actions } = createActions();
    const exhausted: string[] = [];
    const recovery = new HlsFatalErrorRecovery(actions, {
      onExhausted: ({ type }) => {
        exhausted.push(type);
      },
    });

    recovery.handleFatal('other');

    expect(calls.startLoad).toBe(0);
    expect(calls.recoverMediaError).toBe(0);
    expect(exhausted).toEqual(['other']);
  });

  it('resets the budget after successful buffering', () => {
    const { calls, actions } = createActions();
    const recovery = new HlsFatalErrorRecovery(actions);

    recovery.handleFatal('network');
    recovery.handleFatal('network');
    recovery.reset();
    recovery.handleFatal('network');
    recovery.handleFatal('network');
    recovery.handleFatal('network');

    expect(calls.startLoad).toBe(5);
    expect(recovery.isExhausted()).toBe(false);

    recovery.handleFatal('network');
    expect(recovery.isExhausted()).toBe(true);
  });

  it('tracks network and media budgets independently', () => {
    const { calls, actions } = createActions();
    const recovery = new HlsFatalErrorRecovery(actions);

    recovery.handleFatal('network');
    recovery.handleFatal('media');

    expect(calls.startLoad).toBe(1);
    expect(calls.recoverMediaError).toBe(1);
    expect(recovery.isExhausted()).toBe(false);
  });
});
