'use client';

import { create } from 'zustand';

import type { LyricDocumentEntity } from '../domain/entities';
import {
  readCachedMusicPreferences,
  saveMusicPreferencesPatch,
} from '../services/music-preferences';

const defaultMusicPreferences = readCachedMusicPreferences();

interface LyricsState {
  lyrics: LyricDocumentEntity | null;
  activeLineIndex: number;
  followMode: 'auto' | 'manual';
  manualSeekLock: boolean;
  setLyrics: (lyrics: LyricDocumentEntity | null) => void;
  setActiveLineIndex: (activeLineIndex: number) => void;
  setFollowMode: (followMode: 'auto' | 'manual') => void;
  toggleFollowMode: () => void;
}

export const useLyricsStore = create<LyricsState>((set) => ({
  lyrics: null,
  activeLineIndex: -1,
  followMode: defaultMusicPreferences.lyricsFollowMode,
  manualSeekLock: false,
  setLyrics: (lyrics) => set({ lyrics, activeLineIndex: lyrics ? 0 : -1 }),
  setActiveLineIndex: (activeLineIndex) => set({ activeLineIndex }),
  setFollowMode: (followMode) => {
    void saveMusicPreferencesPatch({
      lyricsFollowMode: followMode,
    });
    set({ followMode });
  },
  toggleFollowMode: () =>
    set((state) => {
      const followMode = state.followMode === 'auto' ? 'manual' : 'auto';
      void saveMusicPreferencesPatch({
        lyricsFollowMode: followMode,
      });

      return {
        followMode,
      };
    }),
}));
