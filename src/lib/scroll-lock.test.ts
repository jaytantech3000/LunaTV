import {
  __resetScrollLockForTests,
  acquireScrollLock,
} from './scroll-lock';

describe('acquireScrollLock', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280,
      writable: true,
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
      writable: true,
    });
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: jest.fn(),
      writable: true,
    });
    Object.defineProperty(window, 'scrollX', {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: 1260,
    });

    __resetScrollLockForTests();
    document.body.style.cssText = '';
    document.documentElement.style.cssText = '';
  });

  afterEach(() => {
    __resetScrollLockForTests();
    document.body.style.cssText = '';
    document.documentElement.style.cssText = '';
  });

  it('locks body and html overflow and restores the original inline styles', () => {
    document.body.style.overflow = 'scroll';
    document.documentElement.style.overflow = 'clip';

    const releaseScrollLock = acquireScrollLock({
      lockHtml: true,
    });

    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');

    releaseScrollLock();

    expect(document.body.style.overflow).toBe('scroll');
    expect(document.documentElement.style.overflow).toBe('clip');
  });

  it('keeps the page locked when a frozen sheet closes before a nested dialog', () => {
    document.body.style.overflow = 'visible';
    document.body.style.paddingRight = '3px';

    Object.defineProperty(window, 'scrollX', {
      configurable: true,
      value: 24,
      writable: true,
    });
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 160,
      writable: true,
    });

    const releaseSheetLock = acquireScrollLock({
      freezeBody: true,
    });
    const releaseDialogLock = acquireScrollLock();
    const scrollToMock = window.scrollTo as unknown as jest.Mock;

    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-160px');
    expect(document.body.style.left).toBe('-24px');
    expect(document.body.style.paddingRight).toBe('20px');
    expect(scrollToMock).not.toHaveBeenCalled();

    releaseSheetLock();

    expect(document.body.style.position).toBe('');
    expect(document.body.style.top).toBe('');
    expect(document.body.style.left).toBe('');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.paddingRight).toBe('3px');
    expect(scrollToMock).toHaveBeenCalledWith(24, 160);

    releaseDialogLock();

    expect(document.body.style.overflow).toBe('visible');
  });

  it('restores existing body layout styles after the last frozen lock releases', () => {
    document.body.style.position = 'relative';
    document.body.style.top = '10px';
    document.body.style.left = '12px';
    document.body.style.right = '8px';
    document.body.style.width = '75%';
    document.body.style.paddingRight = '6px';
    document.documentElement.style.overflow = 'auto';

    const releaseScrollLock = acquireScrollLock({
      freezeBody: true,
      lockHtml: true,
    });

    releaseScrollLock();

    expect(document.body.style.position).toBe('relative');
    expect(document.body.style.top).toBe('10px');
    expect(document.body.style.left).toBe('12px');
    expect(document.body.style.right).toBe('8px');
    expect(document.body.style.width).toBe('75%');
    expect(document.body.style.paddingRight).toBe('6px');
    expect(document.documentElement.style.overflow).toBe('auto');
  });
});
