import { isDesktopPlayerPresentationFullscreen } from '@/lib/desktop/fullscreen';

describe('desktop player fullscreen helpers', () => {
  afterEach(() => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    });
  });

  it('treats ArtPlayer web fullscreen as an active fullscreen state', () => {
    expect(
      isDesktopPlayerPresentationFullscreen({
        fullscreenWeb: true,
      })
    ).toBe(true);
  });

  it('detects when the player root is the active document fullscreen element', () => {
    const playerRoot = document.createElement('div');

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: playerRoot,
    });

    expect(
      isDesktopPlayerPresentationFullscreen({
        fullscreenWeb: false,
        template: {
          $player: playerRoot,
        },
      })
    ).toBe(true);
  });

  it('detects WebKit native video fullscreen when reported by the video element', () => {
    const video = document.createElement('video');

    Object.defineProperty(video, 'webkitDisplayingFullscreen', {
      configurable: true,
      value: true,
    });

    expect(
      isDesktopPlayerPresentationFullscreen({
        fullscreenWeb: false,
        video,
      })
    ).toBe(true);
  });
});
