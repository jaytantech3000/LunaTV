import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';

import { DesktopDiagnosticsOperator } from './types';

export async function getDesktopDiagnosticsOperator(
  request: NextRequest
): Promise<DesktopDiagnosticsOperator | null> {
  const authInfo = getAuthInfoFromCookie(request);
  const username = authInfo?.username?.trim();

  if (!username) {
    return null;
  }

  if (username === process.env.USERNAME) {
    return {
      role: 'owner',
      username,
    };
  }

  const config = await getConfig();
  const user = config.UserConfig.Users.find(
    (entry) => entry.username === username
  );

  if (!user || user.role !== 'admin' || user.banned) {
    return null;
  }

  return {
    role: 'admin',
    username,
  };
}
