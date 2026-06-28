import { useMusicAccountStore } from '../state/music-account-store';

jest.mock('../services/music-account-api-client', () => ({
  connectMusicAccountSession: jest.fn(),
  createMusicAccountQrSession: jest.fn(),
  disconnectMusicAccountSession: jest.fn(),
  fetchMusicAccountState: jest.fn(),
  pollMusicAccountQrSession: jest.fn(),
}));

interface MockMusicAccountApiClientModule {
  connectMusicAccountSession: jest.Mock;
  createMusicAccountQrSession: jest.Mock;
  disconnectMusicAccountSession: jest.Mock;
  fetchMusicAccountState: jest.Mock;
  pollMusicAccountQrSession: jest.Mock;
}

interface MusicAccountQrViewState {
  status:
    | 'idle'
    | 'loading'
    | 'waiting'
    | 'scanned'
    | 'expired'
    | 'confirmed'
    | 'error';
  key: string | null;
  qrUrl: string | null;
  qrImageDataUrl: string | null;
  message: string | null;
}

interface MusicAccountStoreWithQr {
  account: {
    authenticated: boolean;
    profile: {
      nickname: string;
    } | null;
  } | null;
  disconnectSession: () => Promise<void>;
  qrState: MusicAccountQrViewState;
  retryQrLogin: () => Promise<void>;
  startQrLogin: () => Promise<void>;
  stopQrLoginPolling: () => void;
}

const accountApiClientModule = jest.requireMock(
  '../services/music-account-api-client'
) as MockMusicAccountApiClientModule;

function resetMusicAccountStoreState() {
  useMusicAccountStore.setState({
    source: 'netease',
    account: null,
    loading: false,
    submitting: false,
    error: null,
    qrState: {
      status: 'idle',
      key: null,
      qrUrl: null,
      qrImageDataUrl: null,
      message: null,
    },
  });
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useMusicAccountStore qr login flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    (
      useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr
    ).stopQrLoginPolling?.();
    resetMusicAccountStoreState();
    accountApiClientModule.disconnectMusicAccountSession.mockResolvedValue({
      source: 'netease',
      authenticated: false,
      profile: null,
      playlists: [],
    });
  });

  afterEach(() => {
    (
      useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr
    ).stopQrLoginPolling?.();
    jest.useRealTimers();
  });

  it('starts qr login and stores the waiting qr payload', async () => {
    accountApiClientModule.createMusicAccountQrSession.mockResolvedValue({
      key: 'mock-unikey',
      status: 'waiting',
      qrUrl: 'https://music.163.com/login?codekey=mock-unikey',
      qrImageDataUrl: 'data:image/png;base64,mock-image',
    });

    const store =
      useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr;

    await store.startQrLogin();

    expect(
      (useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr)
        .qrState
    ).toMatchObject({
      status: 'waiting',
      key: 'mock-unikey',
      qrImageDataUrl: 'data:image/png;base64,mock-image',
    });
  });

  it('stops polling and hydrates the account after confirmed qr login', async () => {
    jest.useFakeTimers();
    accountApiClientModule.createMusicAccountQrSession.mockResolvedValue({
      key: 'mock-unikey',
      status: 'waiting',
      qrUrl: 'https://music.163.com/login?codekey=mock-unikey',
      qrImageDataUrl: 'data:image/png;base64,mock-image',
    });
    accountApiClientModule.pollMusicAccountQrSession.mockResolvedValue({
      key: 'mock-unikey',
      status: 'confirmed',
      account: {
        source: 'netease',
        authenticated: true,
        profile: {
          userId: '42',
          nickname: 'Luna Session',
        },
        playlists: [],
      },
      message: '登录成功，正在同步',
    });

    const store =
      useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr;

    await store.startQrLogin();
    jest.advanceTimersByTime(1000);
    await flushMicrotasks();

    expect(
      (useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr)
        .account
    ).toMatchObject({
      authenticated: true,
      profile: { nickname: 'Luna Session' },
    });
    expect(
      (useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr)
        .qrState.status
    ).toBe('confirmed');
  });

  it('can regenerate after expiry and clears qr state on disconnect', async () => {
    jest.useFakeTimers();
    accountApiClientModule.createMusicAccountQrSession
      .mockResolvedValueOnce({
        key: 'mock-unikey-expired',
        status: 'waiting',
        qrUrl: 'https://music.163.com/login?codekey=mock-unikey-expired',
        qrImageDataUrl: 'data:image/png;base64,expired-image',
      })
      .mockResolvedValueOnce({
        key: 'mock-unikey-retry',
        status: 'waiting',
        qrUrl: 'https://music.163.com/login?codekey=mock-unikey-retry',
        qrImageDataUrl: 'data:image/png;base64,retry-image',
      });
    accountApiClientModule.pollMusicAccountQrSession.mockResolvedValue({
      key: 'mock-unikey-expired',
      status: 'expired',
      message: '二维码已失效，请重新生成',
    });

    const store =
      useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr;

    await store.startQrLogin();
    jest.advanceTimersByTime(1000);
    await flushMicrotasks();

    expect(
      (useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr)
        .qrState.status
    ).toBe('expired');

    await store.retryQrLogin();

    expect(
      (useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr)
        .qrState
    ).toMatchObject({
      status: 'waiting',
      key: 'mock-unikey-retry',
    });

    await store.disconnectSession();

    expect(
      (useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr)
        .qrState.status
    ).toBe('idle');
  });
});
