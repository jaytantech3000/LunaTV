'use client';

import { create } from 'zustand';

interface PlayerSurfaceState {
  miniVisible: boolean;
  fullPlayerOpen: boolean;
  lyricsPanelOpen: boolean;
  queuePanelOpen: boolean;
  transitionState: 'idle' | 'expanding' | 'collapsing';
  showMiniPlayer: () => void;
  openFullPlayer: () => void;
  closeFullPlayer: () => void;
  toggleQueuePanel: () => void;
  toggleLyricsPanel: () => void;
}

export const usePlayerSurfaceStore = create<PlayerSurfaceState>((set) => ({
  miniVisible: false,
  fullPlayerOpen: false,
  lyricsPanelOpen: true,
  queuePanelOpen: false,
  transitionState: 'idle',
  showMiniPlayer: () => set({ miniVisible: true }),
  openFullPlayer: () =>
    set({ fullPlayerOpen: true, transitionState: 'expanding' }),
  closeFullPlayer: () =>
    set({ fullPlayerOpen: false, transitionState: 'collapsing' }),
  toggleQueuePanel: () =>
    set((state) => ({ queuePanelOpen: !state.queuePanelOpen })),
  toggleLyricsPanel: () =>
    set((state) => ({ lyricsPanelOpen: !state.lyricsPanelOpen })),
}));
