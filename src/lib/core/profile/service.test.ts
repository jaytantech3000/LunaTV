import {
  parseCompositeProfileKey,
  requireActiveProfileContext,
} from './service';

describe('profile service', () => {
  const authContext = {
    username: 'demo',
    source: 'internal',
  } as const;

  it('returns single-user local profile context without shared user lookup', async () => {
    await expect(
      requireActiveProfileContext(authContext, {
        storageType: 'localstorage',
      })
    ).resolves.toEqual({
      username: 'demo',
      source: 'internal',
      storageType: 'localstorage',
      profileMode: 'single-user-local',
    });
  });

  it('rejects missing shared user profiles', async () => {
    await expect(
      requireActiveProfileContext(authContext, {
        storageType: 'redis',
        config: {
          UserConfig: {
            Users: [],
          },
        },
      })
    ).rejects.toMatchObject({
      message: '用户不存在',
      status: 401,
    });
  });

  it('parses composite keys and rejects invalid input', () => {
    expect(parseCompositeProfileKey('demo+123')).toEqual({
      source: 'demo',
      id: '123',
    });

    expect(() => parseCompositeProfileKey('invalid')).toThrow(
      'Invalid key format'
    );
  });
});
