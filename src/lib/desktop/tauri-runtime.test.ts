/* eslint-disable @typescript-eslint/no-var-requires */

const mockInvoke = jest.fn();
const mockCoreModule = {
  Channel: class MockTauriChannel {},
  invoke: mockInvoke,
};
const mockGetCurrentWindow = jest.fn();
const mockWindowModule = {
  getCurrentWindow: mockGetCurrentWindow,
};
let mockCoreModuleFactoryCalls = 0;
let mockWindowModuleFactoryCalls = 0;

jest.mock('@tauri-apps/api/core', () => {
  mockCoreModuleFactoryCalls += 1;
  return mockCoreModule;
});

jest.mock('@tauri-apps/api/window', () => {
  mockWindowModuleFactoryCalls += 1;
  return mockWindowModule;
});

describe('Tauri runtime module loaders', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockCoreModuleFactoryCalls = 0;
    mockWindowModuleFactoryCalls = 0;
  });

  it('defers loading the core API until a desktop core operation requests it', async () => {
    const runtime =
      require('./tauri-runtime') as typeof import('./tauri-runtime.js');

    expect(mockCoreModuleFactoryCalls).toBe(0);

    await expect(runtime.loadTauriCoreModule()).resolves.toMatchObject(
      mockCoreModule
    );
    expect(mockCoreModuleFactoryCalls).toBe(1);
  });

  it('defers loading the window API until a desktop window operation requests it', async () => {
    const runtime =
      require('./tauri-runtime') as typeof import('./tauri-runtime.js');

    expect(mockWindowModuleFactoryCalls).toBe(0);

    await expect(runtime.loadTauriWindowModule()).resolves.toMatchObject(
      mockWindowModule
    );
    expect(mockWindowModuleFactoryCalls).toBe(1);
  });
});
