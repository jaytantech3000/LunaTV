# YesPlayMusic Phase 3a 账号接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前 `/music` 重写线中补齐网易云二维码登录主通路，让未登录用户默认看到二维码登录，并在成功后立即刷新我的歌单、每日推荐、私人 FM 与设置账号态，同时保留手填 cookie 作为降级兜底。

**Architecture:** 复用现有 `account route -> account store -> MusicAccountCard -> home bootstrap` 链路，不重造账号实体和 session 存储格式。新增一条独立二维码 route、扩展 `netease` provider 的二维码能力，并在 `music-account-store` 内负责二维码轮询生命周期与清理。

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Zustand, Jest, Testing Library, `qrcode`

## Global Constraints

- 默认登录入口改成 `二维码登录`。
- 保留手填 `cookie`，但降级为 `高级接入 / fallback`，不再作为主入口。
- 前端不直接持久化扫码 cookie，成功登录后仍只写现有 `lunatv_music_netease_session`。
- 登录成功后刷新我的歌单、每日推荐、私人 FM、设置中的账号状态。
- 本切片不补手机号登录，不补邮箱登录，不改现有 session cookie 存储格式。
- 先写失败测试，再写最小实现，再跑定向测试与音乐回归。

---

### Task 1: 扩展二维码 provider 与服务端 route contract

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

- [ ] **Step 1: 写失败测试**

在 `src/features/music/tests/music-account-qr-routes.test.ts` 新增：

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

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/music-account-qr-routes.test.ts --runInBand`

Expected: FAIL，因为二维码 route 与 provider 接口尚未存在。

- [ ] **Step 3: 写最小实现**

先安装二维码渲染依赖：

```bash
pnpm add qrcode
```

在 `src/features/music/domain/entities.ts` 增加：

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

在 `src/features/music/domain/repositories.ts` 扩展：

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

在 `src/features/music/services/providers/netease/client.ts` 增加：

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

在 `src/features/music/services/providers/netease/repository.ts` 增加：

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

在 `src/app/api/music/account/qr/route.ts` 实现：

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

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/music-account-qr-routes.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: 提交**

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

### Task 2: 扩展账号 API client 与 zustand 轮询状态

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

- [ ] **Step 1: 写失败测试**

在 `src/features/music/tests/music-account-store.test.ts` 新增：

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

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/music-account-store.test.ts --runInBand`

Expected: FAIL，因为 `qrState` 与二维码 actions 还不存在。

- [ ] **Step 3: 写最小实现**

在 `src/features/music/services/music-account-api-client.ts` 增加：

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

在 `src/features/music/state/music-account-store.ts` 增加：

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

并实现：

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

轮询逻辑用递归 `setTimeout`：

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

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/music-account-store.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/features/music/services/music-account-api-client.ts \
  src/features/music/state/music-account-store.ts \
  src/features/music/tests/music-account-store.test.ts
git commit -m "feat(music): add qr login account store"
```

### Task 3: 重写账号卡主入口并保留 cookie fallback

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

  - 二维码默认 UI
  - `改用 cookie 接入` 次级入口
  - 登录成功时的账号摘要卡片

- [ ] **Step 1: 写失败测试**

在 `src/features/music/tests/music-sidebar.test.tsx` 增加：

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

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/music-sidebar.test.tsx --runInBand`

Expected: FAIL，因为当前账号卡仍默认展示手填 cookie 表单。

- [ ] **Step 3: 写最小实现**

在 `src/features/music/components/MusicAccountCard.tsx` 增加本地入口模式：

```ts
const [loginEntryMode, setLoginEntryMode] = useState<'qr' | 'cookie'>('qr');
```

默认二维码生命周期：

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

二维码 UI：

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

cookie fallback 只在用户主动切换时展示，并增加返回按钮：

```tsx
<button type='button' onClick={() => setLoginEntryMode('qr')}>
  Back to QR login
</button>
```

登录成功后刷新首页：

```ts
useEffect(() => {
  if (!account?.authenticated) {
    return;
  }

  void refreshHomeView();
}, [account?.authenticated, refreshHomeView]);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest src/features/music/tests/music-sidebar.test.tsx --runInBand`

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/features/music/components/MusicAccountCard.tsx \
  src/features/music/tests/music-sidebar.test.tsx
git commit -m "feat(music): switch account card to qr-first login"
```

### Task 4: 更新集成 mock 与完整 UI 回归

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

  - 集成 mock 的二维码状态机
  - 二维码成功后首页刷新回归
  - 现有 cookie fallback 连接行为继续通过

- [ ] **Step 1: 写失败测试**

在 `src/features/music/tests/music-phase2-ui.test.tsx` 增加：

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

保留并更新 `src/features/music/tests/music-player-ui.test.tsx` 现有 fallback 流程断言：

```ts
fireEvent.click(screen.getByRole('button', { name: 'Use cookie instead' }));
fireEvent.change(screen.getByLabelText('Netease session cookie'), {
  target: { value: 'MUSIC_U=mock-session' },
});
fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx src/features/music/tests/music-player-ui.test.tsx --runInBand`

Expected: FAIL，因为 live mock 还不支持 `/api/music/account/qr`，UI 也还不是二维码主入口。

- [ ] **Step 3: 写最小实现**

在 `src/features/music/tests/live-music-test-utils.ts` 增加二维码 mock 状态机：

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

如果现有回归测试继续依赖 cookie fallback，就只把进入登录入口前增加：

```ts
fireEvent.click(screen.getByRole('button', { name: 'Use cookie instead' }));
```

- [ ] **Step 4: 跑集成测试与完整音乐回归**

Run: `pnpm jest src/features/music/tests/music-phase2-ui.test.tsx src/features/music/tests/music-player-ui.test.tsx --runInBand`

Expected: PASS

Run: `pnpm jest src/features/music/tests src/app/music/page.test.tsx --runInBand`

Expected: PASS，全量音乐测试通过，现有 cookie fallback、不登录首页、我的歌单、每日推荐、私人 FM 均无回归。

- [ ] **Step 5: 提交**

```bash
git add src/features/music/tests/live-music-test-utils.ts \
  src/features/music/tests/music-phase2-ui.test.tsx \
  src/features/music/tests/music-player-ui.test.tsx
git commit -m "test(music): cover qr-first account login flow"
```
