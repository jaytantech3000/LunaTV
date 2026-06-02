export const DEFAULT_GLOBAL_MINIMUM_RATING = 6;

export function parseProjectRating(rate?: string | number | null): number {
  if (typeof rate === 'number') {
    return Number.isFinite(rate) ? rate : 0;
  }

  const numericRate = Number.parseFloat(rate || '');
  return Number.isFinite(numericRate) ? numericRate : 0;
}

export function normalizeMinimumRating(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_GLOBAL_MINIMUM_RATING;
  }

  return Math.min(10, Math.max(0, Math.round(value * 10) / 10));
}

export function passesGlobalRatingFilter(
  rate: string | number | null | undefined,
  enabled: boolean,
  minimumRating: number
): boolean {
  if (!enabled) {
    return true;
  }

  const numericRate = parseProjectRating(rate);

  if (numericRate <= 0) {
    return true;
  }

  return numericRate >= minimumRating;
}

export function filterItemsByMinimumRating<T>(
  items: T[],
  getRate: (item: T) => string | number | null | undefined,
  enabled: boolean,
  minimumRating: number
): T[] {
  if (!enabled) {
    return items;
  }

  return items.filter((item) =>
    passesGlobalRatingFilter(getRate(item), enabled, minimumRating)
  );
}
