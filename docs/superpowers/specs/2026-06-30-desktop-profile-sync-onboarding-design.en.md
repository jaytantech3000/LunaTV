# Desktop Account Sync Onboarding Design

**Goal**

Replace manual `profile_sync.api_base_url` editing with a visible, guided onboarding wizard in `desktop-admin`, and migrate local account data plus rebind the current surviving offline downloads during enablement.

**Scope**

- Expose the onboarding entry only in `desktop-admin`.
- Use `https://luna.hkcu.qzz.io` as the default production URL.
- Migrate all local account profile data to Web:
  - play records
  - favorites
  - follows
  - search history
  - skip configs
- Preserve the current surviving offline download set and only rebind its owner.
- Restrict the full flow to Web `owner/admin`.

**Non-goals**

- Do not change the architecture to desktop frontend direct-to-Web calls.
- Do not put the onboarding entry inside the user menu settings dialog.
- Do not attempt to recover historical offline download ownership that was already purged.

**Current Problems**

- Sync enablement currently depends on manual config editing.
- Turning sync on does not migrate existing local account data.
- Current download owner switching can purge offline downloads on owner mismatch.
- The local service keeps the remote session only in memory, so restart loses it.

**Design**

1. Add a sync card and onboarding wizard to `desktop-admin`.
2. The wizard performs remote login, permission validation, and preview before execution.
3. Execution is orchestrated by the local service:
   - log in to Web
   - fetch remote admin config
   - compute account mappings
   - auto-create missing same-name Web accounts
   - call a Web merge endpoint for each local account snapshot
   - rebind the current offline download ownership
   - write `profile_sync.api_base_url` back to the desktop config
4. After config write, refresh the desktop runtime so the app enters sync mode without manual JSON edits.

**Account Mapping**

- current local account -> current logged-in Web account
- other local accounts -> same-name Web accounts
- missing same-name Web accounts -> auto-create as regular users with password `123456`

**Conflict Policy**

- A: Web-first
- B: local-first

**Offline Download Policy**

- Only the current surviving download snapshot is processed.
- Files are not uploaded to Web.
- Only local owner metadata is rebound.
- The frontend must bypass the old purge-on-owner-change path during cutover.

**Interfaces**

- New Web admin merge endpoint:
  - accepts target username, local snapshot, and conflict strategy
  - merges and writes back the target user profile data
- New local service onboarding endpoints:
  - preview
  - execute

**Error Handling**

- Remote login failure: stop before config write.
- Insufficient permission: show that only Web `owner/admin` can run the flow.
- User creation failure: stop execution and do not enter sync mode.
- Profile migration failure: stop execution and do not write config.
- Offline download rebind failure: stop execution and do not write config.

**Testing**

- Web merge helper tests for keyed domains and search history conflict policy.
- Local service helper tests for account mapping, config mutation, and download rebinding.
- Desktop download ownership tests to prove sync cutover does not trigger purge.
- `desktop-admin` wizard tests for preview, execution, success notice, and default URL rendering.
