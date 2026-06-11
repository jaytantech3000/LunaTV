import {
  buildHardLimiterCurve,
  calculateAspectFitRect,
} from '@/lib/player-enhancement-runtime';

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

  it('builds a hard limiter curve that clamps peaks to the configured ceiling', () => {
    const curve = buildHardLimiterCurve(-12, 5);
    const expectedLimit = Math.pow(10, -12 / 20);

    expect(curve[0]).toBeCloseTo(-expectedLimit, 5);
    expect(curve[1]).toBeCloseTo(-expectedLimit, 5);
    expect(curve[2]).toBeCloseTo(0, 5);
    expect(curve[3]).toBeCloseTo(expectedLimit, 5);
    expect(curve[4]).toBeCloseTo(expectedLimit, 5);
  });
});
