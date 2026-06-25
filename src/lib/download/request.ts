const RETRYABLE_DOWNLOAD_HTTP_STATUS_SET = new Set([
  408, 425, 429, 500, 502, 503, 504,
]);

export const DOWNLOAD_ERROR_CODE_MISSING_PLAYBACK_SOURCE =
  'download_missing_playback_source';

export type DownloadRequestErrorKind = 'http' | 'network' | 'timeout';

interface DownloadRequestErrorParams {
  message: string;
  kind: DownloadRequestErrorKind;
  url: string;
  status?: number;
  cause?: unknown;
}

interface DownloadDomainErrorParams {
  code: string;
  message: string;
  status?: number;
  cause?: unknown;
}

export class DownloadRequestError extends Error {
  readonly kind: DownloadRequestErrorKind;

  readonly url: string;

  readonly status?: number;

  constructor(params: DownloadRequestErrorParams) {
    super(params.message);
    this.name = 'DownloadRequestError';
    this.kind = params.kind;
    this.url = params.url;
    this.status = params.status;

    if (params.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: params.cause,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
  }
}

export class DownloadDomainError extends Error {
  readonly code: string;

  readonly status?: number;

  constructor(params: DownloadDomainErrorParams) {
    super(params.message);
    this.name = 'DownloadDomainError';
    this.code = params.code;
    this.status = params.status;

    if (params.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: params.cause,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
  }
}

function buildAbortErrorReason(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('Request timeout', 'AbortError');
  }

  const abortError = new Error('Request timeout');
  abortError.name = 'AbortError';
  return abortError;
}

function abortController(controller: AbortController, reason?: unknown): void {
  if (controller.signal.aborted) {
    return;
  }

  try {
    controller.abort(reason);
  } catch {
    controller.abort();
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function isDownloadDomainError(
  error: unknown
): error is DownloadDomainError {
  return error instanceof DownloadDomainError;
}

export function isDownloadDomainErrorCode(
  error: unknown,
  code: string
): boolean {
  return isDownloadDomainError(error) && error.code === code;
}

export function createMissingPlaybackSourceDownloadError(): DownloadDomainError {
  return new DownloadDomainError({
    code: DOWNLOAD_ERROR_CODE_MISSING_PLAYBACK_SOURCE,
    message: '当前剧集缺少可下载的播放地址',
  });
}

export function isRetryableDownloadError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  if (error instanceof DownloadRequestError) {
    if (error.kind === 'network' || error.kind === 'timeout') {
      return true;
    }

    return (
      typeof error.status === 'number' &&
      RETRYABLE_DOWNLOAD_HTTP_STATUS_SET.has(error.status)
    );
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const normalizedMessage = error.message.trim().toLowerCase();
  return (
    normalizedMessage.includes('networkerror') ||
    normalizedMessage.includes('failed to fetch') ||
    normalizedMessage.includes('timeout')
  );
}

export function waitForRetry(attempt: number): Promise<void> {
  const clampedAttempt = Math.max(1, attempt);
  const delayMs = Math.min(1_500, 250 * clampedAttempt);

  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export function createTimeoutAbortSignal(params: {
  sourceSignal?: AbortSignal;
  timeoutMs: number;
}): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const { sourceSignal, timeoutMs } = params;
  let didTimeout = false;

  const handleSourceAbort = () => {
    abortController(controller, sourceSignal?.reason);
  };

  if (sourceSignal?.aborted) {
    handleSourceAbort();
  } else if (sourceSignal) {
    sourceSignal.addEventListener('abort', handleSourceAbort, {
      once: true,
    });
  }

  const timeoutId = setTimeout(() => {
    didTimeout = true;
    abortController(controller, buildAbortErrorReason());
  }, Math.max(1, timeoutMs));

  return {
    signal: controller.signal,
    didTimeout: () => didTimeout,
    cleanup: () => {
      clearTimeout(timeoutId);
      sourceSignal?.removeEventListener('abort', handleSourceAbort);
    },
  };
}
