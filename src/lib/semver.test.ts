import { compareSemver, parseSemver } from './semver';

describe('semver helpers', () => {
  it('parses stable and prerelease versions', () => {
    expect(parseSemver('100.1.3')).toEqual({
      major: 100,
      minor: 1,
      patch: 3,
      prerelease: [],
    });
    expect(parseSemver('200.0.0-beta.2')).toEqual({
      major: 200,
      minor: 0,
      patch: 0,
      prerelease: ['beta', 2],
    });
  });

  it('compares prerelease identifiers according to semver precedence', () => {
    expect(compareSemver('200.0.0-beta.2', '200.0.0-beta.1')).toBe(1);
    expect(compareSemver('200.0.0', '200.0.0-beta.2')).toBe(1);
    expect(compareSemver('200.0.0-beta.1', '200.0.0')).toBe(-1);
  });

  it('throws on invalid version strings', () => {
    expect(() => parseSemver('100.1')).toThrow('Invalid version');
  });
});
