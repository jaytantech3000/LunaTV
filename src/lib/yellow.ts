export const yellowWords = [
  '伦理片',
  '福利',
  '里番动漫',
  '门事件',
  '萝莉少女',
  '制服诱惑',
  '国产传媒',
  'cosplay',
  '黑丝诱惑',
  '无码',
  '日本无码',
  '有码',
  '日本有码',
  'SWAG',
  '网红主播',
  '色情片',
  '同性片',
  '福利视频',
  '福利片',
  '写真热舞',
  '倫理片',
  '理论片',
  '韩国伦理',
  '港台三级',
  '电影解说',
  '伦理',
  '日本伦理',
];

const ADULT_SOURCE_MARKERS = [
  '🔞',
  '成人',
  '情色',
  '三级片',
  '三級',
  'porn',
  'av',
  'onlyfans',
  'only fans',
  'fansly',
];

function normalizeAdultMarkerText(text: string): string {
  return text.toLowerCase().normalize('NFKC').trim();
}

function compactAdultMarkerText(text: string): string {
  return normalizeAdultMarkerText(text).replace(/[\s._-]+/g, '');
}

function containsConfiguredAdultMarker(
  text: string,
  markers: readonly string[]
): boolean {
  const normalized = normalizeAdultMarkerText(text);
  if (!normalized) {
    return false;
  }

  const compact = compactAdultMarkerText(text);

  return markers.some((marker) => {
    const normalizedMarker = normalizeAdultMarkerText(marker);
    if (!normalizedMarker) {
      return false;
    }

    if (normalized.includes(normalizedMarker)) {
      return true;
    }

    if (
      normalizedMarker.includes(' ') ||
      normalizedMarker.includes('.') ||
      normalizedMarker.includes('_') ||
      normalizedMarker.includes('-')
    ) {
      return compact.includes(compactAdultMarkerText(normalizedMarker));
    }

    return false;
  });
}

function containsAdultMarker(text: string): boolean {
  return containsConfiguredAdultMarker(text, [
    ...ADULT_SOURCE_MARKERS,
    ...yellowWords,
  ]);
}

export function isAdultSourceCandidate(
  source: Partial<{
    name: string;
    key: string;
    api: string;
    detail: string;
  }>
): boolean {
  const searchableText = [source.name, source.key, source.api, source.detail]
    .filter(Boolean)
    .join(' ');

  return containsAdultMarker(searchableText);
}

export function isAdultContentResult(
  result: Partial<{
    title: string;
    type_name: string;
    class: string;
    source_name: string;
    desc: string;
  }>
): boolean {
  const sourceName = result.source_name || '';
  if (ADULT_SOURCE_MARKERS.some((marker) => sourceName.includes(marker))) {
    return true;
  }

  const searchableText = [
    result.title,
    result.type_name,
    result.class,
    result.source_name,
    result.desc,
  ]
    .filter(Boolean)
    .join(' ');

  return containsAdultMarker(searchableText);
}

export function filterAdultContentResults<
  T extends {
    title?: string;
    type_name?: string;
    class?: string;
    source_name?: string;
    desc?: string;
  },
>(results: T[]): T[] {
  return results.filter((result) => !isAdultContentResult(result));
}
