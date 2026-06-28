import type { DesktopMusicTrayCommand } from '@/lib/desktop/tauri-client';

import {
  bindDesktopMusicTrayControls,
  syncDesktopMusicTrayState,
} from '../services/desktop-music-tray';

const mockGetRuntimeConfig = jest.fn();
const mockIsDesktopTauriRuntimeAvailable = jest.fn();
const mockListenDesktopMusicTrayCommands = jest.fn();
const mockUpdateDesktopMusicTrayState = jest.fn();

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: () => mockGetRuntimeConfig(),
}));

jest.mock('@/lib/desktop/tauri-client', () => ({
  isDesktopTauriRuntimeAvailable: (...args: unknown[]) =>
    mockIsDesktopTauriRuntimeAvailable(...args),
  listenDesktopMusicTrayCommands: (...args: unknown[]) =>
    mockListenDesktopMusicTrayCommands(...args),
  updateDesktopMusicTrayState: (...args: unknown[]) =>
    mockUpdateDesktopMusicTrayState(...args),
}));

describe('desktop music tray service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRuntimeConfig.mockReturnValue({
      APP_TARGET: 'desktop',
    });
    mockIsDesktopTauriRuntimeAvailable.mockReturnValue(true);
    mockUpdateDesktopMusicTrayState.mockResolvedValue(undefined);
    mockListenDesktopMusicTrayCommands.mockResolvedValue(() => undefined);
  });

  it('syncs the active track into the desktop tray bridge', async () => {
    await syncDesktopMusicTrayState({
      currentTrack: {
        title: 'Playable Track',
        artists: ['Artist A', 'Artist B'],
        source: 'netease',
      },
      playState: 'playing',
      queueLength: 2,
    });

    expect(mockUpdateDesktopMusicTrayState).toHaveBeenCalledWith({
      artistText: 'Artist A / Artist B',
      playState: 'playing',
      queueLength: 2,
      source: 'netease',
      title: 'Playable Track',
    });
  });

  it('skips tray sync when the desktop runtime is unavailable', async () => {
    mockGetRuntimeConfig.mockReturnValue({
      APP_TARGET: 'web',
    });

    await syncDesktopMusicTrayState({
      currentTrack: {
        title: 'Playable Track',
        artists: ['Artist A'],
        source: 'netease',
      },
      playState: 'playing',
      queueLength: 1,
    });

    expect(mockUpdateDesktopMusicTrayState).not.toHaveBeenCalled();
  });

  it('binds desktop tray commands and releases the listener on cleanup', async () => {
    const unlisten = jest.fn();

    mockListenDesktopMusicTrayCommands.mockImplementation(
      async (_listener: (command: DesktopMusicTrayCommand) => void) => unlisten
    );

    const events: string[] = [];
    const dispose = bindDesktopMusicTrayControls({
      onOpenMusic: () => events.push('open'),
      onTogglePlay: () => events.push('toggle'),
      onPlayNext: () => events.push('next'),
      onPlayPrevious: () => events.push('previous'),
    });

    await Promise.resolve();

    const registeredListener = mockListenDesktopMusicTrayCommands.mock
      .calls[0]?.[0] as
      | ((command: DesktopMusicTrayCommand) => void)
      | undefined;

    if (!registeredListener) {
      throw new Error('desktop tray listener was not registered');
    }

    registeredListener('toggle-play');
    registeredListener('play-next');
    registeredListener('play-previous');
    registeredListener('open-music');

    expect(events).toEqual(['toggle', 'next', 'previous', 'open']);

    dispose();

    expect(unlisten).toHaveBeenCalled();
  });
});
