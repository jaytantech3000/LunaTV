import {
  buildDomainMarker,
  isDomainMigrated,
} from './desktop-local-migration';

describe('desktop local profile migration markers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses admin for the new default marker while honoring the legacy desktop-local-owner marker', () => {
    localStorage.setItem(
      'lunatv:desktop-local-profile-migrated:v1:desktop-local-owner:playrecords',
      '1'
    );

    expect(buildDomainMarker('admin', 'playrecords')).toBe(
      'lunatv:desktop-local-profile-migrated:v1:admin:playrecords'
    );
    expect(isDomainMigrated('admin', 'playrecords')).toBe(true);
  });

  it('keeps custom usernames isolated from default and legacy markers', () => {
    localStorage.setItem(
      'lunatv:desktop-local-profile-migrated:v1:desktop-local-owner:playrecords',
      '1'
    );

    expect(isDomainMigrated('alice', 'playrecords')).toBe(false);
  });
});
