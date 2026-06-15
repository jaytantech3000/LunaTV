const QUALITY_RANK: Record<string, number> = {
  SD: 1,
  '480p': 2,
  '720p': 3,
  '1080p': 4,
  '2K': 5,
  '4K': 6,
};

const QUALITY_HINT_PATTERNS: Array<{
  pattern: RegExp;
  quality: string;
}> = [
  {
    pattern: /(?:^|[^a-z0-9])(4k|2160p?)(?:[^a-z0-9]|$)/i,
    quality: '4K',
  },
  {
    pattern: /(?:^|[^a-z0-9])(2k|1440p?)(?:[^a-z0-9]|$)/i,
    quality: '2K',
  },
  {
    pattern: /(?:^|[^a-z0-9])(1080p?|fhd)(?:[^a-z0-9]|$)/i,
    quality: '1080p',
  },
  {
    pattern: /(?:^|[^a-z0-9])(720p?|hd)(?:[^a-z0-9]|$)/i,
    quality: '720p',
  },
  {
    pattern: /(?:^|[^a-z0-9])(480p?)(?:[^a-z0-9]|$)/i,
    quality: '480p',
  },
  {
    pattern: /(?:^|[^a-z0-9])(360p?|sd)(?:[^a-z0-9]|$)/i,
    quality: 'SD',
  },
];

function compareQuality(left: string, right: string): number {
  return (QUALITY_RANK[left] || 0) - (QUALITY_RANK[right] || 0);
}

export function pickBetterVideoQuality(
  currentQuality: string,
  nextQuality: string
): string {
  if (compareQuality(nextQuality, currentQuality) > 0) {
    return nextQuality;
  }

  return currentQuality;
}

export function getVideoQualityFromResolution(
  width?: number,
  height?: number
): string {
  const normalizedWidth =
    typeof width === 'number' && Number.isFinite(width) ? width : 0;
  const normalizedHeight =
    typeof height === 'number' && Number.isFinite(height) ? height : 0;
  const longestSide = Math.max(normalizedWidth, normalizedHeight);
  const shortestSide = Math.min(normalizedWidth, normalizedHeight);

  if (longestSide >= 3840 || shortestSide >= 2160) {
    return '4K';
  }

  if (longestSide >= 2560 || shortestSide >= 1440) {
    return '2K';
  }

  if (longestSide >= 1920 || shortestSide >= 1080) {
    return '1080p';
  }

  if (longestSide >= 1280 || shortestSide >= 720) {
    return '720p';
  }

  if (longestSide >= 854 || shortestSide >= 480) {
    return '480p';
  }

  if (longestSide > 0 || shortestSide > 0) {
    return 'SD';
  }

  return '未知';
}

export function parseVideoQualityHints(
  values: Array<string | null | undefined>
): string {
  let bestQuality = '未知';

  values.forEach((value) => {
    const normalizedValue = value?.trim();

    if (!normalizedValue) {
      return;
    }

    QUALITY_HINT_PATTERNS.forEach(({ pattern, quality }) => {
      if (pattern.test(normalizedValue)) {
        bestQuality = pickBetterVideoQuality(bestQuality, quality);
      }
    });
  });

  return bestQuality;
}

export function parseVideoQualityFromManifest(manifestText: string): string {
  const normalizedManifestText = manifestText.trim();

  if (!normalizedManifestText) {
    return '未知';
  }

  let bestQuality = '未知';
  const resolutionMatches = Array.from(
    normalizedManifestText.matchAll(/RESOLUTION=(\d+)x(\d+)/gi)
  );

  for (const match of resolutionMatches) {
    const width = Number.parseInt(match[1] || '', 10);
    const height = Number.parseInt(match[2] || '', 10);

    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      continue;
    }

    bestQuality = pickBetterVideoQuality(
      bestQuality,
      getVideoQualityFromResolution(width, height)
    );
  }

  const nameMatches = Array.from(
    normalizedManifestText.matchAll(/NAME="([^"]+)"/gi)
  ).map((match) => match[1]);

  bestQuality = pickBetterVideoQuality(
    bestQuality,
    parseVideoQualityHints([normalizedManifestText, ...nameMatches])
  );

  return bestQuality;
}
