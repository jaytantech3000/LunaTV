import { act, render, screen } from '@testing-library/react';

import {
  GlobalErrorIndicator,
  triggerGlobalError,
} from './GlobalErrorIndicator';

describe('GlobalErrorIndicator', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('dismisses a toast after its visibility timeout', () => {
    render(<GlobalErrorIndicator />);

    act(() => {
      triggerGlobalError('temporary failure');
    });

    expect(screen.getByText('temporary failure')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(3200);
    });

    expect(screen.queryByText('temporary failure')).not.toBeInTheDocument();
  });

  it('does not extend the visibility timeout for duplicate messages', () => {
    render(<GlobalErrorIndicator />);

    act(() => {
      triggerGlobalError('temporary failure');
      jest.advanceTimersByTime(1000);
      triggerGlobalError('temporary failure');
      jest.advanceTimersByTime(2200);
    });

    expect(screen.queryByText('temporary failure')).not.toBeInTheDocument();
  });
});
