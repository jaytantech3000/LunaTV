export type HlsFatalErrorType = 'network' | 'media' | 'other';

export interface HlsRecoveryActions {
  startLoad: () => void;
  recoverMediaError: () => void;
  swapAudioCodec?: () => void;
}

export interface HlsRecoveryOptions {
  /**
   * Fatal network errors are recovered with `startLoad()`, which restarts a
   * VOD stream from the playlist head when the buffer is empty; cap it so a
   * persistently failing source cannot loop playback from the beginning.
   */
  maxNetworkRecoveries?: number;
  /**
   * First fatal media error recovers with `recoverMediaError()`; the next one
   * also swaps the audio codec; exhausting the budget gives up.
   */
  maxMediaRecoveries?: number;
  onExhausted?: (info: { type: HlsFatalErrorType; message: string }) => void;
}

export const DEFAULT_MAX_HLS_RECOVERIES = 3;

/**
 * Bounded recovery policy for fatal hls.js errors. Without a cap, an endless
 * startLoad/recoverMediaError cycle makes VOD playback restart from the head
 * forever when the upstream keeps failing.
 */
export class HlsFatalErrorRecovery {
  private networkRecoveries = 0;
  private mediaRecoveries = 0;
  private exhausted = false;

  constructor(
    private readonly actions: HlsRecoveryActions,
    private readonly options: HlsRecoveryOptions = {}
  ) {}

  handleFatal(type: HlsFatalErrorType): void {
    if (this.exhausted) {
      return;
    }

    if (type === 'network') {
      const max =
        this.options.maxNetworkRecoveries ?? DEFAULT_MAX_HLS_RECOVERIES;
      if (this.networkRecoveries >= max) {
        this.giveUp(type);
        return;
      }
      this.networkRecoveries += 1;
      this.actions.startLoad();
      return;
    }

    if (type === 'media') {
      const max = this.options.maxMediaRecoveries ?? DEFAULT_MAX_HLS_RECOVERIES;
      if (this.mediaRecoveries >= max) {
        this.giveUp(type);
        return;
      }
      this.mediaRecoveries += 1;
      if (this.mediaRecoveries > 1 && this.actions.swapAudioCodec) {
        this.actions.swapAudioCodec();
      }
      this.actions.recoverMediaError();
      return;
    }

    this.giveUp('other');
  }

  /** Successful fragment buffering proves the stream is healthy again. */
  reset(): void {
    this.networkRecoveries = 0;
    this.mediaRecoveries = 0;
    this.exhausted = false;
  }

  isExhausted(): boolean {
    return this.exhausted;
  }

  private giveUp(type: HlsFatalErrorType): void {
    this.exhausted = true;
    this.options.onExhausted?.({
      type,
      message:
        type === 'media'
          ? '视频解码多次恢复失败，请切换清晰度或更换播放源后重试'
          : '网络多次重试失败，请检查网络后重试或更换播放源',
    });
  }
}
