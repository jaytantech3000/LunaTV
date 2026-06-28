# YesPlayMusic Phase 3a Account Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the primary Netease QR-login path to the rebuilt `/music` stack so signed-out users see QR login by default, and successful login immediately refreshes personal playlists, daily recommendations, personal FM, and settings account state, while manual cookie input stays as a fallback (兜底) path.

**Architecture:** Reuse the existing `account route -> account store -> MusicAccountCard -> home bootstrap` chain instead of rebuilding account entities or session storage. Add one dedicated QR route, extend the `netease` provider with QR capabilities, and let `music-account-store` own the QR polling (轮询) lifecycle and cleanup.

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Zustand, Jest, Testing Library, `qrcode`

## Global Constraints

- Make `QR login` the default entry.
- Keep manual `cookie` input, but demote it to an `advanced / fallback (兜底)` path instead of the primary entry.
- The client must not persist the scan-login cookie directly; successful login still writes only the existing `lunatv_music_netease_session`.
- Successful login must refresh personal playlists, daily recommendations, personal FM, and settings account state.
- This slice does not add phone login, does not add email login, and does not change the existing session-cookie storage format.
- Write the failing tests first, then the minimal implementation, then targeted verification and full music regression.

---

### Task 1: Extend the QR provider and server-side route contract

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/features/music/domain/entities.ts`
- Modify: `src/features/music/domain/repositories.ts`
- Modify: `src/features/music/services/providers/netease/client.ts`
- Modify: `src/features/music/services/providers/netease/repository.ts`
- Create: `src/app/api/music/account/qr/route.ts`
- Create: `src/features/music/tests/music-account-qr-routes.test.ts`

**Interfaces:**

- Consumes:
  - `MusicAccountEntity`
  - `MusicAccountRepository.getAccount(source, sessionCookie?)`
  - `normalizeNeteaseSessionCookie(rawCookie: string): string`
  - `writeMusicAccountSessionCookie(response, cookieHeader): NextResponse`
- Produces:

  - `type MusicAccountQrStatus = 'waiting' | 'scanned' | 'expired' | 'confirmed'`
  - `interface MusicAccountQrSessionEntity { key: string; status: 'waiting'; qrUrl: string; qrImageDataUrl: string }`
  - `interface MusicAccountQrPollEntity { key: string; status: MusicAccountQrStatus; account?: MusicAccountEntity; message?: string; sessionCookieHeader?: string }`
  - `MusicAccountRepository.createQrSession(source): Promise<MusicAccountQrSessionEntity>`
  - `MusicAccountRepository.pollQrSession(source, key): Promise<MusicAccountQrPollEntity>`

- [ ] **Step 1: Write the failing test**

Add to `src/features/music/tests/music-account-qr-routes.test.ts`:

```ts
it('creates a qr login session with key and image payload', async () => {
  const { POST } = await importQrRoute();
  const response = await POST(
    new NextRequest('http://localhost/api/music/account/qr?source=netease', {
      method: 'POST',
    })
  );
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(payload).toEqual(
    expect.objectContaining({
      key: 'mock-unikey',
      status: 'waiting',
      qrUrl: 'https://music.163.com/login?codekey=mock-unikey',
      qrImageDataUrl: expect.stringContaining('data:image/'),
    })
  );
});

it('maps qr polling states and writes session cookie on confirmed login', async () => {
  const { GET } = await importQrRoute();

  const waitingResponse = await GET(
    new NextRequest(
      'http://localhost/api/music/account/qr?source=netease&key=mock-unikey'
    )
  );
  expect((await waitingResponse.json()).status).toBe('waiting');

  const scannedResponse = await GET(
    new NextRequest(
      'http://localhost/api/music/account/qr?source=netease&key=mock-unikey-scanned'
    )
  );
  expect((await scannedResponse.json()).status).toBe('scanned');

  const expiredResponse = await GET(
    new NextRequest(
      'http://localhost/api/music/account/qr?source=netease&key=mock-unikey-expired'
    )
  );
  expect((await expiredResponse.json()).status).toBe('expired');

  const confirmedResponse = await GET(
    new NextRequest(
      'http://localhost/api/music/account/qr?source=netease&key=mock-unikey-confirmed'
    )
  );
  const confirmedPayload = await confirmedResponse.json();

  expect(confirmedPayload.status).toBe('confirmed');
  expect(confirmedPayload.account).toMatchObject({
    authenticated: true,
    profile: { nickname: 'Luna User' },
  });
  expect(confirmedResponse.headers.get('set-cookie')).toContain(
    'lunatv_music_netease_session='
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm jest src/features/music/tests/music-account-qr-routes.test.ts --runInBand`

Expected: FAIL because the QR route and provider interfaces do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Install the QR rendering dependency:

```bash
pnpm add qrcode
```

Add to `src/features/music/domain/entities.ts`:

```ts
export type MusicAccountQrStatus =
  | 'waiting'
  | 'scanned'
  | 'expired'
  | 'confirmed';

export interface MusicAccountQrSessionEntity {
  key: string;
  status: 'waiting';
  qrUrl: string;
  qrImageDataUrl: string;
}

export interface MusicAccountQrPollEntity {
  key: string;
  status: MusicAccountQrStatus;
  account?: MusicAccountEntity;
  message?: string;
  sessionCookieHeader?: string;
}
```

Extend `src/features/music/domain/repositories.ts`:

```ts
export interface MusicAccountRepository {
  getAccount(
    source: LiveMusicSourceKey,
    sessionCookie?: string | null
  ): Promise<MusicAccountEntity>;
  createQrSession(
    source: LiveMusicSourceKey
  ): Promise<MusicAccountQrSessionEntity>;
  pollQrSession(
    source: LiveMusicSourceKey,
    key: string
  ): Promise<MusicAccountQrPollEntity>;
}
```

Add to `src/features/music/services/providers/netease/client.ts`:

```ts
export async function fetchQrLoginKey(): Promise<{ key: string }> {}

export async function fetchQrLoginCode(key: string): Promise<{
  key: string;
  qrUrl: string;
  qrImageDataUrl: string;
}> {}

export async function fetchQrLoginStatus(key: string): Promise<{
  code: 800 | 801 | 802 | 803;
  cookie?: string;
}> {}
```

Add to `src/features/music/services/providers/netease/repository.ts`:

```ts
async function createQrSession(): Promise<MusicAccountQrSessionEntity> {
  const { key } = await fetchQrLoginKey();
  return fetchQrLoginCode(key);
}

async function pollQrSession(key: string): Promise<MusicAccountQrPollEntity> {
  const statusPayload = await fetchQrLoginStatus(key);

  if (statusPayload.code === 801) {
    return { key, status: 'waiting' };
  }

  if (statusPayload.code === 802) {
    return { key, status: 'scanned' };
  }

  if (statusPayload.code === 800) {
    return { key, status: 'expired' };
  }

  const normalizedCookie = normalizeNeteaseSessionCookie(
    statusPayload.cookie || ''
  );
  const account = await getAccount(normalizedCookie);

  return {
    key,
    status: 'confirmed',
    account,
    message: '登录成功，正在同步',
    sessionCookieHeader: normalizedCookie,
  };
}
```

Implement `src/app/api/music/account/qr/route.ts`:

```ts
export async function POST(request: NextRequest) {
  const { repository } = getMusicProviderContext(
    request.nextUrl.searchParams.get('source')
  );
  const payload = await repository.accountRepository.createQrSession('netease');
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: NextRequest) {
  const { repository } = getMusicProviderContext(
    request.nextUrl.searchParams.get('source')
  );
  const key = request.nextUrl.searchParams.get('key') || '';
  const result = await repository.accountRepository.pollQrSession(
    'netease',
    key
  );
  const { sessionCookieHeader, ...payload } = result;
  const response = NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store' },
  });

  if (payload.status === 'confirmed' && sessionCookieHeader) {
    writeMusicAccountSessionCookie(response, sessionCookieHeader);
  }

  return response;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm jest src/features/music/tests/music-account-qr-routes.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml \
  src/features/music/domain/entities.ts \
  src/features/music/domain/repositories.ts \
  src/features/music/services/providers/netease/client.ts \
  src/features/music/services/providers/netease/repository.ts \
  src/app/api/music/account/qr/route.ts \
  src/features/music/tests/music-account-qr-routes.test.ts
git commit -m "feat(music): add netease qr login route"
```

### Task 2: Extend the account API client and zustand polling state

**Files:**

- Modify: `src/features/music/services/music-account-api-client.ts`
- Modify: `src/features/music/state/music-account-store.ts`
- Create: `src/features/music/tests/music-account-store.test.ts`

**Interfaces:**

- Consumes:
  - `MusicAccountQrSessionEntity`
  - `MusicAccountQrPollEntity`
  - `/api/music/account/qr?source=netease`
- Produces:

  - `interface MusicAccountQrViewState { status: 'idle' | 'loading' | 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'error'; key: string | null; qrUrl: string | null; qrImageDataUrl: string | null; message: string | null }`
  - `createMusicAccountQrSession(source): Promise<MusicAccountQrSessionEntity>`
  - `pollMusicAccountQrSession(source, key): Promise<MusicAccountQrPollEntity>`
  - `startQrLogin(): Promise<void>`
  - `retryQrLogin(): Promise<void>`
  - `stopQrLoginPolling(): void`

- [ ] **Step 1: Write the failing test**

Add to `src/features/music/tests/music-account-store.test.ts`:

```ts
it('starts qr login and stores the waiting qr payload', async () => {
  await useMusicAccountStore.getState().startQrLogin();

  expect(useMusicAccountStore.getState().qrState).toMatchObject({
    status: 'waiting',
    key: 'mock-unikey',
    qrImageDataUrl: 'data:image/png;base64,mock-image',
  });
});

it('stops polling and hydrates the account after confirmed qr login', async () => {
  jest.useFakeTimers();
  await useMusicAccountStore.getState().startQrLogin();

  jest.advanceTimersByTime(1000);
  await Promise.resolve();

  expect(useMusicAccountStore.getState().account).toMatchObject({
    authenticated: true,
    profile: { nickname: 'Luna Session' },
  });
  expect(useMusicAccountStore.getState().qrState.status).toBe('confirmed');
});

it('can regenerate after expiry and clears polling on disconnect', async () => {
  await useMusicAccountStore.getState().retryQrLogin();
  await useMusicAccountStore.getState().disconnectSession();

  expect(useMusicAccountStore.getState().qrState.status).toBe('idle');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm jest src/features/music/tests/music-account-store.test.ts --runInBand`

Expected: FAIL because `qrState` and the QR actions do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add to `src/features/music/services/music-account-api-client.ts`:

```ts
export async function createMusicAccountQrSession(
  source: LiveMusicSourceKey
): Promise<MusicAccountQrSessionEntity> {
  return fetchMusicAccountJson<MusicAccountQrSessionEntity>(
    source,
    {
      method: 'POST',
      headers: {
        'X-Music-Account-Route': 'qr',
      },
    },
    '创建网易云二维码失败',
    '/api/music/account/qr'
  );
}

export async function pollMusicAccountQrSession(
  source: LiveMusicSourceKey,
  key: string
): Promise<MusicAccountQrPollEntity> {
  return fetchMusicAccountJson<MusicAccountQrPollEntity>(
    source,
    {
      method: 'GET',
    },
    '获取网易云二维码状态失败',
    `/api/music/account/qr?source=${source}&key=${encodeURIComponent(key)}`
  );
}
```

Add to `src/features/music/state/music-account-store.ts`:

```ts
let qrPollingTimer: ReturnType<typeof setTimeout> | null = null;

function clearQrPollingTimer() {
  if (qrPollingTimer) {
    clearTimeout(qrPollingTimer);
    qrPollingTimer = null;
  }
}

const EMPTY_QR_STATE = {
  status: 'idle',
  key: null,
  qrUrl: null,
  qrImageDataUrl: null,
  message: null,
} satisfies MusicAccountQrViewState;
```

Implement:

```ts
startQrLogin: async () => {
  clearQrPollingTimer();
  set({ qrState: { ...EMPTY_QR_STATE, status: 'loading' }, error: null });
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
  scheduleQrPoll();
},
stopQrLoginPolling: () => {
  clearQrPollingTimer();
  set({ qrState: { ...get().qrState, status: 'idle' } });
},
retryQrLogin: async () => {
  clearQrPollingTimer();
  await get().startQrLogin();
},
```

Use recursive `setTimeout` polling:

```ts
async function runQrPoll() {
  const currentKey = get().qrState.key;
  if (!currentKey) return;

  const result = await pollMusicAccountQrSession(get().source, currentKey);

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
        message: '二维码已失效，请重新生成',
      },
    });
    return;
  }

  set({
    qrState: {
      ...get().qrState,
      status: result.status,
      message:
        result.status === 'scanned' ? '已扫码，请在手机确认' : '等待扫码',
    },
  });
  scheduleQrPoll();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm jest src/features/music/tests/music-account-store.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/music/services/music-account-api-client.ts \
  src/features/music/state/music-account-store.ts \
  src/features/music/tests/music-account-store.test.ts
git commit -m "feat(music): add qr login account store"
```

### Task 3: Rebuild the account card primary entry and keep cookie fallback

**Files:**

- Modify: `src/features/music/components/MusicAccountCard.tsx`
- Modify: `src/features/music/tests/music-sidebar.test.tsx`

**Interfaces:**

- Consumes:
  - `useMusicAccountStore().qrState`
  - `useMusicAccountStore().startQrLogin()`
  - `useMusicAccountStore().retryQrLogin()`
  - `useMusicAccountStore().stopQrLoginPolling()`
  - `useMusicAccountStore().connectSession(cookie)`
- Produces:

  - default QR UI
  - `Use cookie instead` secondary entry
  - connected-account summary card after successful login

- [ ] **Step 1: Write the failing test**

Add to `src/features/music/tests/music-sidebar.test.tsx`:

```ts
it('shows qr login by default and lets the user switch to cookie fallback', async () => {
  installMusicCollectionsProfileFetchMock({
    musicQrResponse: {
      key: 'mock-unikey',
      status: 'waiting',
      qrUrl: 'https://music.163.com/login?codekey=mock-unikey',
      qrImageDataUrl: 'data:image/png;base64,mock-image',
    },
  });

  render(<MusicSidebar />);

  expect(await screen.findByAltText('Netease QR login')).toBeInTheDocument();
  expect(screen.getByText('等待扫码')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Use cookie instead' }));

  expect(screen.getByLabelText('Netease session cookie')).toBeInTheDocument();
});

it('renders the connected account card after qr login is confirmed', async () => {
  installMusicCollectionsProfileFetchMock({
    qrStatusSequence: ['waiting', 'scanned', 'confirmed'],
  });

  render(<MusicSidebar />);

  expect(await screen.findByText('Luna Session')).toBeInTheDocument();
  expect(screen.getByText('Session connected')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm jest src/features/music/tests/music-sidebar.test.tsx --runInBand`

Expected: FAIL because the current account card still defaults to the manual cookie form.

- [ ] **Step 3: Write minimal implementation**

Add local entry-mode state to `src/features/music/components/MusicAccountCard.tsx`:

```ts
const [loginEntryMode, setLoginEntryMode] = useState<'qr' | 'cookie'>('qr');
```

Default QR lifecycle:

```ts
useEffect(() => {
  if (collapsed || account?.authenticated || loginEntryMode !== 'qr') {
    stopQrLoginPolling();
    return;
  }

  if (qrState.status === 'idle') {
    void startQrLogin();
  }

  return () => {
    stopQrLoginPolling();
  };
}, [
  account?.authenticated,
  collapsed,
  loginEntryMode,
  qrState.status,
  startQrLogin,
  stopQrLoginPolling,
]);
```

QR UI:

```tsx
<div className='mt-3 rounded-[20px] border border-white/10 bg-black/20 p-4'>
  {qrState.qrImageDataUrl ? (
    <img
      alt='Netease QR login'
      src={qrState.qrImageDataUrl}
      className='mx-auto h-44 w-44 rounded-[16px] bg-white p-3'
    />
  ) : null}
  <div className='mt-3 text-center text-sm text-white/72'>
    {qrState.message}
  </div>
  <div className='mt-3 flex gap-2'>
    <button type='button' onClick={() => void retryQrLogin()}>
      Regenerate
    </button>
    <button type='button' onClick={() => setLoginEntryMode('cookie')}>
      Use cookie instead
    </button>
  </div>
</div>
```

Show the cookie fallback only when the user explicitly switches, and add a return action:

```tsx
<button type='button' onClick={() => setLoginEntryMode('qr')}>
  Back to QR login
</button>
```

Refresh home after successful login:

```ts
useEffect(() => {
  if (!account?.authenticated) {
    return;
  }

  void refreshHomeView();
}, [account?.authenticated, refreshHomeView]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm jest src/features/music/tests/music-sidebar.test.tsx --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/music/components/MusicAccountCard.tsx \
  src/features/music/tests/music-sidebar.test.tsx
git commit -m "feat(music): switch account card to qr-first login"
```

### Task 4: Update integration mocks and full UI regression

**Files:**

- Modify: `src/features/music/tests/live-music-test-utils.ts`
- Modify: `src/features/music/tests/music-phase2-ui.test.tsx`
- Modify: `src/features/music/tests/music-player-ui.test.tsx`

**Interfaces:**

- Consumes:
  - `/api/music/account/qr`
  - `musicAccountConnected`
  - `useMusicAccountStore().qrState`
- Produces:

  - QR-state machine inside the integration mock
  - home refresh regression after QR success
  - existing cookie fallback connect flow still passing

- [ ] **Step 1: Write the failing test**

Add to `src/features/music/tests/music-phase2-ui.test.tsx`:

```ts
it('shows qr login by default and refreshes home after qr confirmation', async () => {
  render(
    <>
      <MusicPageShell />
      <MusicPlayerRoot />
    </>
  );

  expect(await screen.findByAltText('Netease QR login')).toBeInTheDocument();
  expect(screen.getByText('等待扫码')).toBeInTheDocument();
  expect(
    await screen.findByRole('button', { name: 'Navigate 每日推荐' })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Navigate 私人 FM' })
  ).toBeInTheDocument();
  expect(screen.getByText('Luna Session')).toBeInTheDocument();
});
```

Keep and adjust the existing fallback flow in `src/features/music/tests/music-player-ui.test.tsx`:

```ts
fireEvent.click(screen.getByRole('button', { name: 'Use cookie instead' }));
fireEvent.change(screen.getByLabelText('Netease session cookie'), {
  target: { value: 'MUSIC_U=mock-session' },
});
fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx src/features/music/tests/music-player-ui.test.tsx --runInBand`

Expected: FAIL because the live mock does not support `/api/music/account/qr` yet, and the UI is not QR-first yet.

- [ ] **Step 3: Write minimal implementation**

Add a QR mock state machine to `src/features/music/tests/live-music-test-utils.ts`:

```ts
let qrPollCount = 0;

if (requestUrl.pathname === '/api/music/account/qr') {
  if (requestMethod === 'POST') {
    qrPollCount = 0;
    return createJsonResponse({
      key: 'mock-unikey',
      status: 'waiting',
      qrUrl: 'https://music.163.com/login?codekey=mock-unikey',
      qrImageDataUrl: 'data:image/png;base64,mock-image',
    });
  }

  qrPollCount += 1;

  if (qrPollCount === 1) {
    return createJsonResponse({ key: 'mock-unikey', status: 'waiting' });
  }

  if (qrPollCount === 2) {
    return createJsonResponse({ key: 'mock-unikey', status: 'scanned' });
  }

  musicAccountConnected = true;
  return createJsonResponse({
    key: 'mock-unikey',
    status: 'confirmed',
    account: {
      source: 'netease',
      authenticated: true,
      profile: {
        userId: '42',
        nickname: 'Luna Session',
        avatarUrl: 'https://cdn.music.test/luna-session.jpg',
        signature: 'Connected for daily picks',
      },
      playlists: [
        {
          id: '501',
          source: 'netease',
          kind: 'playlist',
          title: 'Created Playlist',
          coverUrl: 'https://cdn.music.test/created-playlist.jpg',
          description: 'Created by Luna Session',
          trackCount: 18,
          accentColor: '#7b61ff',
        },
      ],
    },
  });
}
```

If existing regression tests still rely on the cookie fallback, prepend only:

```ts
fireEvent.click(screen.getByRole('button', { name: 'Use cookie instead' }));
```

- [ ] **Step 4: Run integration tests and full music regression**

Run: `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx src/features/music/tests/music-player-ui.test.tsx --runInBand`

Expected: PASS

Run: `pnpm jest src/features/music/tests src/app/music/page.test.tsx --runInBand`

Expected: PASS, with no regressions in cookie fallback, signed-out home, personal playlists, daily recommendations, or personal FM.

- [ ] **Step 5: Commit**

```bash
git add src/features/music/tests/live-music-test-utils.ts \
  src/features/music/tests/music-phase2-ui.test.tsx \
  src/features/music/tests/music-player-ui.test.tsx
git commit -m "test(music): cover qr-first account login flow"
```
