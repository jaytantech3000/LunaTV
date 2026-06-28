'use client';

import { create } from 'zustand';

import type { MusicHomeSectionTab } from '../domain/entities';
import {
  readCachedMusicPreferences,
  saveMusicPreferencesPatch,
} from '../services/music-preferences';

const defaultMusicPreferences = readCachedMusicPreferences();

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
  sidebarCollapsed: defaultMusicPreferences.sidebarCollapsed,
  mobileDrawerOpen: false,
  layoutMode: 'desktop',
  themeVariant: defaultMusicPreferences.themeVariant,
  toggleSidebar: () =>
    set((state) => {
      const sidebarCollapsed = !state.sidebarCollapsed;
      void saveMusicPreferencesPatch({
        sidebarCollapsed,
      });

      return {
        sidebarCollapsed,
      };
    }),
  setActiveSection: (activeSection) => set({ activeSection }),
  setThemeVariant: (themeVariant) => {
    void saveMusicPreferencesPatch({
      themeVariant,
    });
    set({ themeVariant });
  },
}));
