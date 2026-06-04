import DownloadsClient from '@/components/DownloadsClient';
import PageLayout from '@/components/PageLayout';

export default function DownloadsPage() {
  return (
    <PageLayout activePath='/downloads'>
      <DownloadsClient />
    </PageLayout>
  );
}
