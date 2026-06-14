/* eslint-disable @typescript-eslint/no-var-requires */
async function loadProxySecurityWithLookupMock() {
  jest.resetModules();

  // Jest 27 + NodeNext tests need runtime require here so the spy hooks the same module instance.
  const dnsPromises =
    require('dns/promises') as typeof import('dns/promises');
  const lookupMock = jest.spyOn(dnsPromises, 'lookup');

  const proxySecurity =
    require('./proxy-security') as typeof import('./proxy-security.js');
  proxySecurity.clearProxyValidationCachesForTests();

  return {
    lookupMock,
    proxySecurity,
  };
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

    await proxySecurity.validateProxyTargetUrl('https://example.com/video-a.ts');
    await proxySecurity.validateProxyTargetUrl('https://example.com/video-b.ts');

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

    let resolveLookup:
      | ((value: typeof lookupResult) => void)
      | undefined;

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
