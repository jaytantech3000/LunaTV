import { useMusicAccountStore } from '../state/music-account-store';
import type {
  MusicAccountEntity,
  MusicCollectionSummaryEntity,
} from '../domain/entities';

jest.mock('../services/music-account-api-client', () => ({
  connectMusicAccountSession: jest.fn(),
  createMusicAccountQrSession: jest.fn(),
  disconnectMusicAccountSession: jest.fn(),
  fetchMusicAccountState: jest.fn(),
  pollMusicAccountQrSession: jest.fn(),
}));

jest.mock(
  '../services/music-account-playlists',
  () => ({
    subscribeMusicAccountPlaylist: jest.fn(),
    unsubscribeMusicAccountPlaylist: jest.fn(),
  })
);

interface MockMusicAccountApiClientModule {
  connectMusicAccountSession: jest.Mock;
  createMusicAccountQrSession: jest.Mock;
  disconnectMusicAccountSession: jest.Mock;
  fetchMusicAccountState: jest.Mock;
  pollMusicAccountQrSession: jest.Mock;
}

interface MockMusicAccountPlaylistsModule {
  subscribeMusicAccountPlaylist: jest.Mock;
  unsubscribeMusicAccountPlaylist: jest.Mock;
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
  account: MusicAccountEntity | null;
  disconnectSession: () => Promise<void>;
  error: string | null;
  qrState: MusicAccountQrViewState;
  retryQrLogin: () => Promise<void>;
  startQrLogin: () => Promise<void>;
  stopQrLoginPolling: () => void;
  togglePlaylistSubscription: (
    playlistId: string,
    subscribed: boolean
  ) => Promise<void>;
}

const accountApiClientModule = jest.requireMock(
  '../services/music-account-api-client'
) as MockMusicAccountApiClientModule;
const accountPlaylistsModule = jest.requireMock(
  '../services/music-account-playlists'
) as MockMusicAccountPlaylistsModule;

function createPlaylistSummary(
  id: string,
  title: string,
  accountPlaylistRole?: MusicCollectionSummaryEntity['accountPlaylistRole']
): MusicCollectionSummaryEntity {
  return {
    id,
    source: 'netease',
    kind: 'playlist',
    title,
    accountPlaylistRole,
  };
}

function createConnectedAccount(
  playlists: MusicCollectionSummaryEntity[]
): MusicAccountEntity {
  return {
    source: 'netease',
    authenticated: true,
    profile: {
      userId: '42',
      nickname: 'Luna Session',
    },
    playlists,
  };
}

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

describe('useMusicAccountStore playlist subscriptions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    (
      useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr
    ).stopQrLoginPolling?.();
    resetMusicAccountStoreState();
  });

  it('refreshes account.playlists after subscribing a playlist', async () => {
    const initialPlaylists = [
      createPlaylistSummary('501', 'Created Playlist', 'owned'),
    ];
    const refreshedPlaylists = [
      ...initialPlaylists,
      createPlaylistSummary('503', 'Fresh Collected Playlist', 'subscribed'),
    ];
    accountPlaylistsModule.subscribeMusicAccountPlaylist.mockResolvedValue(
      refreshedPlaylists
    );
    useMusicAccountStore.setState({
      account: createConnectedAccount(initialPlaylists),
    });

    await (
      useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr
    ).togglePlaylistSubscription('503', true);

    expect(
      accountPlaylistsModule.subscribeMusicAccountPlaylist
    ).toHaveBeenCalledWith('503');
    expect(
      (useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr)
        .account?.playlists
    ).toEqual(refreshedPlaylists);
    expect(
      (useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr)
        .error
    ).toBeNull();
  });

  it('refreshes account.playlists after unsubscribing a playlist', async () => {
    const initialPlaylists = [
      createPlaylistSummary('501', 'Created Playlist', 'owned'),
      createPlaylistSummary('502', 'Subscribed Playlist', 'subscribed'),
    ];
    const refreshedPlaylists = [
      createPlaylistSummary('501', 'Created Playlist', 'owned'),
    ];
    accountPlaylistsModule.unsubscribeMusicAccountPlaylist.mockResolvedValue(
      refreshedPlaylists
    );
    useMusicAccountStore.setState({
      account: createConnectedAccount(initialPlaylists),
    });

    await (
      useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr
    ).togglePlaylistSubscription('502', false);

    expect(
      accountPlaylistsModule.unsubscribeMusicAccountPlaylist
    ).toHaveBeenCalledWith('502');
    expect(
      (useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr)
        .account?.playlists
    ).toEqual(refreshedPlaylists);
  });

  it('keeps the previous playlist list when the remote mutation fails', async () => {
    const initialPlaylists = [
      createPlaylistSummary('501', 'Created Playlist', 'owned'),
      createPlaylistSummary('502', 'Subscribed Playlist', 'subscribed'),
    ];
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    accountPlaylistsModule.unsubscribeMusicAccountPlaylist.mockRejectedValue(
      new Error('cloud playlist failed')
    );
    useMusicAccountStore.setState({
      account: createConnectedAccount(initialPlaylists),
    });

    try {
      await expect(
        (
          useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr
        ).togglePlaylistSubscription('502', false)
      ).rejects.toThrow('cloud playlist failed');

      expect(
        (useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr)
          .account?.playlists
      ).toEqual(initialPlaylists);
      expect(
        (useMusicAccountStore.getState() as unknown as MusicAccountStoreWithQr)
          .error
      ).toBe('cloud playlist failed');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
