import { getRuntimeConfig } from '@/lib/runtime-config';

export const LOCAL_SERVICE_ADMIN_CAPABILITY_HEADER =
  'X-MoonTV-Admin-Capability';

let adminCapability: string | null = null;

function isDesktopTarget(): boolean {
  return getRuntimeConfig().APP_TARGET === 'desktop';
}

export function setDesktopAdminCapability(capability: string | null) {
  adminCapability = capability?.trim() || null;
}

export function clearDesktopAdminCapability() {
  adminCapability = null;
}

export function getDesktopAdminCapability(): string | null {
  return isDesktopTarget() ? adminCapability : null;
}

export function withDesktopAdminCapability(
  path: string,
  options: RequestInit = {}
): RequestInit {
  if (!path.startsWith('/admin/') && !path.startsWith('admin/')) {
    return options;
  }

  const capability = getDesktopAdminCapability();
  if (!capability) {
    return options;
  }

  const headers = new Headers(options.headers);
  headers.set(LOCAL_SERVICE_ADMIN_CAPABILITY_HEADER, capability);

  return {
    ...options,
    headers,
  };
}

export function setDesktopAdminCapabilityForTests(capability: string | null) {
  setDesktopAdminCapability(capability);
}