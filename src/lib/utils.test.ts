import { processImageUrl } from './utils';

describe('processImageUrl', () => {
  beforeEach(() => {
    window.localStorage.clear();
    (window as typeof window & { RUNTIME_CONFIG?: unknown }).RUNTIME_CONFIG =
      undefined;
  });

  it('routes only credential-free HTTPS Douban image subdomains through the local proxy', () => {
    window.localStorage.setItem('doubanImageProxyType', 'server');

    expect(
      processImageUrl(
        'https://img1.doubanio.com/view/photo/raw/public/p1.jpg'
      )
    ).toBe(
      '/api/image-proxy?url=https%3A%2F%2Fimg1.doubanio.com%2Fview%2Fphoto%2Fraw%2Fpublic%2Fp1.jpg'
    );
  });

  it('normalizes surrounding whitespace before proxying a safe image URL', () => {
    window.localStorage.setItem('doubanImageProxyType', 'server');

    expect(
      processImageUrl(
        '  https://img1.doubanio.com/view/photo/raw/public/p1.jpg  '
      )
    ).toBe(
      '/api/image-proxy?url=https%3A%2F%2Fimg1.doubanio.com%2Fview%2Fphoto%2Fraw%2Fpublic%2Fp1.jpg'
    );
  });

  it.each([
    'http://img1.doubanio.com/p1.jpg',
    'https://doubanio.com/p1.jpg',
    'https://notdoubanio.com/p1.jpg',
    'https://user:pass@img1.doubanio.com/p1.jpg',
  ])('does not proxy unsafe image URL %s', (url) => {
    window.localStorage.setItem('doubanImageProxyType', 'server');

    expect(processImageUrl(url)).toBe(url);
  });
});
