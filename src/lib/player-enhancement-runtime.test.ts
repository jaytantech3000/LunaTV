import { calculateAspectFitRect } from '@/lib/player-enhancement-runtime';

describe('player enhancement runtime helpers', () => {
  it('keeps video aspect ratio inside a wider host', () => {
    expect(calculateAspectFitRect(1920, 1080, 1280, 720)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it('preserves letterboxing for a taller host', () => {
    expect(calculateAspectFitRect(1200, 1200, 1920, 1080)).toEqual({
      x: 0,
      y: 262.5,
      width: 1200,
      height: 675,
    });
  });

  it('preserves pillarboxing for a narrower host', () => {
    expect(calculateAspectFitRect(900, 1600, 1920, 1080)).toEqual({
      x: 0,
      y: 546.875,
      width: 900,
      height: 506.25,
    });
  });
});
