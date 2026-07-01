# 桌面帐号同步入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留 `/admin` 管理面板入口，同时为桌面 `owner/admin` 用户新增直达 `/desktop-admin` 的“帐号同步”菜单项。

**Architecture:** 只在 `UserMenu` 菜单层新增一个桌面专用导航入口，并沿用现有 `NavigationFeedbackProvider` 的跳转反馈。实现保持 `/admin` 与 `/desktop-admin` 两条导航独立预取、独立 pending 状态，避免 loading 串扰。

**Tech Stack:** React 18, Next.js App Router, TypeScript, Jest, Testing Library

## Global Constraints

- 不修改 `/admin` 页面内容。
- 不修改 `/desktop-admin` 页面内容。
- 仅桌面 `owner/admin` 显示新入口。
- 保留“管理面板” -> `/admin`。
- 新增“帐号同步” -> `/desktop-admin`。
- 必须按 TDD：先写失败测试，再写最小实现。

---

### Task 1: 为桌面用户菜单补上“帐号同步”入口

**Files:**

- Create: `src/components/UserMenu.test.tsx`
- Modify: `src/components/UserMenu.tsx`
- Test: `src/components/UserMenu.test.tsx`

**Interfaces:**

- Consumes: `useNavigationFeedback(): { beginNavigation, pendingNavigation }`
- Produces: `handleDesktopAccountSync(): void`

- [ ] **Step 1: Write the failing test**

```tsx
it('shows a desktop account sync entry for desktop owner users and routes it to /desktop-admin', async () => {
  mockAuthInfo = { username: 'owner', role: 'owner' };
  window.RUNTIME_CONFIG = { APP_TARGET: 'desktop' };

  render(<UserMenu />);

  fireEvent.click(screen.getByRole('button', { name: /当前用户/i }));

  const syncEntry = await screen.findByRole('button', { name: '帐号同步' });
  fireEvent.click(syncEntry);

  expect(beginNavigation).toHaveBeenCalledWith({
    href: '/desktop-admin',
    kind: 'nav',
    label: '帐号同步',
  });

  act(() => {
    jest.advanceTimersByTime(1);
  });

  expect(mockRouter.push).toHaveBeenCalledWith('/desktop-admin');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/UserMenu.test.tsx --runInBand`
Expected: FAIL because the “帐号同步” button does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```tsx
const handleDesktopAccountSync = () => {
  if (
    pendingNavigation?.kind === 'nav' &&
    pendingNavigation.href === '/desktop-admin'
  ) {
    setIsOpen(false);
    return;
  }

  flushSync(() => {
    setIsOpen(false);
    beginNavigation({
      href: '/desktop-admin',
      kind: 'nav',
      label: '帐号同步',
    });
  });
  prefetchRoute('/desktop-admin');
  window.setTimeout(() => {
    router.push('/desktop-admin');
  }, 0);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/components/UserMenu.test.tsx --runInBand`
Expected: PASS for the new routing test.

- [ ] **Step 5: Commit**

```bash
git add src/components/UserMenu.tsx src/components/UserMenu.test.tsx
git commit -m "feat: add desktop account sync menu entry"
```

### Task 2: 拆开 `/admin` 与 `/desktop-admin` 的 pending/preload 状态

**Files:**

- Modify: `src/components/UserMenu.tsx`
- Modify: `src/components/UserMenu.test.tsx`
- Test: `src/components/UserMenu.test.tsx`

**Interfaces:**

- Consumes: `pendingNavigation?.href`
- Produces: `isOpeningAdmin: boolean`, `isOpeningDesktopAccountSync: boolean`

- [ ] **Step 1: Write the failing test**

```tsx
it('keeps admin and account-sync pending states independent', async () => {
  mockAuthInfo = { username: 'owner', role: 'owner' };
  mockPendingNavigation = {
    href: '/desktop-admin',
    kind: 'nav',
    label: '帐号同步',
    startedAt: Date.now(),
  };
  window.RUNTIME_CONFIG = { APP_TARGET: 'desktop' };

  render(<UserMenu />);

  fireEvent.click(screen.getByRole('button', { name: /当前用户/i }));

  expect(
    await screen.findByRole('button', { name: '帐号同步' })
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: '管理面板' })).not.toBeDisabled();
  expect(screen.getByText('正在打开帐号同步...')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/UserMenu.test.tsx --runInBand`
Expected: FAIL because the current code only tracks `/admin`.

- [ ] **Step 3: Write minimal implementation**

```tsx
const isOpeningAdmin =
  pendingNavigation?.kind === 'nav' && pendingNavigation.href === '/admin';
const isOpeningDesktopAccountSync =
  pendingNavigation?.kind === 'nav' &&
  pendingNavigation.href === '/desktop-admin';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/components/UserMenu.test.tsx --runInBand`
Expected: PASS with both tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/UserMenu.tsx src/components/UserMenu.test.tsx
git commit -m "test: cover desktop account sync menu states"
```
