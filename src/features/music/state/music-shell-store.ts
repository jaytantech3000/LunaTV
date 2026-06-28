'use client';

import { create } from 'zustand';

import type { MusicSectionId } from '../domain/entities';

interface MusicShellState {
  activeSection: MusicSectionId;
  sidebarCollapsed: boolean;
  mobileDrawerOpen: boolean;
  layoutMode: 'desktop' | 'mobile';
  themeVariant: 'sunset' | 'midnight';
  toggleSidebar: () => void;
  setActiveSection: (section: MusicSectionId) => void;
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
}));
