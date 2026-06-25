import type { DesktopProfileSyncStatus } from '@/lib/desktop/profile-sync';
import {
  type DesktopProfileSyncDiagnosticItem,
  buildDesktopProfileSyncDiagnostics,
} from '@/lib/desktop/profile-sync-status-copy';

interface DesktopProfileSyncDiagnosticsGridProps {
  profileSyncStatus: DesktopProfileSyncStatus | null | undefined;
  profileSyncStatusError?: string | null;
}

function DesktopProfileSyncDiagnosticCell({
  item,
}: {
  item: DesktopProfileSyncDiagnosticItem;
}) {
  return (
    <div className='rounded-lg border border-gray-200 bg-white px-3 py-3 dark:border-gray-700 dark:bg-gray-900'>
      <div className='text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400'>
        {item.label}
      </div>
      <div className='mt-1 text-xs leading-5 text-gray-700 dark:text-gray-200'>
        {item.value}
      </div>
    </div>
  );
}

export default function DesktopProfileSyncDiagnosticsGrid({
  profileSyncStatus,
  profileSyncStatusError,
}: DesktopProfileSyncDiagnosticsGridProps) {
  const diagnostics = buildDesktopProfileSyncDiagnostics(
    profileSyncStatus,
    profileSyncStatusError
  );

  return (
    <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-3'>
      {diagnostics.map((item) => (
        <DesktopProfileSyncDiagnosticCell key={item.label} item={item} />
      ))}
    </div>
  );
}
