'use client';

/* eslint-disable no-console */

import { create } from 'zustand';

import type {
  LiveMusicSourceKey,
  MusicAccountEntity,
  MusicAccountQrStatus,
} from '../domain/entities';
import {
  connectMusicAccountSession,
  createMusicAccountQrSession,
  disconnectMusicAccountSession,
  fetchMusicAccountState,
  pollMusicAccountQrSession,
} from '../services/music-account-api-client';

const QR_POLL_INTERVAL_MS = 1000;

interface MusicAccountQrViewState {
  status: 'idle' | 'loading' | MusicAccountQrStatus | 'error';
  key: string | null;
  qrUrl: string | null;
  qrImageDataUrl: string | null;
  message: string | null;
}

function createIdleQrState(): MusicAccountQrViewState {
  return {
    status: 'idle',
    key: null,
    qrUrl: null,
    qrImageDataUrl: null,
    message: null,
  };
}

let qrPollingTimer: ReturnType<typeof setTimeout> | null = null;

function clearQrPollingTimer(): void {
  if (qrPollingTimer) {
    clearTimeout(qrPollingTimer);
    qrPollingTimer = null;
  }
}

function createSignedOutAccountState(
  source: LiveMusicSourceKey
): MusicAccountEntity {
  return {
    source,
    authenticated: false,
    profile: null,
    playlists: [],
  };
}

function resolveAccountErrorMessage(
  error: unknown,
  fallbackMessage: string
): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallbackMessage;
}

interface MusicAccountState {
  source: LiveMusicSourceKey;
  account: MusicAccountEntity | null;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  qrState: MusicAccountQrViewState;
  hydrateAccount: () => Promise<void>;
  connectSession: (cookie: string) => Promise<boolean>;
  disconnectSession: () => Promise<void>;
  startQrLogin: () => Promise<void>;
  retryQrLogin: () => Promise<void>;
  stopQrLoginPolling: () => void;
}

export const useMusicAccountStore = create<MusicAccountState>((set, get) => ({
  source: 'netease',
  account: null,
  loading: false,
  submitting: false,
  error: null,
  qrState: createIdleQrState(),
  hydrateAccount: async () => {
    set({
      loading: true,
      error: null,
    });

    try {
      const account = await fetchMusicAccountState(get().source);

      set({
        account,
        loading: false,
      });
    } catch (error) {
      console.error('获取网易云账号失败', error);
      set({
        account: createSignedOutAccountState(get().source),
        error: resolveAccountErrorMessage(error, '获取网易云账号失败'),
        loading: false,
      });
    }
  },
  connectSession: async (cookie) => {
    clearQrPollingTimer();
    set({
      submitting: true,
      error: null,
    });

    try {
      const account = await connectMusicAccountSession({
        source: get().source,
        cookie,
      });

      set({
        account,
        submitting: false,
      });

      return true;
    } catch (error) {
      console.error('连接网易云账号失败', error);
      set({
        error: resolveAccountErrorMessage(error, '连接网易云账号失败'),
        submitting: false,
      });

      return false;
    }
  },
  disconnectSession: async () => {
    clearQrPollingTimer();
    set({
      submitting: true,
      error: null,
    });

    try {
      const account = await disconnectMusicAccountSession(get().source);

      set({
        account,
        submitting: false,
        qrState: createIdleQrState(),
      });
    } catch (error) {
      console.error('退出网易云账号失败', error);
      set({
        error: resolveAccountErrorMessage(error, '退出网易云账号失败'),
        submitting: false,
      });
    }
  },
  startQrLogin: async () => {
    clearQrPollingTimer();
    set({
      error: null,
      qrState: {
        ...createIdleQrState(),
        status: 'loading',
        message: '正在生成二维码',
      },
    });

    try {
      const session = await createMusicAccountQrSession(get().source);

      set({
        qrState: {
          status: 'waiting',
          key: session.key,
          qrUrl: session.qrUrl,
          qrImageDataUrl: session.qrImageDataUrl,
          message: '等待扫码',
        },
      });

      const scheduleQrPoll = () => {
        clearQrPollingTimer();
        qrPollingTimer = setTimeout(() => {
          void (async () => {
            const currentKey = get().qrState.key;

            if (!currentKey) {
              clearQrPollingTimer();
              return;
            }

            try {
              const result = await pollMusicAccountQrSession(
                get().source,
                currentKey
              );

              if (result.status === 'confirmed' && result.account) {
                clearQrPollingTimer();
                set({
                  account: result.account,
                  qrState: {
                    ...get().qrState,
                    status: 'confirmed',
                    message: result.message || '登录成功，正在同步',
                  },
                });
                return;
              }

              if (result.status === 'expired') {
                clearQrPollingTimer();
                set({
                  qrState: {
                    ...get().qrState,
                    status: 'expired',
                    message: result.message || '二维码已失效，请重新生成',
                  },
                });
                return;
              }

              set({
                qrState: {
                  ...get().qrState,
                  status: result.status,
                  message:
                    result.message ||
                    (result.status === 'scanned'
                      ? '已扫码，请在手机确认'
                      : '等待扫码'),
                },
              });

              scheduleQrPoll();
            } catch (error) {
              clearQrPollingTimer();
              console.error('获取网易云二维码状态失败', error);
              set({
                error: resolveAccountErrorMessage(
                  error,
                  '获取网易云二维码状态失败'
                ),
                qrState: {
                  ...get().qrState,
                  status: 'error',
                  message: '获取二维码状态失败，请重试',
                },
              });
            }
          })();
        }, QR_POLL_INTERVAL_MS);
      };

      scheduleQrPoll();
    } catch (error) {
      console.error('创建网易云二维码失败', error);
      set({
        error: resolveAccountErrorMessage(error, '创建网易云二维码失败'),
        qrState: {
          ...createIdleQrState(),
          status: 'error',
          message: '创建二维码失败，请重试',
        },
      });
    }
  },
  retryQrLogin: async () => {
    clearQrPollingTimer();
    await get().startQrLogin();
  },
  stopQrLoginPolling: () => {
    clearQrPollingTimer();
    set({
      qrState: createIdleQrState(),
    });
  },
}));
