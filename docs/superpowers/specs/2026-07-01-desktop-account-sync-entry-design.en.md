# Desktop Account Sync Entry Exposure Design

**Goal**

Let desktop users reach account sync directly from the existing user menu, while keeping the original "Admin Panel" menu and its `/admin` content unchanged.

**Scope**

- Adjust only the visible user-menu entry points in the desktop runtime (桌面运行时).
- Add a dedicated "Account Sync" menu item that routes to `/desktop-admin`.
- Keep the existing "Admin Panel" menu item routing to `/admin`.
- Reuse the current permission gate (权限门禁): show the entry only for desktop `owner/admin` accounts.

**Non-goals**

- Do not change the `/desktop-admin` page content.
- Do not change the `/admin` page content.
- Do not add a new permission model (权限模型) or role branch.
- Do not expose the account sync entry to non-desktop Web environments.

**Current Problem**

- The account sync flow already exists in `/desktop-admin`.
- The user menu currently exposes only "Admin Panel", and it routes to `/admin`.
- As a result, the sync entry is not discoverable (可发现) in the normal product path.
- Replacing "Admin Panel" with `/desktop-admin` would hide the original admin capabilities and weaken the information architecture (信息架构).

**Approach Comparison**

1. Replace "Admin Panel" with `/desktop-admin`
   - Pros: smallest code change.
   - Cons: hides `/admin` and mislabels the destination.
2. Keep "Admin Panel" and add "Account Sync"
   - Pros: clear semantics, no lost functionality, follows the principle of least surprise (最小惊讶原则).
   - Cons: adds one more menu item.
3. Add a secondary entry inside `/admin` that links to `/desktop-admin`
   - Pros: no extra user-menu item.
   - Cons: still adds an extra hop and does not solve the "can't see the entry" problem.

**Recommended Design**

Adopt approach 2:

- Keep "Admin Panel" for desktop `owner/admin` users.
- Add a sibling "Account Sync" menu item.
- Route "Account Sync" directly to `/desktop-admin`.

**Interaction Design**

- Keep the desktop user-menu order stable:
  - Settings
  - Admin Panel
  - Account Sync
  - Other existing items
- Use the explicit label "Account Sync" so the affordance (可见入口提示) matches the destination.
- Reuse the existing `showAdminPanel` visibility condition instead of creating a second visibility branch.

**Implementation Constraints**

- Reuse the existing `UserMenu` navigation feedback and `prefetchRoute` pattern.
- Route the new menu item to `/desktop-admin`.
- Extend pending-navigation state so `/admin` and `/desktop-admin` can track loading independently, avoiding UI cross-talk (串扰).
- Do not change the current `showAdminPanel` permission gate.

**Error Handling**

- If the user clicks the same destination while it is already pending, keep the current short-circuit behavior.
- If desktop-runtime detection fails, hide the entry instead of rendering a disabled control.

**Testing**

- `UserMenu` in desktop `owner/admin` scenarios:
  - shows both "Admin Panel" and "Account Sync"
  - keeps `/admin` routing for "Admin Panel"
  - routes `/desktop-admin` for "Account Sync"
- In non-desktop or non-`owner/admin` scenarios:
  - does not show "Account Sync"
- In pending-navigation scenarios:
  - `/admin` and `/desktop-admin` loading states do not interfere with each other

**Risks and Trade-offs**

- Risk is low because the change is isolated to the menu-entry layer.
- The main risk is shared button-state logic causing pending UI confusion between the two destinations.
- Scope that risk down by tracking pending state per destination instead of per generic admin action.
