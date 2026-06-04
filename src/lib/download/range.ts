export function hasExplicitExclusiveByteRange(
  rangeStart?: number | null,
  rangeEnd?: number | null
): boolean {
  if (
    typeof rangeStart !== 'number' ||
    typeof rangeEnd !== 'number' ||
    !Number.isFinite(rangeStart) ||
    !Number.isFinite(rangeEnd)
  ) {
    return false;
  }

  // hls.js uses 0/0 as the default for non-byte-range fragment requests.
  return !(rangeStart === 0 && rangeEnd === 0);
}
