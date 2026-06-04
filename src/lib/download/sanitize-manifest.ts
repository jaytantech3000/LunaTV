export function isUnsupportedVodSegmentUri(line: string): boolean {
  const trimmedLine = line.trim();
  const uriMatch = trimmedLine.match(/URI="([^"]+)"/i);
  const target = uriMatch?.[1] || trimmedLine;

  return /(^|\/)video\/adjump\//i.test(target);
}

export function sanitizeVodManifestLines(lines: string[]): string[] {
  const sanitizedLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmedLine = lines[index].trim();

    if (trimmedLine === '#EXT-X-DISCONTINUITY') {
      let cursor = index + 1;
      let foundUnsupportedSegment = false;

      while (cursor + 1 < lines.length) {
        const durationLine = lines[cursor].trim();
        const resourceLine = lines[cursor + 1].trim();

        if (
          durationLine.startsWith('#EXTINF:') &&
          isUnsupportedVodSegmentUri(resourceLine)
        ) {
          foundUnsupportedSegment = true;
          cursor += 2;
          continue;
        }

        break;
      }

      if (foundUnsupportedSegment) {
        if (lines[cursor]?.trim() === '#EXT-X-DISCONTINUITY') {
          cursor += 1;
        }

        index = cursor - 1;
        continue;
      }
    }

    if (
      trimmedLine.startsWith('#EXTINF:') &&
      isUnsupportedVodSegmentUri(lines[index + 1]?.trim() || '')
    ) {
      index += 1;
      continue;
    }

    if (
      (trimmedLine.startsWith('#EXT-X-PART:') ||
        trimmedLine.startsWith('#EXT-X-PRELOAD-HINT:') ||
        trimmedLine.startsWith('#EXT-X-MAP:')) &&
      isUnsupportedVodSegmentUri(trimmedLine)
    ) {
      continue;
    }

    if (isUnsupportedVodSegmentUri(trimmedLine)) {
      continue;
    }

    sanitizedLines.push(trimmedLine);
  }

  return sanitizedLines;
}

export function sanitizeVodManifestContent(content: string): string {
  return sanitizeVodManifestLines(content.split(/\r?\n/)).join('\n');
}
