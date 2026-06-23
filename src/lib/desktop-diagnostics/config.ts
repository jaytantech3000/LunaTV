import { DesktopDiagnosticsError } from './errors';

export interface DesktopDiagnosticsSupabaseConfig {
  bucketName: string;
  serviceRoleKey: string;
  url: string;
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function isDesktopDiagnosticsUploadEnabled(): boolean {
  const value =
    process.env.DESKTOP_DIAGNOSTICS_UPLOAD_ENABLED?.trim().toLowerCase();

  return value ? TRUE_VALUES.has(value) : false;
}

export function getDesktopDiagnosticsSupabaseConfig(): DesktopDiagnosticsSupabaseConfig | null {
  const url = readEnv('DESKTOP_DIAGNOSTICS_SUPABASE_URL');
  const serviceRoleKey = readEnv(
    'DESKTOP_DIAGNOSTICS_SUPABASE_SERVICE_ROLE_KEY'
  );
  const bucketName = readEnv('DESKTOP_DIAGNOSTICS_SUPABASE_BUCKET');

  if (!url || !serviceRoleKey || !bucketName) {
    return null;
  }

  return {
    bucketName,
    serviceRoleKey,
    url,
  };
}

export function assertDesktopDiagnosticsSupabaseConfig(): DesktopDiagnosticsSupabaseConfig {
  const config = getDesktopDiagnosticsSupabaseConfig();

  if (!config) {
    throw new DesktopDiagnosticsError(
      'server_misconfigured',
      'Desktop diagnostics storage is not configured on the server.',
      500
    );
  }

  return config;
}
