'use client';

/* eslint-disable no-console */

import {
  type DesktopMusicTrayCommand,
  isDesktopTauriRuntimeAvailable,
  listenDesktopMusicTrayCommands,
  updateDesktopMusicTrayState,
} from '@/lib/desktop/tauri-client';
import { getRuntimeConfig } from '@/lib/runtime-config';

import type { MusicTrackEntity } from '../domain/entities';

interface DesktopMusicTraySnapshot {
  currentTrack: Pick<MusicTrackEntity, 'title' | 'artists' | 'source'> | null;
  playState: 'idle' | 'playing' | 'paused';
  queueLength: number;
}

interface DesktopMusicTrayControls {
  onOpenMusic: () => void;
  onTogglePlay: () => void;
  onPlayNext: () => void;
  onPlayPrevious: () => void;
}

function isDesktopMusicTraySupported(): boolean {
  return (
    getRuntimeConfig().APP_TARGET === 'desktop' &&
    isDesktopTauriRuntimeAvailable()
  );
}

function applyDesktopMusicTrayCommand(
  command: DesktopMusicTrayCommand,
  controls: DesktopMusicTrayControls
): void {
  switch (command) {
    case 'open-music':
      controls.onOpenMusic();
      return;
    case 'toggle-play':
      controls.onTogglePlay();
      return;
    case 'play-next':
      controls.onPlayNext();
      return;
    case 'play-previous':
      controls.onPlayPrevious();
      return;
    default:
      return;
  }
}

export async function syncDesktopMusicTrayState(
  snapshot: DesktopMusicTraySnapshot
): Promise<void> {
  if (!isDesktopMusicTraySupported()) {
    return;
  }

  await updateDesktopMusicTrayState({
    title: snapshot.currentTrack?.title ?? null,
    artistText: snapshot.currentTrack?.artists.join(' / ') ?? null,
    source: snapshot.currentTrack?.source ?? null,
    playState: snapshot.playState,
    queueLength: snapshot.queueLength,
  });
}

export function bindDesktopMusicTrayControls(
  controls: DesktopMusicTrayControls
): () => void {
  if (!isDesktopMusicTraySupported()) {
    return () => undefined;
  }

  let disposed = false;
  let unlisten: (() => void) | null = null;

  void listenDesktopMusicTrayCommands((command) => {
    applyDesktopMusicTrayCommand(command, controls);
  })
    .then((releaseListener) => {
      if (disposed) {
        releaseListener();
        return;
      }

      unlisten = releaseListener;
    })
    .catch((error) => {
      console.error('绑定桌面音乐 tray 失败', error);
    });

  return () => {
    disposed = true;
    unlisten?.();
  };
}
