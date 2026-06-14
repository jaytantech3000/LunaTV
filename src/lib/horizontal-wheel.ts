interface HorizontalWheelContainer {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
  scrollBy: (options: ScrollToOptions) => void;
}

interface HorizontalWheelEventLike {
  deltaX: number;
  deltaY: number;
  preventDefault: () => void;
}

interface ApplyVerticalWheelToHorizontalScrollParams {
  container: HorizontalWheelContainer;
  event: HorizontalWheelEventLike;
  speedMultiplier?: number;
}

const SCROLL_EDGE_TOLERANCE_PX = 1;

export function applyVerticalWheelToHorizontalScroll(
  params: ApplyVerticalWheelToHorizontalScrollParams
): boolean {
  const { container, event, speedMultiplier = 1 } = params;

  if (Math.abs(event.deltaY) === 0) {
    return false;
  }

  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    return false;
  }

  const maxScrollLeft = Math.max(
    0,
    container.scrollWidth - container.clientWidth
  );
  if (maxScrollLeft <= SCROLL_EDGE_TOLERANCE_PX) {
    return false;
  }

  const isScrollingLeft = event.deltaY < 0;
  const isScrollingRight = event.deltaY > 0;
  const atLeftEdge = container.scrollLeft <= SCROLL_EDGE_TOLERANCE_PX;
  const atRightEdge =
    container.scrollLeft >= maxScrollLeft - SCROLL_EDGE_TOLERANCE_PX;

  if ((isScrollingLeft && atLeftEdge) || (isScrollingRight && atRightEdge)) {
    return false;
  }

  event.preventDefault();
  container.scrollBy({
    left: event.deltaY * speedMultiplier,
    behavior: 'smooth',
  });
  return true;
}
