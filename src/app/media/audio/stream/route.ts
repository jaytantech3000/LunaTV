import { NextRequest, NextResponse } from 'next/server';

import {
  getMockMusicTrack,
  getMockTrackToneSeed,
} from '@/lib/music/mock-catalog';
import { type MusicPlatformKey } from '@/lib/music/types';

export const runtime = 'nodejs';

const SAMPLE_RATE = 22_050;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const BASE_DURATION_SECONDS = 24;
const trackBufferCache = new Map<string, Buffer>();

function writeWaveHeader(params: { dataLength: number }): Buffer {
  const { dataLength } = params;
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
  const blockAlign = CHANNELS * BYTES_PER_SAMPLE;

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataLength, 40);

  return header;
}

function buildTrackWaveBuffer(seed: number, durationSeconds: number): Buffer {
  const cacheKey = `${seed}:${durationSeconds}`;
  const cachedBuffer = trackBufferCache.get(cacheKey);

  if (cachedBuffer) {
    return cachedBuffer;
  }

  const totalSamples = SAMPLE_RATE * durationSeconds;
  const pcmLength = totalSamples * BYTES_PER_SAMPLE;
  const pcmBuffer = Buffer.alloc(pcmLength);
  const chordBase = 180 + seed * 3;
  const chordIntervals = [0, 4, 7, 11];

  for (let index = 0; index < totalSamples; index += 1) {
    const time = index / SAMPLE_RATE;
    const noteIndex = Math.floor(time * 1.8) % chordIntervals.length;
    const melodicIndex = Math.floor(time * 3.6) % chordIntervals.length;
    const leadFrequency = chordBase * 2 ** (chordIntervals[noteIndex] / 12);
    const harmonyFrequency =
      chordBase * 2 ** (chordIntervals[melodicIndex] / 12) * 0.5;
    const pulseFrequency = 55 + seed;
    const envelope = Math.min(1, (time % 4) / 0.2) * 0.88;
    const sample =
      Math.sin(2 * Math.PI * leadFrequency * time) * 0.36 +
      Math.sin(2 * Math.PI * harmonyFrequency * time) * 0.22 +
      Math.sin(2 * Math.PI * pulseFrequency * time) * 0.12;
    const output = Math.max(-1, Math.min(1, sample * envelope));

    pcmBuffer.writeInt16LE(
      Math.round(output * 0x7fff),
      index * BYTES_PER_SAMPLE
    );
  }

  const buffer = Buffer.concat([
    writeWaveHeader({
      dataLength: pcmBuffer.length,
    }),
    pcmBuffer,
  ]);

  trackBufferCache.set(cacheKey, buffer);

  return buffer;
}

function buildResponseHeaders(params: {
  totalLength: number;
  contentLength: number;
  contentRange?: string;
}) {
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'audio/wav',
    'Content-Length': String(params.contentLength),
  });

  if (params.contentRange) {
    headers.set('Content-Range', params.contentRange);
  }

  return headers;
}

function parseRangeHeader(rangeHeader: string | null, totalLength: number) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }

  const [, startText, endText] = match;
  let start = startText ? Number(startText) : 0;
  let end = endText ? Number(endText) : totalLength - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  if (!startText && endText) {
    const suffixLength = Number(endText);
    start = Math.max(0, totalLength - suffixLength);
    end = totalLength - 1;
  }

  start = Math.max(0, start);
  end = Math.min(totalLength - 1, end);

  if (start > end || start >= totalLength) {
    return {
      invalid: true,
      start,
      end,
    };
  }

  return {
    invalid: false,
    start,
    end,
  };
}

export async function GET(request: NextRequest) {
  const source =
    (request.nextUrl.searchParams.get('source') as MusicPlatformKey | null) ||
    'netease';
  const id = request.nextUrl.searchParams.get('id') || '';

  if (!id) {
    return NextResponse.json({ error: '缺少曲目 id' }, { status: 400 });
  }

  const track = getMockMusicTrack(source, id);
  const toneSeed = getMockTrackToneSeed(source, id);

  if (!track || !toneSeed) {
    return NextResponse.json({ error: '曲目不存在' }, { status: 404 });
  }

  const buffer = buildTrackWaveBuffer(
    toneSeed,
    Math.max(BASE_DURATION_SECONDS, Math.round((track.durationMs || 0) / 1000))
  );
  const totalLength = buffer.length;
  const range = parseRangeHeader(request.headers.get('range'), totalLength);

  if (range?.invalid) {
    return new NextResponse(null, {
      status: 416,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes */${totalLength}`,
      },
    });
  }

  if (range) {
    const chunk = buffer.subarray(range.start, range.end + 1);

    return new NextResponse(chunk, {
      status: 206,
      headers: buildResponseHeaders({
        totalLength,
        contentLength: chunk.length,
        contentRange: `bytes ${range.start}-${range.end}/${totalLength}`,
      }),
    });
  }

  return new NextResponse(buffer, {
    status: 200,
    headers: buildResponseHeaders({
      totalLength,
      contentLength: totalLength,
    }),
  });
}
