import { compareVersions, UpdateStatus } from './version_check';

describe('version_check', () => {
  it('keeps equal versions as up to date', () => {
    expect(compareVersions('100.1.3', '100.1.3')).toBe(UpdateStatus.NO_UPDATE);
  });

  it('detects newer stable versions', () => {
    expect(compareVersions('100.1.4', '100.1.3')).toBe(
      UpdateStatus.HAS_UPDATE
    );
  });

  it('compares prerelease versions with semver precedence', () => {
    expect(compareVersions('100.1.3-beta.2', '100.1.3-beta.1')).toBe(
      UpdateStatus.HAS_UPDATE
    );
    expect(compareVersions('100.1.3', '100.1.3-beta.2')).toBe(
      UpdateStatus.HAS_UPDATE
    );
    expect(compareVersions('100.1.3-beta.1', '100.1.3')).toBe(
      UpdateStatus.NO_UPDATE
    );
  });
});
