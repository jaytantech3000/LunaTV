import { NextResponse } from 'next/server';

import { buildServerConfigPayload } from '@/lib/runtime/public-config';

export const runtime = 'nodejs';

export async function GET() {
  const result = await buildServerConfigPayload();
  return NextResponse.json(result);
}
