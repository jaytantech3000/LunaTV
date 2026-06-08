import { NextRequest } from 'next/server';

import { ProfileContext, requireAuthContextFromRequest } from '@/lib/auth';
import { requireActiveProfileContext } from '@/lib/core/profile/service';

export async function requireProfileContextFromRequest(
  request: NextRequest
): Promise<ProfileContext> {
  const authContext = requireAuthContextFromRequest(request);
  return requireActiveProfileContext(authContext);
}
