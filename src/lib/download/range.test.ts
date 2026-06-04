import { hasExplicitExclusiveByteRange } from './range';

describe('hasExplicitExclusiveByteRange', () => {
  it('treats hls.js default 0/0 values as no range request', () => {
    expect(hasExplicitExclusiveByteRange(0, 0)).toBe(false);
  });

  it('returns false when range values are missing', () => {
    expect(hasExplicitExclusiveByteRange(undefined, undefined)).toBe(false);
    expect(hasExplicitExclusiveByteRange(null, 10)).toBe(false);
  });

  it('returns true for actual byte range requests', () => {
    expect(hasExplicitExclusiveByteRange(0, 1)).toBe(true);
    expect(hasExplicitExclusiveByteRange(128, 1024)).toBe(true);
  });
});
