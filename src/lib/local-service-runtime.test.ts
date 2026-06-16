import {
  applyLocalServiceMediaProxyOverride,
  buildRuntimeConfigBootstrapScript,
  isLocalServiceAccelerationActive,
} from './local-service-runtime';
import type { AppRuntimeConfig } from './runtime-config';

describe('local service runtime helpers', () => {
  it('only overrides the media proxy base url when local acceleration is enabled', () => {
    const runtimeConfig: AppRuntimeConfig = {
      API_BASE_URL: 'https://api.example.com',
      MEDIA_PROXY_BASE_URL: 'https://proxy.example.com',
    };

    expect(
      applyLocalServiceMediaProxyOverride(
        runtimeConfig,
        'http://127.0.0.1:8787/'
      )
    ).toEqual({
      API_BASE_URL: 'https://api.example.com',
      MEDIA_PROXY_BASE_URL: 'http://127.0.0.1:8787',
    });
  });

  it('detects active acceleration from the media proxy base url instead of the api base url', () => {
    expect(
      isLocalServiceAccelerationActive('http://127.0.0.1:8787', {
        API_BASE_URL: 'http://127.0.0.1:8787',
        MEDIA_PROXY_BASE_URL: 'https://proxy.example.com',
      })
    ).toBe(false);

    expect(
      isLocalServiceAccelerationActive('http://127.0.0.1:8787', {
        API_BASE_URL: 'https://api.example.com',
        MEDIA_PROXY_BASE_URL: 'http://127.0.0.1:8787',
      })
    ).toBe(true);
  });

  it('restores the stored local media proxy override during runtime bootstrap', () => {
    const fakeWindow = {
      localStorage: {
        getItem: jest.fn(() => 'http://127.0.0.1:8787/'),
      },
    } as unknown as Window & {
      localStorage: {
        getItem: jest.Mock<string, [string]>;
      };
      RUNTIME_CONFIG?: AppRuntimeConfig;
    };

    const script = buildRuntimeConfigBootstrapScript({
      API_BASE_URL: 'https://api.example.com',
      MEDIA_PROXY_BASE_URL: 'https://proxy.example.com',
    });

    new Function('window', script)(fakeWindow);

    expect(fakeWindow.RUNTIME_CONFIG).toEqual({
      API_BASE_URL: 'https://api.example.com',
      MEDIA_PROXY_BASE_URL: 'http://127.0.0.1:8787',
    });
  });
});
