'use client';

import { create } from 'zustand';

import type { MusicHomeSectionTab } from '../domain/entities';

interface MusicShellState {
  activeSection: MusicHomeSectionTab;
  sidebarCollapsed: boolean;
  mobileDrawerOpen: boolean;
  layoutMode: 'desktop' | 'mobile';
  themeVariant: 'sunset' | 'midnight';
  toggleSidebar: () => void;
  setActiveSection: (section: MusicHomeSectionTab) => void;
  setThemeVariant: (themeVariant: 'sunset' | 'midnight') => void;
}

export const useMusicShellStore = create<MusicShellState>((set) => ({
  activeSection: 'home',
  sidebarCollapsed: false,
  mobileDrawerOpen: false,
  layoutMode: 'desktop',
  themeVariant: 'midnight',
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setActiveSection: (activeSection) => set({ activeSection }),
  setThemeVariant: (themeVariant) => set({ themeVariant }),
}));
