import { createFixtureRepository } from '../services/fixture-repository';

describe('createFixtureRepository', () => {
  it('returns Home, Explore, and Library fixture sections', async () => {
    const repository = createFixtureRepository();
    const home = await repository.getHomeView();

    expect(home.sections.map((section) => section.id)).toEqual([
      'home',
      'explore',
      'library',
    ]);
    expect(home.featuredQueue).toHaveLength(3);
  });
});
