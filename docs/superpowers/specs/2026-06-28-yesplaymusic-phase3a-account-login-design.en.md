# LunaTV Music Rebuild Phase 3a Account Login Design

**Goal**

After the rebuilt shell in Phase 1 and the live `Netease` vertical slice in Phase 2, add the first formal account-login path: rebuild a desktop-first Netease account onboarding flow in the current `React + Next.js + Tauri` stack, using `YesPlayMusic` QR login as the reference, and replace the current manual `MUSIC_U` / full-cookie input as the primary entry.

**Position In The Full Rebuild**

The full rebuild still has five sub-projects:

1. Application shell
2. Playback core
3. Data domain
4. Account capabilities
5. Desktop integration

Phase 1 completed sub-projects 1 + 2.  
Phase 2 completed the first `Netease` vertical slice of sub-project 3.  
This design document covers **Phase 3a = the first formal login path of sub-project 4**: ship QR login as the primary path first, and demote manual cookie input to an advanced fallback.

**Why QR Login First**

The recommended first step is “QR login as the main path,” not shipping phone, email, and cookie entry points all at once:

1. `src/features/music/` already has the new account store, account route, and session persistence chain. The missing piece is a product-grade login entry, not the account-data skeleton.
2. The current desktop music module still requires users to paste `MUSIC_U` or a full cookie, which is visibly below the quality bar of a true rebuild.
3. `YesPlayMusic` uses QR mode as the default login experience, so this path is the closest match to the user-visible primary entry.
4. QR success can still reuse the existing session-cookie write path and account refresh chain, which is lower risk than adding password-based login now.
5. Phone/email login adds password input, encryption, risk-control failures, and more error states. Phase 3a does not need to absorb that complexity yet.

**Scope**

- Make `QR login` the default login entry
- Keep manual `cookie` input, but demote it to an `advanced / fallback` path instead of the main entry
- Add the full QR lifecycle:
  - QR creation
  - QR status polling
  - session write on successful login
- Refresh the following after login succeeds:
  - personal playlists
  - daily recommendations
  - personal FM
  - account state in settings
- After disconnect, every login-dependent entry must immediately fall back to the signed-out state
- Keep the desktop-first framing, without changing the main interaction semantics for old web-only preview compatibility

**Out Of Scope**

- No phone login in this slice
- No email login in this slice
- No deeper account capabilities yet, such as favorites sync, play-history sync, or liked-track write-back
- No rewrite of the core `MusicAccountEntity` meaning
- No change to the current session-cookie storage format
- No parallel multi-panel login surface just to make the feature “complete in one shot”

**Current-State Conclusion**

The current branch already has three reusable foundations:

1. [Music account route](/Users/jay/Code/LunaTV/src/app/api/music/account/route.ts)
   - already supports reading current account state
   - already supports writing a manual cookie
   - already supports disconnecting the session
2. [Session persistence](/Users/jay/Code/LunaTV/src/features/music/services/music-account-session.ts)
   - already has normalized cookie filtering
   - already has server-side session-cookie read/write/clear behavior
3. [Account store and UI](/Users/jay/Code/LunaTV/src/features/music/state/music-account-store.ts)
   - already has basic `hydrate / connect / disconnect` actions
   - but [MusicAccountCard](/Users/jay/Code/LunaTV/src/features/music/components/MusicAccountCard.tsx) is still stuck in manual-cookie mode

Conclusion:

- The current account system does have a foundation
- The real gap is that the main entry is still a temporary path
- Phase 3a should reuse the existing route, store, and session skeleton, and replace only the primary login path

**Core Approach**

1. Keep `/api/music/account` for account-state reads, cookie fallback, and disconnect
2. Add a dedicated QR-login route that owns:
   - QR creation
   - scan-state polling
   - writing the existing session cookie after successful login
3. Extend QR-login provider capabilities under `services/providers/netease/`, without leaking raw Netease QR payloads to the component layer
4. Upgrade `MusicAccountCard` so QR login becomes the default signed-out entry, while manual cookie input becomes a secondary path
5. After success, use one refresh chain everywhere: “write session -> hydrate account -> refresh home/bootstrap”
6. After disconnect, return to one clean signed-out state, with no stale authenticated UI branches

**Route Boundaries**

Keep the existing endpoints:

- `GET /api/music/account?source=netease`
- `POST /api/music/account?source=netease`
- `DELETE /api/music/account?source=netease`

Add:

- `POST /api/music/account/qr?source=netease`
  - create a QR login session
  - return:
    - `key`
    - `qrUrl`
    - `qrImageDataUrl`
    - `status`
- `GET /api/music/account/qr?source=netease&key=<unikey>`
  - poll QR status
  - always return:
    - `status = waiting | scanned | expired | confirmed`
    - `account` (only when confirmed)
    - `playlists` (only when confirmed)

Key constraints:

- On `confirmed`, the server writes the existing `lunatv_music_netease_session`
- The client must not directly touch reusable login cookies
- The unified error shape remains `{ error: string }`
- The QR route may only call new `services/providers/netease/*` capabilities, and must not route back through the deleted legacy music directories

**Provider Capabilities**

Extend `src/features/music/services/providers/netease/` with:

- `createQrLoginKey(): Promise<{ key: string }>`
- `createQrLoginCode(key: string): Promise<{ key: string; qrUrl: string; qrImageDataUrl: string }>`
- `checkQrLoginStatus(key: string): Promise<QrLoginStatusResult>`

Recommended unified result model:

- `waiting`
  - waiting for scan
- `scanned`
  - scanned, waiting for phone confirmation
- `expired`
  - QR code expired
- `confirmed`
  - login succeeded
  - includes normalized session cookie
  - includes normalized account entity

Explicit constraints:

- The provider layer maps raw Netease `800 / 801 / 802 / 803` into unified statuses
- The route and component layers must not handle raw Netease status codes directly
- If upstream returns a cookie, it must still flow through the existing `normalizeNeteaseSessionCookie` before the session is written

**Frontend State And Data Flow**

Keep `music-account-store` as the main account state, and add temporary QR-login UI state:

- `qrState`
  - `status: 'idle' | 'loading' | 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'error'`
  - `key`
  - `qrUrl`
  - `qrImageDataUrl`
  - `message`
- `startQrLogin()`
  - create a QR code and enter the waiting state
- `pollQrLogin()`
  - fetch scan status
- `stopQrLoginPolling()`
  - stop polling
- `retryQrLogin()`
  - regenerate the QR code after expiry

Main client flow:

1. `MusicAccountCard` detects a signed-out state
2. It calls `startQrLogin()` by default
3. It renders the QR card
4. It periodically calls `pollQrLogin()`
5. If the status is:
   - `waiting`: show waiting-for-scan copy
   - `scanned`: show “scanned, please confirm on your phone”
   - `expired`: stop polling and show regenerate
   - `confirmed`: stop polling, hydrate the account, and refresh home
6. After successful login:
   - the sidebar immediately shows personal playlists
   - the home view immediately shows daily recommendations and personal FM
   - settings immediately switches to the connected account state

**UI And Interaction**

Signed-out state:

- Show the QR-login card by default
- Keep the title as `Netease account`
- Show the QR image in the main area
- Limit the status copy to four formal states:
  - `Waiting for scan`
  - `Scanned, please confirm on your phone`
  - `QR code expired, please regenerate`
  - `Login succeeded, syncing`
- Below the QR area, provide:
  - `Regenerate`
  - `Use cookie instead`

Cookie fallback:

- No longer occupies the primary entry area
- Expands only when the user explicitly switches to it
- Reuses the existing `connectSession(cookie)` behavior

Signed-in state:

- Show the Netease nickname, signature, and playlist count
- Show the `Disconnect` button
- Do not show the QR polling area anymore

Disconnect flow:

- Call the existing `disconnectSession()`
- Clear QR polling
- Immediately return to the QR-first signed-out view

**Error Handling**

- QR creation failure:
  - show an error message
  - show `Regenerate`
  - keep `Use cookie instead`
- QR expiry:
  - stop polling
  - switch to `expired`
  - allow one-click regeneration
- Polling network failure:
  - do not immediately clear the QR code
  - show a non-blocking (非阻断) error
  - allow later polls to recover
- Login succeeds but account hydration fails:
  - keep the written session
  - run an explicit `hydrateAccount()` on the client
  - if needed, show “failed to sync account state, please retry later”
- When the component unmounts, collapses, or switches entry modes:
  - timers must be cleaned up
  - duplicate polling is forbidden

**Testing Requirements**

Route tests:

- create QR successfully
- poll `waiting`
- poll `scanned`
- poll `expired`
- when polling returns `confirmed`, write the existing session cookie

Store tests:

- start QR login when signed out
- stop polling after successful login
- regenerate after QR expiry
- clean up polling on unmount or disconnect

UI tests:

- show QR by default when signed out
- switch to the signed-in account card after scan success
- show daily recommendations and personal FM after login succeeds
- still reuse the original cookie-connect behavior after switching to the fallback

Regression requirements:

- the existing cookie-fallback tests must stay and keep passing
- the existing personal-playlists, daily-recommendations, and personal-FM behavior must not regress

**Acceptance Criteria**

Phase 3a is complete only when all of these are true:

1. A signed-out user opening `/music` sees QR login by default instead of a manual `MUSIC_U` field
2. The QR flow correctly shows waiting / scanned / expired / confirmed feedback states
3. On successful login, the server writes the existing session cookie, and the client does not persist the raw login cookie
4. After login succeeds, personal playlists, daily recommendations, personal FM, and settings account state refresh immediately
5. After disconnect, every login-dependent entry falls back immediately, and the QR-first entry returns
6. The manual cookie path still works, but only as a secondary fallback
7. Route / store / UI regression tests pass

**Later Phases**

Phase 3a still leaves three follow-up streams:

1. `Phase 3b`
   - phone / email login
2. `Phase 3c`
   - deeper account capabilities such as favorites, play history, and liked-track flows
3. `Phase 4`
   - further desktop tray, cache, download, and local desktop integration
