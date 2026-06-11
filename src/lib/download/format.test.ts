import {
  formatTaskSizeProgress,
  hasEstimatedTaskTotalSize,
} from './format';

describe('download format helpers', () => {
  it('marks total size as estimated while downloading', () => {
    expect(
      hasEstimatedTaskTotalSize({
        sizeBytes: 45 * 1024 * 1024,
        currentSizeBytes: 45 * 1024 * 1024,
        estimatedTotalSizeBytes: 713 * 1024 * 1024,
      })
    ).toBe(true);

    expect(
      formatTaskSizeProgress({
        sizeBytes: 45 * 1024 * 1024,
        currentSizeBytes: 45 * 1024 * 1024,
        estimatedTotalSizeBytes: 713 * 1024 * 1024,
      })
    ).toBe('45.0 MB / 约 713.0 MB');
  });

  it('keeps the total size fixed when it is no longer an estimate', () => {
    expect(
      hasEstimatedTaskTotalSize({
        sizeBytes: 713 * 1024 * 1024,
        currentSizeBytes: 713 * 1024 * 1024,
        estimatedTotalSizeBytes: 713 * 1024 * 1024,
      })
    ).toBe(false);

    expect(
      formatTaskSizeProgress({
        sizeBytes: 713 * 1024 * 1024,
        currentSizeBytes: 713 * 1024 * 1024,
        estimatedTotalSizeBytes: 713 * 1024 * 1024,
      })
    ).toBe('713.0 MB / 713.0 MB');
  });
});
