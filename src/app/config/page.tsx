import ConfigPageClient from '@/components/ConfigPageClient';
import PageLayout from '@/components/PageLayout';

export default function ConfigPage() {
  return (
    <PageLayout activePath='/config'>
      <ConfigPageClient />
    </PageLayout>
  );
}
