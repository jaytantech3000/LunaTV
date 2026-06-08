import { AdminConfig } from '@/lib/admin.types';
import { AuthContext, createProfileContext, ProfileContext } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  AppStorageType,
  getConfiguredStorageType,
  getProfileMode,
} from '@/lib/runtime/storage-mode';

export class ProfileServiceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ProfileServiceError';
    this.status = status;
  }
}

function findConfiguredUser(config: AdminConfig, username: string) {
  return config.UserConfig.Users.find((user) => user.username === username);
}

function isPrimaryOwnerUsername(username: string): boolean {
  return username === process.env.USERNAME;
}

export async function requireActiveProfileContext(
  authContext: AuthContext,
  options: {
    storageType?: AppStorageType;
    config?: AdminConfig;
  } = {}
): Promise<ProfileContext> {
  const storageType = options.storageType || getConfiguredStorageType();
  const profileMode = getProfileMode(storageType);

  if (profileMode === 'single-user-local') {
    return createProfileContext(authContext, {
      storageType,
      profileMode,
    });
  }

  const config = options.config || (await getConfig());
  if (!isPrimaryOwnerUsername(authContext.username)) {
    const user = findConfiguredUser(config, authContext.username);
    if (!user) {
      throw new ProfileServiceError('用户不存在', 401);
    }
    if (user.banned) {
      throw new ProfileServiceError('用户已被封禁', 401);
    }
  }

  return createProfileContext(authContext, {
    storageType,
    profileMode,
  });
}

export function parseCompositeProfileKey(
  key: string,
  errorMessage = 'Invalid key format'
): {
  source: string;
  id: string;
} {
  const [source, id] = key.split('+');

  if (!source || !id) {
    throw new ProfileServiceError(errorMessage, 400);
  }

  return {
    source,
    id,
  };
}
