import { readBundledDefaultConfigFile } from './config-source';

describe('readBundledDefaultConfigFile', () => {
  it('uses admin as the bundled default auth username', () => {
    const configFile = readBundledDefaultConfigFile();
    const parsedConfig = JSON.parse(configFile);

    expect(parsedConfig.auth.username).toBe('admin');
  });
});
