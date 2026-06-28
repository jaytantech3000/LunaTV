import { useMusicShellStore } from '../state/music-shell-store';

describe('useMusicShellStore', () => {
  beforeEach(() => {
    useMusicShellStore.setState({
      activeSection: 'home',
      sidebarCollapsed: false,
      mobileDrawerOpen: false,
      layoutMode: 'desktop',
      themeVariant: 'midnight',
    });
  });

  it('toggles the sidebar without touching provider data', () => {
    const store = useMusicShellStore.getState();

    expect(store.sidebarCollapsed).toBe(false);
    store.toggleSidebar();
    expect(useMusicShellStore.getState().sidebarCollapsed).toBe(true);
  });
});
