import { isNewerVersion } from './app-update-version';

describe('app update version helper', () => {
  it('detects a newer semantic version', () => {
    expect(isNewerVersion('200.1.0', '200.0.9')).toBe(true);
    expect(isNewerVersion('200.0.1', '200.0.0')).toBe(true);
  });

  it('treats equal, missing, and older versions as not newer', () => {
    expect(isNewerVersion('200.0.0', '200.0.0')).toBe(false);
    expect(isNewerVersion(null, '200.0.0')).toBe(false);
    expect(isNewerVersion('200.0.0', null)).toBe(false);
    expect(isNewerVersion('199.9.9', '200.0.0')).toBe(false);
  });

  it('keeps prerelease ordering intact', () => {
    expect(isNewerVersion('200.0.0', '200.0.0-beta.2')).toBe(true);
    expect(isNewerVersion('200.0.0-beta.2', '200.0.0-beta.3')).toBe(false);
  });
});
