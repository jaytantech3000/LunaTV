import { applyVerticalWheelToHorizontalScroll } from './horizontal-wheel';

function createContainer(
  partial: Partial<{
    scrollWidth: number;
    clientWidth: number;
    scrollLeft: number;
  }> = {}
) {
  return {
    scrollWidth: partial.scrollWidth ?? 500,
    clientWidth: partial.clientWidth ?? 200,
    scrollLeft: partial.scrollLeft ?? 100,
    scrollBy: jest.fn(),
  };
}

function createEvent(
  partial: Partial<{
    deltaX: number;
    deltaY: number;
  }> = {}
) {
  return {
    deltaX: partial.deltaX ?? 0,
    deltaY: partial.deltaY ?? 40,
    preventDefault: jest.fn(),
  };
}

describe('applyVerticalWheelToHorizontalScroll', () => {
  it('converts vertical wheel movement into horizontal scrolling when overflow exists', () => {
    const container = createContainer();
    const event = createEvent();

    const handled = applyVerticalWheelToHorizontalScroll({
      container,
      event,
      speedMultiplier: 2,
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(container.scrollBy).toHaveBeenCalledWith({
      left: 80,
      behavior: 'smooth',
    });
  });

  it('does not intercept wheel events when the container is already at the right edge', () => {
    const container = createContainer({
      scrollLeft: 300,
    });
    const event = createEvent({
      deltaY: 50,
    });

    const handled = applyVerticalWheelToHorizontalScroll({
      container,
      event,
      speedMultiplier: 2,
    });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(container.scrollBy).not.toHaveBeenCalled();
  });

  it('does not intercept primarily horizontal trackpad gestures', () => {
    const container = createContainer();
    const event = createEvent({
      deltaX: 60,
      deltaY: 20,
    });

    const handled = applyVerticalWheelToHorizontalScroll({
      container,
      event,
      speedMultiplier: 2,
    });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(container.scrollBy).not.toHaveBeenCalled();
  });
});
