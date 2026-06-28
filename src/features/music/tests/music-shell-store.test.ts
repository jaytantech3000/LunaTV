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

  it('updates theme and active section explicitly for shell-level settings', () => {
    useMusicShellStore.getState().setThemeVariant('sunset');
    useMusicShellStore.getState().setActiveSection('settings');

    expect(useMusicShellStore.getState().themeVariant).toBe('sunset');
    expect(useMusicShellStore.getState().activeSection).toBe('settings');
  });
});
