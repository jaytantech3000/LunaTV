/* eslint-disable @typescript-eslint/no-var-requires */
async function loadProxySecurityWithLookupMock() {
  jest.resetModules();

  // Jest 27 + NodeNext tests need runtime require here so the spy hooks the same module instance.
  const dnsPromises = require('dns/promises') as typeof import('dns/promises');
  const lookupMock = jest.spyOn(dnsPromises, 'lookup');

  const proxySecurity =
    require('./proxy-security') as typeof import('./proxy-security.js');
  proxySecurity.clearProxyValidationCachesForTests();

  return {
    lookupMock,
    proxySecurity,
  };
}

async function loadProxySecurity() {
  jest.resetModules();

  const proxySecurity =
    require('./proxy-security') as typeof import('./proxy-security.js');
  proxySecurity.clearProxyValidationCachesForTests();

  return proxySecurity;
}

describe('proxy target validation cache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('reuses cached hostname validations for repeated requests', async () => {
    const { lookupMock, proxySecurity } =
      await loadProxySecurityWithLookupMock();
    const lookupResult = [
      {
        address: '93.184.216.34',
        family: 4,
      },
    ];

    lookupMock.mockResolvedValue(lookupResult as never);

    await proxySecurity.validateProxyTargetUrl(
      'https://example.com/video-a.ts'
    );
    await proxySecurity.validateProxyTargetUrl(
      'https://example.com/video-b.ts'
    );

    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(lookupMock).toHaveBeenCalledWith('example.com', {
      all: true,
      verbatim: true,
    });
  });

  it('dedupes concurrent hostname validations for the same host', async () => {
    const { lookupMock, proxySecurity } =
      await loadProxySecurityWithLookupMock();
    const lookupResult = [
      {
        address: '93.184.216.34',
        family: 4,
      },
    ];

    let resolveLookup: ((value: typeof lookupResult) => void) | undefined;

    lookupMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLookup = resolve as unknown as typeof resolveLookup;
        })
    );

    const firstValidation = proxySecurity.validateProxyTargetUrl(
      'https://example.com/part-1.ts'
    );
    const secondValidation = proxySecurity.validateProxyTargetUrl(
      'https://example.com/part-2.ts'
    );

    expect(lookupMock).toHaveBeenCalledTimes(1);

    resolveLookup?.(lookupResult);

    await expect(
      Promise.all([firstValidation, secondValidation])
    ).resolves.toEqual([
      'https://example.com/part-1.ts',
      'https://example.com/part-2.ts',
    ]);
  });
});

describe('fetchWithValidatedRedirects', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('buffers the response body when buffer mode is requested', async () => {
    const proxySecurity = await loadProxySecurity();
    const upstreamResponse = new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
      },
    });
    const arrayBufferSpy = jest.spyOn(upstreamResponse, 'arrayBuffer');
    global.fetch = jest
      .fn()
      .mockResolvedValue(upstreamResponse as unknown as Response);

    const response = await proxySecurity.fetchWithValidatedRedirects(
      'https://example.com/key.bin',
      {
        method: 'GET',
      },
      {
        initialUrlValidated: true,
        responseMode: 'buffer',
        timeoutMs: 1000,
      }
    );

    expect(arrayBufferSpy).toHaveBeenCalledTimes(1);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('keeps stream mode by default without pre-reading the response body', async () => {
    const proxySecurity = await loadProxySecurity();
    const upstreamResponse = new Response('segment-body', {
      status: 200,
      headers: {
        'content-type': 'video/mp2t',
      },
    });
    const arrayBufferSpy = jest.spyOn(upstreamResponse, 'arrayBuffer');
    global.fetch = jest
      .fn()
      .mockResolvedValue(upstreamResponse as unknown as Response);

    const response = await proxySecurity.fetchWithValidatedRedirects(
      'https://example.com/0001.ts',
      {
        method: 'GET',
      },
      {
        initialUrlValidated: true,
        timeoutMs: 1000,
      }
    );

    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(await response.text()).toBe('segment-body');
  });
});
